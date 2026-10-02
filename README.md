# FFSA – Rapports d'accident & rapports médicaux

Application web de recueil des déclarations d'accident et des rapports médicaux pour la
Fédération Française du Sport Automobile, conçue pour être hébergée sur un serveur **HDS**.

## Workflow

```
Organisateur ──(1) rapport d'accident──▶ Application ──(2) e-mail lien sécurisé──▶ Médecin
                                           │                                          │
                                           │◀──────(3) rapport médical (code e-mail)──┘
                                           │
                                           └──(e-mails)──▶ Service médical FFSA ──▶ Back office
```

1. L'**organisateur** (compte créé par la FFSA) remplit le rapport d'accident, dont les coordonnées
   du médecin intervenant.
2. Le **médecin** reçoit un e-mail contenant un lien personnel (valable 14 jours, relance automatique
   après 48 h). À l'ouverture, un code à usage unique lui est envoyé par e-mail ; il n'a pas besoin de compte.
3. Le médecin remplit le rapport médical (pré-rempli avec ses coordonnées, avec rappel de l'accident).
4. Le **service médical FFSA** est notifié au dépôt du rapport d'accident, puis lorsque le dossier est
   complet (accident + médical). Il consulte les dossiers dans le **back office**.

Les e-mails ne contiennent **aucune donnée de santé ni l'identité de la victime** : uniquement une
référence de dossier et un lien.

## Rôles

| Rôle | Accès |
|---|---|
| Organisateur | Déclarer un accident, suivre ses déclarations (sans accès au rapport médical) |
| Médecin | Lien sécurisé + code e-mail, uniquement pour le dossier concerné, une seule soumission |
| Service médical | Back office : liste/filtres, dossier complet, pièces jointes, export CSV, relance du médecin |
| Administrateur | Idem + gestion des comptes et journal d'audit |

La double authentification (TOTP : Google/Microsoft Authenticator, FreeOTP…) est **obligatoire**
pour le back office et facultative pour les organisateurs.

## Formulaires

Les formulaires sont décrits dans `src/forms/accident.js` et `src/forms/medical.js`. Le rendu,
la validation (serveur), les champs conditionnels, l'affichage back office et l'export CSV en
découlent automatiquement : **pour ajouter, retirer ou renommer un champ, il suffit de modifier ces fichiers.**

Types disponibles : `text`, `textarea`, `email`, `tel`, `date`, `time`, `number`, `select`, `radio`,
`checkboxes`, `consent`, `file`, `signature`. Conditions d'affichage :
`showIf: { field, equals }`, `{ field, in: [...] }`, `{ field, includes }` (cases à cocher),
au niveau d'un champ ou d'une section.

## Lancer en local

Prérequis : Node.js ≥ 20 et PostgreSQL ≥ 14.

```bash
npm install
createdb ffsa                     # DATABASE_URL par défaut : postgres://postgres@localhost:5432/ffsa
npm run create-user -- admin@ffsa.org "Prénom Nom" admin   # affiche le lien d'activation
npm run dev                       # http://localhost:3000
```

Sans `SMTP_HOST`, les e-mails sont écrits dans `./outbox/` (pratique pour tester le parcours médecin).

Tests (base `ffsa_test` requise) : `npm test`.

## Déploiement

```bash
cp .env.example .env     # renseigner les secrets (voir commentaires)
docker compose up -d --build
docker compose exec app node scripts/create-user.js admin@ffsa.org "Prénom Nom" admin
```

Voir [`docs/HDS.md`](docs/HDS.md) pour les mesures de sécurité et la check-list d'hébergement.

## Structure

```
src/
  forms/        définitions des formulaires + moteur de validation
  routes/       auth, organisateur, médecin, back office
  services/     logique métier (dossiers, liens médecin, relances, notifications)
  lib/          chiffrement, mots de passe, TOTP, e-mails, audit
  db/           schéma SQL et migration
  views/        gabarits EJS
public/         CSS et JS (champs conditionnels, signature)
```
