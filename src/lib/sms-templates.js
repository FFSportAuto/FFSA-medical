'use strict';

// Textes des SMS : courts, sans donnée de santé ni identité de victime.
module.exports = {
  doctorInvitation: ({ reference, link }) =>
    `FFSA : rapport médical à compléter pour le dossier ${reference}. Lien sécurisé : ${link}`,
  doctorOtp: ({ reference, code }) => `FFSA : votre code de vérification (dossier ${reference}) est ${code}. Valable 10 min.`,
};
