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
<div id="demo-bar"><span>Démo interactive · données fictives</span><button type="button" class="ghost-btn" id="demo-help" aria-expanded="false" aria-controls="demo-guide">Comment tester</button><button type="button" id="demo-reset">Réinitialiser</button></div>
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
