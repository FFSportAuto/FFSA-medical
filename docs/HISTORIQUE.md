# Historique des décisions

Ce document retrace les demandes du service médical FFSA et les choix faits pendant le développement initial
(octobre-novembre 2026). Les fichiers de notes exportés depuis la démo sont dans `docs/notes-reunion/`, le tableur de
référence du rapport d'accident 2027 dans `docs/sources/`.

## Socle

- Application serveur Node/Express/PostgreSQL, hébergement HDS, chiffrement des données en base.
- Trois profils connectés (directeur de course, service médical, administrateur) et un accès médecin sans compte
  (lien personnel + code par e-mail).
- Démo statique publiable sans serveur, avec un bouton « Notes » qui permet de noter des retours écran par écran
  pendant une réunion et de les exporter en .txt.

## Expérience de saisie (formulaires accident et médical)

- Formulaires découpés en étapes avec barre de progression et récapitulatif « Vérification et envoi ».
- Blocs ajoutés à la demande (« + Ajouter un pilote », etc.) au lieu de blocs vides.
- Dates rapides (aujourd'hui, hier), choix en pastilles, claviers adaptés sur mobile, validation en direct.
- Photos prises directement depuis le téléphone ; formats acceptés indiqués sous chaque champ de fichier.
- Signature : d'abord une case à cocher au lieu d'un dessin, puis supprimée pour le rédacteur du rapport d'accident.
- Brouillon enregistré automatiquement (chiffré, 30 jours) ; les pièces jointes ne sont pas conservées.

## Notes du 22/10/2026

Dix retours sur la démo appliqués (le fichier de notes de cette réunion n'a pas été conservé).

## Tableur 2027 (`docs/sources/RAPPORT_DACCIDENT_FFSA_2027_vf.xlsx`)

- La partie « Personnes accidentées » suit l'ordre des champs du tableur, avec ses listes déroulantes
  (type de véhicule, spécification, catégorie karting, catégorie dragster, etc.).
- Catégorie karting affichée uniquement si le type est « Kart » (idem dragster).

## Notes du 06/11/2026 (`docs/notes-reunion/2026-11-06.txt`)

- ADR : champs « N° de série / référence ADR » et « Données récupérées » (Oui/Non), affichés seulement si le véhicule
  est équipé d'un ADR, et regroupés sous un sous-titre « Enregistreur de données accident (ADR) ».
- N° de concurrent, prénom, nom et licence en tête de bloc, puis sous-partie « Véhicule ».
- « N/A » remplacé par « NSP ».
- Équipement : un tableau par concurrent (19 articles ; colonnes Article / Présent Oui-Non-NSP / Marque, modèle,
  n° d'homologation, ce dernier champ actif seulement si « Oui »).

## Notes du 17/11/2026 (`docs/notes-reunion/2026-11-17.txt`)

- Inscription simplifiée : plus d'ASA, de fonction, d'attestation ni de message ; compte actif dès la confirmation
  de l'adresse e-mail. Connexion « compte licencié FFSA » (SSO) retirée de l'écran (documentée dans `docs/SSO.md`).
- « Date de l'épreuve » devient « Date de l'accident », avec l'heure à côté ; étape « L'accident » supprimée.
- Habitacle : Ouvert / Fermé. Poste de conduite : Centrale / Gauche / Droite.
- Autre personne : Licencié ? Oui → n° de licence + fonction (Directeur de Course, Commissaire Sportif, Commissaire
  de Route / de Piste, Volontaire, Autre) ; Non → e-mail, téléphone, adresse.
- Conditions (état de la piste, météo, revêtement) en choix unique.
- Tableaux d'équipement titrés « Concurrent n° X – Prénom Nom ».
- Champ libre « Circonstances de l'accident » ; formats de fichiers précisés.
- Témoins : e-mail et téléphone facultatifs.
- « Le médecin de l'épreuve a-t-il examiné les personnes accidentées ? » : si Non, aucun rapport médical n'est
  demandé (statut « sans rapport médical »).
- Lien médecin valable 48 h, puis bloqué ; seul le service médical renvoie un lien (même médecin ou autre).
  Transfert à un confrère par le médecin, relances automatiques, médecin fédéral référent et écran « Demandes
  d'accès » supprimés.
- Back office : tableau des dossiers triable ; sous-titres rouges plus grands et plus gras dans toute l'application.
- Pièces jointes testées de bout en bout.
- **RTS (encart spécifique et facultatif) : en attente de précisions de l'équipe FFSA, non développé.**

## Ajouts suivants

- Section « Contact joignable le lundi matin » (nom, prénom, e-mail, téléphone) dans l'étape 1, après l'épreuve et
  avant le médecin.
- Champ « Fonction » retiré de l'inscription.
- Guide de mise en production pour la DSI (`docs/MISE-EN-PRODUCTION.md`).
- Version de test `dist-demo/FFSA-medical-test.html` : identique au futur site, sans explications, avec accès de
  test simplifiés, accès direct au formulaire médical, exports CSV réels.
- Favicon : V tricolore FFSA (`public/img/favicon.png`).
- Branche de développement fusionnée dans `main` le 19/11/2026.

## Notes du 18/11/2026 (`docs/notes-reunion/2026-11-18.txt`)

- En-tête : « Directeur de Course » à la place de l'ASA sous le nom de l'utilisateur.
- Déclaration commencée visible dans « Mes déclarations » (épreuve, étape atteinte, date d'enregistrement) avec
  « Reprendre » (retour à l'étape atteinte) et « Supprimer ». Le formulaire médical reprend aussi à l'étape atteinte.

## Points ouverts

- RTS (voir ci-dessus).
- Validation du texte « Données personnelles » par le DPO (`PRIVACY_VALIDATED=true`).
