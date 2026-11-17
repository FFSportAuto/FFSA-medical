'use strict';

// Modèles des e-mails. Règle : jamais de donnée de santé ni d'identité de victime,
// uniquement une référence de dossier et un lien vers l'application.

const signature = `\n\n--\nFédération Française du Sport Automobile – Service médical\nMessage automatique, merci de ne pas y répondre.`;

const templates = {
  doctorInvitation: ({ reference, eventName, link, expiresAt }) => ({
    subject: `[FFSA] Rapport médical à compléter – dossier ${reference}`,
    text:
      `Bonjour Docteur,\n\n` +
      `Un rapport d'accident a été déclaré lors de l'épreuve « ${eventName} » ` +
      `et vous a été désigné(e) comme médecin intervenant.\n\n` +
      `Merci de compléter le rapport médical (un formulaire par patient consulté) via le lien sécurisé ci-dessous :\n${link}\n\n` +
      `Pour des raisons de sécurité, un code de vérification vous sera envoyé à l'ouverture du lien.\n` +
      `Ce lien est personnel et valable 48 heures, jusqu'au ${expiresAt}. Passé ce délai, seul le service médical de la FFSA peut vous en envoyer un nouveau.` +
      signature,
  }),
  doctorOtp: ({ reference, code }) => ({
    subject: `[FFSA] Code de vérification – dossier ${reference}`,
    text: `Votre code de vérification : ${code}\n\nIl est valable 10 minutes.` + signature,
  }),
  organizerConfirmation: ({ reference, eventName, withMedical = true }) => ({
    subject: `[FFSA] Rapport d'accident enregistré – dossier ${reference}`,
    text:
      `Bonjour,\n\nVotre rapport d'accident pour l'épreuve « ${eventName} » a bien été enregistré ` +
      `sous la référence ${reference}.\n` +
      (withMedical ? 'Le médecin désigné a été invité à compléter le rapport médical (sous 48 heures).' : 'Aucun rapport médical n’est demandé : le médecin de l’épreuve n’a pas examiné les personnes accidentées.') +
      signature,
  }),
  serviceNewAccident: ({ reference, eventName, link, withMedical = true }) => ({
    subject: `[FFSA] Nouveau rapport d'accident – ${reference}`,
    text:
      `Un nouveau rapport d'accident a été déposé (épreuve « ${eventName} », dossier ${reference}).\n` +
      (withMedical ? 'Le rapport médical a été demandé au médecin intervenant.' : 'Le médecin de l’épreuve n’a pas examiné les personnes accidentées : aucun rapport médical n’est demandé.') +
      `\n\nConsulter : ${link}` +
      signature,
  }),
  serviceComplete: ({ reference, eventName, link }) => ({
    subject: `[FFSA] Dossier complet : rapport d'accident + rapport(s) médical(aux) – ${reference}`,
    text:
      `Le médecin a transmis le(s) rapport(s) médical(aux) du dossier ${reference} (épreuve « ${eventName} »).\n` +
      `Le dossier contient désormais le rapport d'accident et le rapport médical.\n\nConsulter : ${link}` +
      signature,
  }),
  userInvitation: ({ name, link, role }) => ({
    subject: `[FFSA] Création de votre compte`,
    text:
      `Bonjour ${name},\n\nUn compte « ${role} » a été créé pour vous sur l'application de déclaration ` +
      `des accidents de la FFSA.\n\nDéfinissez votre mot de passe via ce lien (valable 72 h) :\n${link}` +
      signature,
  }),
  signupVerify: ({ name, link }) => ({
    subject: `[FFSA] Confirmez votre adresse e-mail`,
    text:
      `Bonjour ${name},\n\nMerci pour votre inscription comme directeur de course sur l'application de déclaration des accidents de la FFSA.\n\n` +
      `Confirmez votre adresse e-mail via ce lien (valable 48 h) pour activer votre compte :\n${link}` +
      signature,
  }),
  signupExisting: ({ link }) => ({
    subject: `[FFSA] Vous avez déjà un compte`,
    text:
      `Une demande de création de compte a été faite avec votre adresse, mais un compte existe déjà.\n\n` +
      `Pour vous connecter ou choisir un nouveau mot de passe : ${link}` +
      signature,
  }),
  loginCode: ({ code, minutes }) => ({
    subject: `[FFSA] Votre code de connexion : ${code}`,
    text:
      `Votre code de connexion à l'application de déclaration des accidents de la FFSA : ${code}\n\n` +
      `Il est valable ${minutes} minutes. Si vous n'êtes pas à l'origine de cette connexion, changez votre mot de passe.` +
      signature,
  }),
  passwordReset: ({ link }) => ({
    subject: `[FFSA] Réinitialisation de votre mot de passe`,
    text:
      `Une demande de réinitialisation de mot de passe a été effectuée.\n\nLien (valable 1 h) :\n${link}\n\n` +
      `Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.` +
      signature,
  }),
};

module.exports = templates;
