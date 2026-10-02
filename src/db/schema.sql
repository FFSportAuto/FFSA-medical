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
  accident_id   uuid NOT NULL UNIQUE REFERENCES accident_reports(id) ON DELETE CASCADE,
  request_id    uuid REFERENCES medical_requests(id),
  data_enc      bytea NOT NULL,
  form_version  integer NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now()
);

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
