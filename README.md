# FFSA – Rapports d'accident & rapports médicaux

Application web de recueil des déclarations d'accident et des rapports médicaux pour la
Fédération Française du Sport Automobile, conçue pour être hébergée sur un serveur **HDS**.

## Workflow

```
Directeur de course ──(1) rapport d'accident──▶ Application ──(2) e-mail lien sécurisé──▶ Médecin
                                                  │                                          │
                                                  │◀──────(3) rapport médical (code e-mail)──┘
                                                  │
                                                  └──(e-mails)──▶ Service médical FFSA ──▶ Back office
```

1. Le **directeur de course** (compte créé par inscription, actif dès la confirmation de son e-mail) remplit le
   rapport d'accident (jusqu'à 3 pilotes/copilotes, 4 autres personnes et 4 témoins). Il indique si le médecin de
   l'épreuve a examiné les personnes accidentées : si oui, avec ses coordonnées ; si non, aucun rapport médical
   n'est demandé (dossier « sans rapport médical »).
2. Le **médecin** reçoit un e-mail et un SMS contenant un lien personnel, **valable 48 heures**. Passé ce délai,
   le formulaire est bloqué : seul le service médical peut envoyer un nouveau lien (au même médecin ou à un autre).
   À l'ouverture, un code à usage unique lui est envoyé par e-mail ; il n'a pas besoin de compte.
3. Le médecin remplit **un rapport médical par patient consulté** (pré-rempli avec l'épreuve et son nom,
   avec rappel de la déclaration d'accident), puis **clôture** le dossier.
4. Le **service médical FFSA** est notifié au dépôt du rapport d'accident, puis lorsque le dossier est
   complet (accident + médical). Il consulte les dossiers dans le **back office**.

Les e-mails ne contiennent **aucune donnée de santé ni l'identité de la victime** : uniquement une
référence de dossier et un lien.

### Fonctionnement détaillé

- **Brouillons automatiques** : la saisie du directeur de course et du médecin est enregistrée (chiffrée) toutes
  les quelques secondes. On peut fermer la page et reprendre plus tard ; brouillons purgés après 30 jours.
  Les pièces jointes ne sont pas conservées dans le brouillon.
- **Reprise des données du directeur de course** : le médecin choisit le patient parmi les personnes déclarées
  (pilotes, copilotes, autres personnes) ; identité, licence, n° de concurrent, catégorie, fonction et coordonnées sont
  pré-remplis, ainsi que l'épreuve, la date et l'heure. Chaque rapport médical est relié à la personne déclarée.
- **Médecin joignable** : lien et code envoyés par e-mail **et par SMS** (portable obligatoire dans le
  formulaire accident).
- **Suivi des dossiers** (back office) : statut de traitement (à analyser / en cours / clos), notes internes
  chiffrées, alerte « en retard » quand le lien du médecin a expiré sans rapport, filtres, tableau triable par
  colonne et tableau de bord.

## Accès des directeurs de course (autonomes)

Les directeurs de course créent leur compte eux-mêmes (« Créer un compte ») : le compte est actif dès que
l'adresse e-mail est confirmée, sans validation par la FFSA.

La connexion avec le compte licencié FFSA (OpenID Connect) reste disponible dans le code, désactivée tant que
`OIDC_ISSUER` n'est pas configuré : voir [`docs/SSO.md`](docs/SSO.md).

## Rôles

| Rôle | Accès |
|---|---|
| Directeur de course | Inscription (compte actif après confirmation de l'e-mail) ; déclarer un accident, suivre ses déclarations (sans accès au rapport médical) |
| Médecin | Lien sécurisé + code e-mail, uniquement pour le dossier concerné, une seule soumission |
| Service médical | Back office : dossiers, suivi, PDF, export CSV, envoi d'un nouveau lien au médecin |
| Administrateur | Gestion des comptes et journal d'audit, **sans accès aux données de santé** |

La double authentification est **obligatoire pour tous** : application d'authentification (TOTP) pour le
back office ; code par e-mail ou application pour les directeurs de course. L'administrateur n'a **aucun accès
aux données de santé** (comptes et journal uniquement).

## Formulaires

Les formulaires reprennent les formulaires Jotform FFSA (accident : 260223577062049, médical :
260263404021340). Ils sont décrits dans `src/forms/accident.js` et `src/forms/medical.js`. Le rendu,
la validation (serveur), les champs conditionnels, l'affichage back office et l'export CSV en
découlent automatiquement : **pour ajouter, retirer ou renommer un champ, il suffit de modifier ces fichiers.**

Types disponibles : `text`, `textarea`, `email`, `tel`, `date`, `time`, `number`, `select`, `radio`,
`checkboxes`, `consent`, `file`, `signature` (tracé, non utilisé actuellement), `matrix` (tableau lignes × colonnes), `heading` (sous-titre).
Une section peut être `optional` (repliée par défaut) ou `shareWithDoctor` (montrée au médecin). Conditions d'affichage :
`showIf: { field, equals }`, `{ field, in: [...] }`, `{ field, includes }` (cases à cocher),
au niveau d'un champ ou d'une section.

Saisie (web et mobile) :
- `step: 'Libellé'` sur chaque section regroupe les sections consécutives en étapes. On obtient une barre de progression, un sommaire cliquable, des boutons « Précédent / Suivant » fixés en bas de l'écran et un récapitulatif avant l'envoi.
- `repeat: { group, addLabel }` affiche un bloc facultatif (pilote, personne, témoin) seulement après un clic sur « + Ajouter… ».
- Champs : `inputmode` (clavier adapté), `sameAs: { field, label }` (bouton « Jour de l'épreuve »…), `autoNow` (date ou heure remplie à la dernière étape), `shortLabel` (libellé court dans le récapitulatif).
- Un `select` d'au plus 5 choix s'affiche en pastilles, sauf avec `dropdown: true` (liste déroulante imposée, comme les listes du tableur FFSA pour les pilotes / copilotes).
- La signature est une case `consent` (« vaut signature »), associée au compte connecté et à l'horodatage de l'envoi.
- Sur mobile, les photos se prennent directement avec l'appareil. Au-delà de 1,5 Mo, elles sont réduites dans le navigateur avant l'envoi.
- Sans JavaScript, le formulaire reste une page unique validée par le serveur.

## Tester l'application (démonstration)

**Démo en un seul fichier** : `npm run build:demo` produit aussi `dist-demo/FFSA-demo-interactive.html`,
un fichier HTML **entièrement autonome** (logo, polices et moteur intégrés, aucune connexion requise).
Il s'ouvre d'un double-clic dans n'importe quel navigateur, s'envoie par e-mail ou se dépose sur
n'importe quel hébergement web (site de la FFSA, intranet…), sans compte ni installation.

**Démo interactive en ligne** : `npm run build:demo` génère dans `dist-demo/` une version autonome
qui s'ouvre dans un navigateur (sans serveur). Elle réutilise les vrais gabarits, formulaires, règles
de validation et styles ; seules la base de données et l'envoi d'e-mails sont simulés (données
fictives conservées dans le navigateur du testeur). À régénérer après chaque modification des formulaires.

**Version complète** (serveur + base de données) :
Le plus simple, sans rien installer : sur GitHub, bouton **Code → Codespaces → Create codespace on
`<branche>`**. L'application démarre seule en **mode démonstration** (voir [`docs/TESTER.md`](docs/TESTER.md)) :
comptes de test affichés sur la page de connexion, code de double authentification affiché à l'écran,
e-mails visibles dans l'application (« Voir les e-mails envoyés ») et deux dossiers d'exemple.

En local : `npm run demo`. Le mode démo (`DEMO_MODE=true`) ne doit **jamais** être activé sur le serveur HDS.

## Export PDF

Dans le back office, chaque dossier se télécharge en PDF : **dossier complet**, **rapport d'accident**
ou **rapport(s) médical(aux)** (un patient par page). La mise en page reprend le modèle FFSA issu de
Jotform : en-tête logo + date, titres bleu marine, rubriques soulignées, filets bleus entre pilotes,
personnes et témoins, certifications (cases « vaut signature »), pied de page FFSA (`src/lib/pdf.js`, ressources dans `assets/pdf/`).
Génération sur le serveur (pdfkit), sans service externe ; chaque téléchargement est tracé dans l'audit.

## Charte graphique

Charte FFSA « maquette bleue » : police Poppins (hébergée localement, aucun appel à Google Fonts),
navy `#070E47`, rouge `#EF1D34`, boutons pilule bleus `#3685D9`, titres sobres en bleu marine,
pastilles de couleur par discipline. Logo et favicon dans `public/img/`.

## Lancer en local

Prérequis : Node.js ≥ 20 et PostgreSQL ≥ 14.

```bash
npm install
createdb ffsa                     # DATABASE_URL par défaut : postgres://postgres@localhost:5432/ffsa
npm run create-user -- admin@ffsa.org "Prénom Nom" admin   # affiche le lien d'activation
npm run dev                       # http://localhost:3000
```

Sans `SMTP_HOST`, les e-mails sont écrits dans `./outbox/` (pratique pour tester le parcours médecin).
Sans `SMS_PROVIDER`, les SMS y sont également écrits. En production : `SMS_PROVIDER=brevo` et `SMS_API_KEY`.

**Délivrabilité des e-mails** : envoyer depuis un domaine FFSA (`MAIL_FROM`) dont les enregistrements
SPF, DKIM et DMARC autorisent le relais SMTP utilisé, sinon les liens envoyés aux médecins risquent
d'arriver en courrier indésirable.

Tests (base `ffsa_test` requise) : `npm test`.

## Déploiement

```bash
cp .env.example .env     # renseigner les secrets (voir commentaires)
docker compose up -d --build
docker compose exec app node scripts/create-user.js admin@ffsa.org "Prénom Nom" admin
```

Guide complet pour la DSI (prérequis HDS, secrets, installation, vérifications, exploitation) : [`docs/MISE-EN-PRODUCTION.md`](docs/MISE-EN-PRODUCTION.md).
Voir [`docs/SECURITE-RGPD.md`](docs/SECURITE-RGPD.md) pour les mesures de sécurité et la check-list d'hébergement.

## Structure

```
src/
  forms/        définitions des formulaires + moteur de validation
  routes/       auth, organisateur, médecin, back office
  services/     logique métier (dossiers, liens médecin, notifications)
  lib/          chiffrement, mots de passe, TOTP, e-mails, audit
  db/           schéma SQL et migration
  views/        gabarits EJS
public/         CSS et JS (champs conditionnels, étapes, vérification en direct, photos)
```
