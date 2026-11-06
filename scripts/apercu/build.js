// Construit l'aperçu : index.html (artifact, fichiers à côté) et FFSA-apercu.html (fichier unique autonome)
const fs = require('fs');
const path = require('path');
const DIR = process.argv[2];
const FONTS = '/home/user/FFSA-medical/public/fonts';
const src = fs.readFileSync(path.join(DIR, 'src.html'), 'utf8');
const uri = (file, mime) => `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;

const artifact = src
  .replace('<!--FONTS-->', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap">')
  .split('{{DEMO_URL}}').join('https://claude.ai/artifact/7nwdS8KUcja4E7XK4iVB6S');
fs.writeFileSync(path.join(DIR, 'index.html'), artifact);

const faces = [400, 500, 600, 700].map((w) => `@font-face{font-family:Poppins;font-style:normal;font-weight:${w};font-display:swap;src:url(${uri(path.join(FONTS, `poppins-latin-${w}-normal.woff2`), 'font/woff2')}) format("woff2")}`).join('\n');
let body = src
  .replace('<!--FONTS-->', () => `<style>\n${faces}\n</style>`)
  .split('{{DEMO_URL}}').join('FFSA-demo-interactive.html')
  .replace(/ data-full="[^"]*"/g, '')
  .replace(/ loading="lazy"/g, '');
body = body.replace(/(src=")img\/([\w.-]+)(")/g, (m, a, f, c) => a + uri(path.join(DIR, 'img', f), f.endsWith('.png') ? 'image/png' : 'image/jpeg') + c);
const head = body.slice(0, body.indexOf('<div class="band">'));
const rest = body.slice(body.indexOf('<div class="band">'));
const standalone = `<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="robots" content="noindex, nofollow">\n<link rel="icon" type="image/png" href="${uri('/home/user/FFSA-medical/public/img/favicon.png', 'image/png')}">\n${head}</head>\n<body>\n${rest}</body>\n</html>\n`;
if (/src="img\/|url\(fonts\/|https:\/\/fonts\./.test(standalone)) throw new Error('ressource externe restante');
fs.writeFileSync(path.join(DIR, 'FFSA-apercu.html'), standalone);
console.log('index.html', Math.round(artifact.length / 1024), 'Ko · FFSA-apercu.html', Math.round(standalone.length / 1024), 'Ko');
