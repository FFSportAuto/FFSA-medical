'use strict';

// Génère la démo interactive autonome (dist-demo/) à partir des vrais gabarits, formulaires et styles.
//   node scripts/build-static-demo.js
// Le résultat se publie tel quel (page HTML + dossier static/) sur n'importe quel hébergement statique.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist-demo');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function walk(dir, base = dir, out = {}) {
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) walk(full, base, out);
    else if (f.endsWith('.ejs')) out[path.relative(base, full).replace(/\\/g, '/').replace(/\.ejs$/, '')] = fs.readFileSync(full, 'utf8');
  }
  return out;
}

const templates = walk(path.join(ROOT, 'src/views'));
const modules = {
  engine: read('src/forms/engine.js'),
  accident: read('src/forms/accident.js'),
  medical: read('src/forms/medical.js'),
  'mail-templates': read('src/lib/mail-templates.js'),
  'sms-templates': read('src/lib/sms-templates.js'),
  patients: read('src/forms/patients.js'),
  'signup-rules': read('src/services/signup-rules.js'),
};
const moduleJs = Object.entries(modules)
  .map(([name, src]) => `${JSON.stringify(name)}: function (module, exports, require) {\n${src}\n}`)
  .join(',\n');

// Les gabarits sont injectés en JSON : on neutralise toute fermeture de balise script
const safeJson = (v) => JSON.stringify(v).replace(/<\//g, '<\\/');
const css = read('public/css/style.css').split('url(/static/').join('url(static/');

const html = `<title>FFSA Médical – démo</title>
<style>
${css}
#demo-bar { position: fixed; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); z-index: 50; display: flex; align-items: center; gap: 10px; background: var(--navy); color: #fff; border-radius: 999px; padding: 6px 6px 6px 16px; box-shadow: 0 6px 24px rgba(7, 14, 71, .3); font-size: 12px; font-weight: 600; }
#demo-bar button { font: 700 11px/1 var(--font); text-transform: uppercase; letter-spacing: .4px; background: var(--red); color: #fff; border: 0; border-radius: 999px; padding: 9px 14px; cursor: pointer; }
#demo-bar button:hover { background: var(--red-dark); }
#demo-bar .ghost-btn { background: transparent; border: 1px solid rgba(255, 255, 255, .35); }
#demo-bar .ghost-btn:hover { background: rgba(255, 255, 255, .12); }
#demo-guide { position: fixed; right: 16px; bottom: calc(72px + env(safe-area-inset-bottom, 0px)); z-index: 50; width: min(380px, calc(100vw - 32px)); background: var(--surface); border: 1px solid var(--border); border-radius: 16px; box-shadow: 0 12px 40px rgba(7, 14, 71, .22); padding: 20px; font-size: 13.5px; }
#demo-guide h2 { font-size: 17px; margin: 0 0 4px; }
#demo-guide p { color: var(--muted); margin: 0 0 12px; }
#demo-guide ol { margin: 0; padding-left: 20px; display: grid; gap: 8px; }
#demo-guide li::marker { color: var(--red); font-weight: 700; }
#demo-guide b { color: var(--navy); }
#demo-bar .notes-btn { position: relative; }
#demo-notes-count { position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: #fff; color: var(--navy); font-size: 10px; line-height: 18px; text-align: center; }
#demo-notes { position: fixed; right: 16px; bottom: calc(72px + env(safe-area-inset-bottom, 0px)); z-index: 50; width: min(400px, calc(100vw - 32px)); max-height: calc(100vh - 110px); display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; box-shadow: 0 12px 40px rgba(7, 14, 71, .22); font-size: 13.5px; }
#demo-notes[hidden] { display: none; }
#demo-notes .dn-head { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px 0; }
#demo-notes h2 { font-size: 17px; margin: 0; }
#demo-notes .dn-close { background: none; border: 0; font-size: 22px; line-height: 1; color: var(--muted); cursor: pointer; padding: 4px; }
#demo-notes .dn-form { padding: 10px 20px 14px; border-bottom: 1px solid var(--border); display: grid; gap: 8px; }
#demo-notes .dn-screen { color: var(--muted); font-size: 12.5px; }
#demo-notes .dn-screen b { color: var(--navy); }
#demo-notes textarea, #demo-notes input { width: 100%; box-sizing: border-box; font: inherit; border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; background: var(--surface); color: inherit; }
#demo-notes textarea { min-height: 76px; resize: vertical; }
#demo-notes .dn-target { display: flex; gap: 8px; align-items: center; background: rgba(229, 0, 30, .07); border-radius: 8px; padding: 6px 10px; font-size: 12.5px; }
#demo-notes .dn-target span { flex: 1; }
#demo-notes .dn-target[hidden] { display: none; }
#demo-notes .dn-target button { background: none; border: 0; color: var(--muted); cursor: pointer; font-size: 16px; }
#demo-notes .dn-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
#demo-notes .dn-row button { font: 600 12px/1 var(--font); border-radius: 999px; padding: 9px 14px; cursor: pointer; border: 1px solid var(--border); background: var(--surface); color: var(--navy); }
#demo-notes .dn-row button.dn-primary { background: var(--red); border-color: var(--red); color: #fff; }
#demo-notes .dn-row button.dn-confirm { background: var(--navy); border-color: var(--navy); color: #fff; }
#demo-notes .dn-hint { color: var(--muted); font-size: 11.5px; }
#demo-notes-list { list-style: none; margin: 0; padding: 6px 20px; overflow: auto; flex: 1; min-height: 60px; }
#demo-notes-list li { padding: 10px 0; border-bottom: 1px solid var(--border); }
#demo-notes-list li:last-child { border-bottom: 0; }
#demo-notes-list .dn-meta { font-size: 12px; color: var(--muted); }
#demo-notes-list .dn-meta b { color: var(--navy); }
#demo-notes-list .dn-el { font-size: 12px; color: var(--red); margin-top: 2px; }
#demo-notes-list .dn-text { white-space: pre-wrap; margin-top: 4px; }
#demo-notes-list .dn-actions { display: flex; gap: 14px; margin-top: 4px; font-size: 12px; }
#demo-notes-list .dn-empty { color: var(--muted); border: 0; }
#demo-notes .dn-foot { padding: 12px 20px 16px; border-top: 1px solid var(--border); }
#demo-notes-status { color: var(--muted); font-size: 12px; }
body.dn-picking #app, body.dn-picking #app * { cursor: crosshair !important; }
.dn-hover { outline: 2px solid var(--red) !important; outline-offset: 2px; }
body.dn-picking #demo-bar::after { content: "Cliquez sur l'élément concerné · Échap pour annuler"; position: absolute; right: 0; bottom: calc(100% + 8px); white-space: nowrap; background: var(--red); color: #fff; border-radius: 999px; padding: 8px 14px; }
main.wrap { padding-bottom: 110px; }
[data-print] { display: none !important; }
@media (max-width: 600px) { #demo-bar span { display: none; } }
</style>
<div id="app"></div>
<aside id="demo-guide" hidden aria-labelledby="demo-guide-title">
  <h2 id="demo-guide-title">Comment tester</h2>
  <p>Démo avec des données fictives, enregistrées uniquement dans votre navigateur.</p>
  <ol>
    <li>Sur la page de connexion, cliquez sur <b>Utiliser</b> à côté du compte <b>Organisateur</b>, puis <b>Déclarer un accident</b>.</li>
    <li>Ouvrez <b>Voir les e-mails envoyés</b> (bandeau jaune) et cliquez sur le lien reçu par le médecin.</li>
    <li>Demandez le code, retrouvez-le dans les e-mails, puis saisissez un <b>rapport par patient</b> et cliquez sur <b>J'ai terminé</b>.</li>
    <li>Déconnectez-vous et entrez avec le compte <b>Service médical</b> (le code de double authentification est affiché) pour consulter le dossier.</li>
  </ol>
</aside>
<section id="demo-notes" hidden aria-labelledby="demo-notes-title">
  <div class="dn-head"><h2 id="demo-notes-title">Notes de réunion</h2><button type="button" class="dn-close" id="demo-notes-close" aria-label="Fermer">×</button></div>
  <div class="dn-form">
    <div class="dn-screen">Écran : <b id="demo-note-screen"></b></div>
    <div class="dn-target" id="demo-note-target" hidden>Élément : <span></span><button type="button" aria-label="Retirer l'élément">×</button></div>
    <textarea id="demo-note-text" placeholder="Votre remarque sur cet écran (modification, question, idée…)"></textarea>
    <input id="demo-note-author" placeholder="Votre nom (facultatif)" autocomplete="name">
    <div class="dn-row"><button type="button" class="dn-primary" id="demo-note-add">Ajouter la note</button><button type="button" id="demo-note-pick">Désigner un élément</button></div>
    <div class="dn-hint">Ctrl + Entrée pour ajouter. Les notes sont gardées dans ce navigateur, même après « Réinitialiser ».</div>
  </div>
  <ol id="demo-notes-list"></ol>
  <div class="dn-foot">
    <div class="dn-row"><button type="button" class="dn-primary" id="demo-notes-download">Télécharger (.txt)</button><button type="button" id="demo-notes-copy">Copier</button><button type="button" id="demo-notes-clear">Tout effacer</button></div>
    <div id="demo-notes-status" role="status" aria-live="polite"></div>
  </div>
</section>
<div id="demo-bar"><span>Démo interactive · données fictives</span><button type="button" class="ghost-btn notes-btn" id="demo-notes-btn" aria-expanded="false" aria-controls="demo-notes">Notes<b id="demo-notes-count" hidden></b></button><button type="button" class="ghost-btn" id="demo-help" aria-expanded="false" aria-controls="demo-guide">Comment tester</button><button type="button" id="demo-reset">Réinitialiser</button></div>
<script src="https://cdn.jsdelivr.net/npm/ejs@6.0.1/ejs.min.js"></script>
<script>
var TEMPLATES = ${safeJson(templates)};
var APP_JS = ${safeJson(read('public/js/app.js'))};
var MODULES = {
${moduleJs}
};
${read('scripts/static-demo/runtime.js')}
</script>
`;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'static/fonts'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'static/img'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), html);
for (const f of fs.readdirSync(path.join(ROOT, 'public/fonts'))) {
  fs.copyFileSync(path.join(ROOT, 'public/fonts', f), path.join(OUT, 'static/fonts', f));
}
for (const f of ['logo-ffsa.png', 'favicon.png']) {
  fs.copyFileSync(path.join(ROOT, 'public/img', f), path.join(OUT, 'static/img', f));
}
console.log(`Démo générée dans ${path.relative(ROOT, OUT)}/ (${Math.round(html.length / 1024)} Ko)`);

// ---- Version autonome : un seul fichier HTML, sans dépendance ni connexion ----
// À ouvrir d'un double-clic, envoyer par e-mail ou déposer sur n'importe quel hébergement statique.
const dataUri = (file, mime) => `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
let standaloneCss = css;
for (const f of fs.readdirSync(path.join(ROOT, 'public/fonts')).filter((x) => x.endsWith('.woff2'))) {
  standaloneCss = standaloneCss.split(`url(static/fonts/${f})`).join(`url(${dataUri(path.join(ROOT, 'public/fonts', f), 'font/woff2')})`);
}
const assets = {
  'img/logo-ffsa.png': dataUri(path.join(ROOT, 'public/img/logo-ffsa.png'), 'image/png'),
  'img/favicon.png': dataUri(path.join(ROOT, 'public/img/favicon.png'), 'image/png'),
};
const ejsLib = fs.readFileSync(path.join(ROOT, 'node_modules/ejs/ejs.min.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const standalone = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" type="image/png" href="${assets['img/favicon.png']}">
${html
  .replace(css, () => standaloneCss)
  .replace('<script src="https://cdn.jsdelivr.net/npm/ejs@6.0.1/ejs.min.js"></script>', () => `<script>/* EJS 6.0.1 – Apache-2.0 – https://ejs.co */\n${ejsLib}</script>\n<script>var DEMO_ASSETS = ${JSON.stringify(assets)};</script>`)
  .replace('<div id="app"></div>', () => '</head>\n<body>\n<div id="app"></div>')}
</body>
</html>
`;
if (standalone.includes('cdn.jsdelivr') || standalone.includes('url(static/')) throw new Error('Ressource externe restante dans la version autonome');
const STANDALONE = path.join(OUT, 'FFSA-demo-interactive.html');
fs.writeFileSync(STANDALONE, standalone);
console.log(`Version autonome : ${path.relative(ROOT, STANDALONE)} (${Math.round(standalone.length / 1024)} Ko)`);
