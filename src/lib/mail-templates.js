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
      `Ce lien est personnel et valable jusqu'au ${expiresAt}.` +
      signature,
  }),
  doctorTransfer: ({ reference, eventName, link, expiresAt }) => ({
    subject: `[FFSA] Rapport médical à compléter – dossier ${reference} (transmis par un confrère)`,
    text:
      `Bonjour Docteur,\n\n` +
      `Un confrère vous a transmis la rédaction du rapport médical relatif à l'épreuve « ${eventName} » ` +
      `(dossier ${reference}). Merci de remplir un formulaire par patient consulté via le lien sécurisé ci-dessous :\n${link}\n\n` +
      `Un code de vérification vous sera envoyé à l'ouverture du lien. Ce lien est personnel et valable jusqu'au ${expiresAt}.` +
      signature,
  }),
  doctorReminder: ({ reference, eventName, link }) => ({
    subject: `[FFSA] Rappel – rapport médical en attente – dossier ${reference}`,
    text:
      `Bonjour Docteur,\n\nLe rapport médical relatif à l'épreuve « ${eventName} » (dossier ${reference}) ` +
      `n'a pas encore été complété.\n\nLien sécurisé :\n${link}` +
      signature,
  }),
  doctorOtp: ({ reference, code }) => ({
    subject: `[FFSA] Code de vérification – dossier ${reference}`,
    text: `Votre code de vérification : ${code}\n\nIl est valable 10 minutes.` + signature,
  }),
  organizerConfirmation: ({ reference, eventName }) => ({
    subject: `[FFSA] Rapport d'accident enregistré – dossier ${reference}`,
    text:
      `Bonjour,\n\nVotre rapport d'accident pour l'épreuve « ${eventName} » a bien été enregistré ` +
      `sous la référence ${reference}.\nLe médecin désigné a été invité à compléter le rapport médical.` +
      signature,
  }),
  serviceNewAccident: ({ reference, eventName, link }) => ({
    subject: `[FFSA] Nouveau rapport d'accident – ${reference}`,
    text:
      `Un nouveau rapport d'accident a été déposé (épreuve « ${eventName} », dossier ${reference}).\n` +
      `Le rapport médical a été demandé au médecin intervenant.\n\nConsulter : ${link}` +
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
      `Bonjour ${name},\n\nMerci pour votre demande de compte organisateur sur l'application de déclaration des accidents de la FFSA.\n\n` +
      `Confirmez votre adresse e-mail via ce lien (valable 48 h) :\n${link}\n\n` +
      `Votre demande sera ensuite examinée par la FFSA ; vous serez prévenu(e) par e-mail.` +
      signature,
  }),
  signupExisting: ({ link }) => ({
    subject: `[FFSA] Vous avez déjà un compte`,
    text:
      `Une demande de création de compte a été faite avec votre adresse, mais un compte existe déjà.\n\n` +
      `Pour vous connecter ou choisir un nouveau mot de passe : ${link}` +
      signature,
  }),
  signupToReview: ({ name, organization, link }) => ({
    subject: `[FFSA] Nouvelle demande d'accès organisateur à valider`,
    text: `${name} (${organization}) demande un compte organisateur.\n\nExaminer la demande : ${link}` + signature,
  }),
  signupApproved: ({ name, link }) => ({
    subject: `[FFSA] Votre compte organisateur est activé`,
    text: `Bonjour ${name},\n\nVotre compte organisateur a été validé par la FFSA. Vous pouvez vous connecter :\n${link}` + signature,
  }),
  signupRejected: ({ name, reason }) => ({
    subject: `[FFSA] Votre demande de compte organisateur`,
    text:
      `Bonjour ${name},\n\nVotre demande de compte organisateur n'a pas été acceptée.` +
      (reason ? `\n\nMotif : ${reason}` : '') +
      `\n\nPour toute question, contactez le service médical de la FFSA.` +
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
