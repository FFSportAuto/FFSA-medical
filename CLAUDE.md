# Contexte du projet pour Claude

Ce fichier est lu automatiquement par Claude Code. Il résume le projet et les décisions prises avec le service
médical de la FFSA lors du développement initial, pour qu'une nouvelle session (sur n'importe quel compte) reprenne
le travail sans l'historique de la conversation d'origine.

**Langue** : l'équipe FFSA travaille en français. Répondre, commenter et rédiger la documentation en français.

## Le projet

Application web de la FFSA (Fédération Française du Sport Automobile) :
- les **directeurs de course** déclarent les accidents (compte créé par inscription) ;
- le **médecin de l'épreuve** reçoit un lien sécurisé (48 h, code par e-mail, sans compte) et remplit un rapport
  médical par patient ;
- le **service médical FFSA** consulte les dossiers dans un back office (double authentification obligatoire),
  les exporte en CSV (complet ou pseudonymisé) et en PDF ;
- un **administrateur** gère les comptes, sans accès aux données de santé.

Hébergement prévu chez un hébergeur certifié **HDS**. Voir `README.md` (workflow détaillé),
`docs/MISE-EN-PRODUCTION.md` (guide DSI), `docs/SECURITE-RGPD.md`, `docs/TESTER.md`, `docs/HISTORIQUE.md`
(décisions et retours de réunion).

## Pile technique

- Node 22, Express 5, gabarits EJS côté serveur, JavaScript sans framework (`public/js/app.js`).
- PostgreSQL 16, seul stockage (pièces jointes chiffrées en base, AES-GCM). Schéma idempotent : `src/db/schema.sql`.
- Sécurité : CSRF, helmet (CSP), TOTP, OTP par e-mail, ClamAV pour les pièces jointes, journal d'audit.
- PDF : pdfkit. Livraison : `Dockerfile` + `docker-compose.yml`.

## Architecture à connaître

- **Formulaires pilotés par données** : `src/forms/accident.js`, `src/forms/medical.js`, moteur `src/forms/engine.js`
  (étapes `step`, blocs répétables `repeat`, conditions `showIf`, listes `dropdown`, matrices, `follows`,
  colonnes d'export, brouillons `draftValues` / `draftSummary`). Modifier un formulaire = modifier ces fichiers ;
  vues, validation, exports CSV/PDF et back office suivent.
- `src/forms/patients.js` : personnes déclarées proposées au médecin et pré-remplissage du rapport médical.
- `src/services/reports.js` : création des dossiers, statuts (`awaiting_medical`, `complete`, `no_medical`),
  liens médecin, brouillons. Routes dans `src/routes/` (organizer, doctor, backoffice, auth, account).
- **Démo / version de test statiques** : `scripts/build-static-demo.js` + `scripts/static-demo/runtime.js` simulent
  le serveur dans le navigateur avec les vrais gabarits EJS. `npm run build:demo` produit dans `dist-demo/` :
  - `index.html` et `FFSA-demo-interactive.html` : démo commentée (guide, bandeau, e-mails simulés) ;
  - `FFSA-medical-test.html` : **version de test** fidèle au futur site, sans explications, avec encarts
    « Accès de test » (comptes `directeur.test@ffsa.org`, `medical.test@ffsa.org`, `admin.test@ffsa.org`,
    mot de passe `Test-FFSA-2026!`, accès médecin direct), vrais codes TOTP, vrais exports CSV, bouton « Notes »
    pour recueillir les retours (export .txt).
  Toute route ajoutée côté serveur doit aussi l'être dans `runtime.js`, sinon la démo diverge.
- `scripts/apercu/` : génération d'un aperçu illustré (captures Playwright).

## Travailler sur le projet

```bash
npm ci
createdb ffsa_test && npm test          # ou TEST_DATABASE_URL=postgres://…
DEMO_MODE=true DATABASE_URL=postgres://… npm start   # serveur de démo avec données fictives
npm run build:demo                     # régénère dist-demo/
```

- Après une modification d'écran ou de formulaire : `npm test`, puis `npm run build:demo` et vérifier la version de
  test (Playwright est pratique pour parcourir les écrans).
- Les retours de l'équipe arrivent souvent sous forme de fichier de notes exporté par le bouton « Notes » de la démo
  (écran, élément cliqué, commentaire) : traiter chaque note et l'ajouter à `docs/HISTORIQUE.md`.
- Ne jamais mettre de vraies données de santé dans la démo ou les tests. `DEMO_MODE` est refusé en production.
