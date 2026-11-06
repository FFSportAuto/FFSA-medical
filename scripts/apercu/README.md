# Aperçu illustré (captures d'écran)

Page de présentation de l'application, écran par écran. Les captures sont refaites à partir de la démo.

1. Lancer l'application en mode démonstration sur une base vide : `DATABASE_URL=… DEMO_MODE=true npm start`
2. `node scripts/build-static-demo.js` (la capture des notes utilise la démo autonome)
3. Dans un dossier de travail `<dir>` : `node scripts/apercu/mkphoto.js <dir>/apercu3/photo-piste.jpg`,
   puis `node scripts/apercu/shots.js <dir>` et `node scripts/apercu/shot-notes.js <dir>` (Playwright) :
   images dans `<dir>/apercu3/img/`
4. Copier `src.html` dans `<dir>/apercu3/` et le logo dans `<dir>/apercu3/img/`, puis `node scripts/apercu/build.js <dir>/apercu3`

Résultat :
- `index.html` : version en ligne, avec les images à côté ;
- `FFSA-apercu.html` : fichier unique autonome, sans compte ni connexion. À placer à côté de `FFSA-demo-interactive.html`.
