'use strict';

// Textes des SMS : courts, sans donnée de santé ni identité de victime.
module.exports = {
  doctorInvitation: ({ reference, link }) =>
    `FFSA : rapport médical à compléter pour le dossier ${reference}. Lien sécurisé : ${link}`,
  doctorTransfer: ({ reference, link }) =>
    `FFSA : un confrère vous a transmis le rapport médical du dossier ${reference}. Lien sécurisé : ${link}`,
  doctorReminder: ({ reference, link }) =>
    `FFSA (rappel) : le rapport médical du dossier ${reference} est en attente. ${link}`,
  doctorOtp: ({ reference, code }) => `FFSA : votre code de vérification (dossier ${reference}) est ${code}. Valable 10 min.`,
};
