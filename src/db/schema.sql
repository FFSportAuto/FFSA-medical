-- Schéma FFSA medical. Les colonnes *_enc contiennent des données chiffrées (AES-256-GCM)
-- au niveau applicatif : un accès direct à la base ne révèle pas les données de santé.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE,
  full_name       text NOT NULL,
  role            text NOT NULL CHECK (role IN ('organizer', 'medical', 'admin')),
  password_hash   text,
  totp_secret_enc bytea,
  totp_enabled    boolean NOT NULL DEFAULT false,
  active          boolean NOT NULL DEFAULT true,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Jetons à usage unique : invitation (création du mot de passe) et réinitialisation
CREATE TABLE IF NOT EXISTS user_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('invite', 'reset')),
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS accident_reference_seq;

CREATE TABLE IF NOT EXISTS accident_reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference     text NOT NULL UNIQUE,
  organizer_id  uuid NOT NULL REFERENCES users(id),
  status        text NOT NULL DEFAULT 'awaiting_medical'
                CHECK (status IN ('awaiting_medical', 'complete')),
  -- Métadonnées non sensibles, en clair pour la recherche dans le back office
  event_name    text NOT NULL,
  event_date    date,
  discipline    text,
  -- Contenu complet du formulaire, chiffré
  data_enc      bytea NOT NULL,
  form_version  integer NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS accident_reports_organizer_idx ON accident_reports (organizer_id);
CREATE INDEX IF NOT EXISTS accident_reports_created_idx ON accident_reports (created_at DESC);

-- Demande de rapport médical adressée au médecin (lien sécurisé)
CREATE TABLE IF NOT EXISTS medical_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accident_id       uuid NOT NULL REFERENCES accident_reports(id) ON DELETE CASCADE,
  doctor_email_enc  bytea NOT NULL,
  token_hash        text NOT NULL UNIQUE,
  expires_at        timestamptz NOT NULL,
  otp_hash          text,
  otp_expires_at    timestamptz,
  otp_attempts      integer NOT NULL DEFAULT 0,
  sent_at           timestamptz,
  reminder_sent_at  timestamptz,
  revoked_at        timestamptz,
  used_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS medical_requests_accident_idx ON medical_requests (accident_id);

CREATE TABLE IF NOT EXISTS medical_reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accident_id   uuid NOT NULL REFERENCES accident_reports(id) ON DELETE CASCADE,
  request_id    uuid REFERENCES medical_requests(id),
  data_enc      bytea NOT NULL,
  form_version  integer NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Un rapport médical par patient consulté : plusieurs rapports par accident
ALTER TABLE medical_reports DROP CONSTRAINT IF EXISTS medical_reports_accident_id_key;
CREATE INDEX IF NOT EXISTS medical_reports_accident_idx ON medical_reports (accident_id);

-- Pièces jointes chiffrées (photos, croquis, comptes rendus)
CREATE TABLE IF NOT EXISTS attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accident_id   uuid NOT NULL REFERENCES accident_reports(id) ON DELETE CASCADE,
  source        text NOT NULL CHECK (source IN ('accident', 'medical')),
  field         text NOT NULL,
  filename_enc  bytea NOT NULL,
  mime_type     text NOT NULL,
  size_bytes    integer NOT NULL,
  content_enc   bytea NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attachments_accident_idx ON attachments (accident_id);

-- Journal d'audit (traçabilité des accès exigée par l'hébergement HDS)
CREATE TABLE IF NOT EXISTS audit_log (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  user_id      uuid REFERENCES users(id),
  actor        text NOT NULL,
  action       text NOT NULL,
  target_type  text,
  target_id    text,
  ip           text,
  details      jsonb
);
CREATE INDEX IF NOT EXISTS audit_log_at_idx ON audit_log (at DESC);

-- Sessions (connect-pg-simple)
CREATE TABLE IF NOT EXISTS session (
  sid    varchar NOT NULL PRIMARY KEY,
  sess   json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS session_expire_idx ON session (expire);

-- ---------- Évolutions ----------

-- Lien entre un rapport médical et la personne déclarée par l'organisateur (vehicle1, person2…)
ALTER TABLE medical_reports ADD COLUMN IF NOT EXISTS patient_ref text;

-- Portable du médecin (envoi du lien et du code par SMS)
ALTER TABLE medical_requests ADD COLUMN IF NOT EXISTS doctor_phone_enc bytea;
ALTER TABLE medical_requests ADD COLUMN IF NOT EXISTS transferred_from uuid REFERENCES medical_requests(id);

-- Brouillons enregistrés automatiquement (chiffrés), purgés après 30 jours
CREATE TABLE IF NOT EXISTS drafts (
  owner_key   text PRIMARY KEY,
  data_enc    bytea NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Suivi des dossiers par le service médical
ALTER TABLE accident_reports ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'a_analyser';
ALTER TABLE accident_reports ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES users(id);
DO $$ BEGIN
  ALTER TABLE accident_reports ADD CONSTRAINT accident_reports_processing_chk CHECK (processing_status IN ('a_analyser', 'en_cours', 'clos'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS case_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accident_id  uuid NOT NULL REFERENCES accident_reports(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES users(id),
  body_enc     bytea NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS case_notes_accident_idx ON case_notes (accident_id, created_at);
