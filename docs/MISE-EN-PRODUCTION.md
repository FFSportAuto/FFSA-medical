# Mise en production – guide pour la DSI

Ce document décrit ce qu'il faut pour héberger l'application chez un hébergeur certifié HDS et l'exploiter.
Les mesures de sécurité et les obligations RGPD (DPO) sont détaillées dans [`SECURITE-RGPD.md`](SECURITE-RGPD.md).

## 1. L'application en bref

| | |
|---|---|
| Code | Dépôt GitHub `FFSportAuto/FFSA-medical`, branche `main` |
| Langage | Node.js 22 (Express 5, gabarits EJS côté serveur, sans framework front) |
| Base de données | PostgreSQL 16 : **seul stockage**, pièces jointes comprises (chiffrées dans la base) |
| Antivirus | ClamAV (conteneur `clamav/clamav`), interrogé pour chaque pièce jointe |
| Livraison | `Dockerfile` + `docker-compose.yml` (application, PostgreSQL, ClamAV) |
| Tâches planifiées | Dans le processus de l'application, chaque heure : relances des médecins, purge des brouillons (30 jours) et des dossiers expirés (10 ans) |
| Santé | `GET /sante` (utilisé par le `HEALTHCHECK` Docker) |

Le schéma de la base est créé ou mis à jour automatiquement au démarrage (`src/db/schema.sql`, idempotent).

**Une seule instance applicative** : les tâches planifiées tournent dans le processus. Pour plusieurs instances,
désactiver les tâches sur toutes sauf une (évolution à prévoir) ; une instance suffit pour le volume attendu.

**Données existantes** : aucune. Les données de la démonstration sont fictives et ne doivent pas être reprises.
La production démarre sur une base vide. `DEMO_MODE` ne doit jamais être activé : l'application refuse de démarrer
en production avec ce mode.

## 2. Ce que la DSI doit prévoir

**Infrastructure (hébergeur certifié HDS, données dans l'EEE)**
- Une VM Linux avec Docker et Docker Compose, ou une offre de conteneurs équivalente : 2 vCPU et 4 Go de RAM suffisent (ClamAV consomme environ 1,5 Go).
- PostgreSQL 16 : conteneur fourni ou base managée de l'hébergeur. Le compte utilisé par l'application ne doit pas avoir de droits d'administration (pas de `TRUNCATE`, pas de modification des déclencheurs).
- Un reverse proxy TLS (Caddy, Traefik, Nginx ou équivalent de l'hébergeur) devant le port 3000, qui n'est exposé qu'en local.
- Un nom de domaine, par exemple `medical.ffsa.org`.
- Un coffre de secrets pour la clé de chiffrement.
- Des sauvegardes PostgreSQL chiffrées, testées par une restauration.

**Services externes**
- **Relais SMTP** d'envoi depuis un domaine FFSA, avec SPF, DKIM et DMARC à jour : sinon les liens envoyés aux médecins arrivent en courrier indésirable.
- **SMS** (facultatif) : compte Brevo (`SMS_PROVIDER=brevo`) pour envoyer le lien et le code au portable du médecin.
- **Connexion avec le compte licencié FFSA** (facultatif) : un client OpenID Connect sur le fournisseur d'identité des licenciés. URL de retour à déclarer : `<BASE_URL>/connexion/sso/retour`. Détails : [`SSO.md`](SSO.md). Sans lui, les directeurs de course créent un compte validé par la FFSA.

## 3. Installation

```bash
git clone https://github.com/FFSportAuto/FFSA-medical.git && cd FFSA-medical
cp .env.example .env            # renseigner chaque variable, voir les commentaires du fichier
```

Secrets à générer (à ne jamais versionner) :

```bash
openssl rand -base64 48         # SESSION_SECRET
openssl rand -base64 32         # clé de chiffrement → DATA_ENCRYPTION_KEY_FILE (coffre) ou DATA_ENCRYPTION_KEY
openssl rand -base64 24         # POSTGRES_PASSWORD (et dans DATABASE_URL)
```

**La clé de chiffrement est critique** : sans elle, les données sauvegardées sont illisibles. Elle est conservée à part
des sauvegardes, dans le coffre de secrets, avec une copie de secours sous la responsabilité de la DSI.

Variables à renseigner en priorité : `BASE_URL`, `DATABASE_URL`, `SESSION_SECRET`, la clé de chiffrement,
`SMTP_*` et `MAIL_FROM`, `MEDICAL_SERVICE_EMAILS` (adresses prévenues à chaque dossier), `APPROVER_EMAILS`
(validation des demandes d'accès), `PRIVACY_*` (texte de la page « Données personnelles », à valider par le DPO).

```bash
docker compose up -d --build
docker compose exec app node scripts/create-user.js admin@ffsa.org "Prénom Nom" admin
docker compose exec app node scripts/create-user.js medecin.federal@ffsa.org "Prénom Nom" medical
```

Chaque compte reçoit un lien d'activation par e-mail. La double authentification (application d'authentification)
est activée à la première connexion. Rôles : `admin` gère les comptes sans accès aux données de santé, `medical`
(service médical) accède aux dossiers. Les comptes des directeurs de course se créent seuls (compte licencié ou
inscription validée).

## 4. Vérifications après la mise en ligne

- [ ] HTTPS valide, redirection HTTP vers HTTPS, en-tête HSTS présent.
- [ ] Connexion de l'administrateur et du service médical, double authentification activée.
- [ ] Déclaration d'un accident de test : e-mails reçus par le médecin et par le service médical (hors courrier indésirable), SMS si activé.
- [ ] Parcours médecin : lien, code, rapport, « J'ai terminé ».
- [ ] Pièce jointe saine acceptée ; fichier de test EICAR refusé ; antivirus arrêté = pièce jointe refusée.
- [ ] Téléchargement du dossier en PDF, export CSV.
- [ ] Page `/donnees-personnelles` avec le texte validé par le DPO (`PRIVACY_VALIDATED=true`).
- [ ] Suppression du dossier de test.
- [ ] Sauvegarde puis restauration de la base sur un environnement de test, avec la clé de chiffrement.

## 5. Exploitation

| Sujet | Mode opératoire |
|---|---|
| Mise à jour | `git pull` puis `docker compose up -d --build` (le schéma se met à jour au démarrage) |
| Sauvegardes | `pg_dump` chiffré quotidien, conservation selon la politique de l'hébergeur ; la base contient aussi les pièces jointes |
| Rotation de la clé | `DATA_ENCRYPTION_KEYS=1:<ancienne>,2:<nouvelle>` puis `docker compose exec app npm run rotate-key` |
| Journal d'audit | Table `audit_log`, en ajout seul ; à exporter vers l'outil de supervision |
| Journaux applicatifs | Sortie standard du conteneur (`docker compose logs app`) |
| Comptes | Ajout, désactivation et réinitialisation de la double authentification depuis le back office (rôle administrateur) |

## 6. Tests

```bash
npm ci
createdb ffsa_test               # ou TEST_DATABASE_URL=postgres://…
npm test
```

À exécuter avant chaque mise en production (intégration continue recommandée).

## 7. Démonstration

`npm run build:demo` produit une démo autonome (`dist-demo/`) qui tourne entièrement dans le navigateur, avec des
données fictives. Elle peut être publiée sur n'importe quel hébergement statique, hors HDS, et n'a aucun lien avec
la production.
