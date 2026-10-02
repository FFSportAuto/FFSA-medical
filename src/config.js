'use strict';

const required = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Variable d'environnement manquante : ${name}`);
  }
  return value;
};

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

// GitHub Codespaces : URL publique du port 3000 déduite automatiquement
const codespaceUrl = process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
  ? `https://${process.env.CODESPACE_NAME}-3000.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
  : null;

const config = {
  env,
  isProd,
  port: Number(process.env.PORT || 3000),
  // URL publique utilisée dans les liens envoyés par e-mail
  baseUrl: (process.env.BASE_URL || codespaceUrl || 'http://localhost:3000').replace(/\/$/, ''),
  // Mode démonstration : comptes de test, codes 2FA affichés, boîte mail intégrée. JAMAIS en production réelle.
  demoMode: process.env.DEMO_MODE === 'true',
  databaseUrl: required('DATABASE_URL', isProd ? undefined : 'postgres://postgres@localhost:5432/ffsa'),
  sessionSecret: required('SESSION_SECRET', isProd ? undefined : 'dev-session-secret-a-changer'),
  // Clé AES-256 (32 octets encodés en base64) pour le chiffrement applicatif des données de santé
  encryptionKey: required(
    'DATA_ENCRYPTION_KEY',
    isProd ? undefined : Buffer.alloc(32, 7).toString('base64'),
  ),
  trustProxy: process.env.TRUST_PROXY || (isProd ? '1' : '0'),
  sessionIdleMinutes: Number(process.env.SESSION_IDLE_MINUTES || 30),
  doctorLinkValidityDays: Number(process.env.DOCTOR_LINK_VALIDITY_DAYS || 14),
  doctorReminderHours: Number(process.env.DOCTOR_REMINDER_HOURS || 48),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 10),
  medicalServiceEmails: (process.env.MEDICAL_SERVICE_EMAILS || 'service.medical@example.org')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  mail: {
    // Si SMTP_HOST est vide, les e-mails sont écrits dans le dossier ./outbox (développement)
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'FFSA - Service médical <no-reply@example.org>',
  },
  sms: {
    // Fournisseur SMS : 'brevo' (API transactionnelle) ; vide = SMS affichés dans ./outbox (démo)
    provider: process.env.SMS_PROVIDER || '',
    apiKey: process.env.SMS_API_KEY || '',
    sender: process.env.SMS_SENDER || 'FFSA',
  },
  // Connexion avec le compte licencié FFSA (OpenID Connect). Vide = bouton masqué
  // (en mode démo, un portail licencié simulé est utilisé).
  oidc: {
    issuer: process.env.OIDC_ISSUER || '',
    clientId: process.env.OIDC_CLIENT_ID || '',
    clientSecret: process.env.OIDC_CLIENT_SECRET || '',
    scopes: process.env.OIDC_SCOPES || 'openid email profile',
    label: process.env.OIDC_LABEL || 'Se connecter avec mon compte licencié FFSA',
    // Revendication contenant le n° de licence
    licenseClaim: process.env.OIDC_LICENSE_CLAIM || 'licence',
    // Restriction facultative : revendication et valeurs autorisées (ex. roles = officiel,organisateur)
    requiredClaim: process.env.OIDC_REQUIRED_CLAIM || '',
    requiredValues: (process.env.OIDC_REQUIRED_VALUES || '').split(',').map((s) => s.trim()).filter(Boolean),
  },
  // Personnes prévenues des demandes d'accès à valider (par défaut : le service médical)
  approverEmails: (process.env.APPROVER_EMAILS || process.env.MEDICAL_SERVICE_EMAILS || 'service.medical@example.org')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  appName: 'FFSA – Rapports accident & médical',
};

module.exports = config;
