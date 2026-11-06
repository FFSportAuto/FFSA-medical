const { chromium } = require('playwright');
const OUT = process.argv[2] + '/apercu3/img/';
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1.5 })).newPage();
  await p.route(/^https?:/, (r) => r.abort());
  await p.goto('file:///home/user/FFSA-medical/dist-demo/FFSA-demo-interactive.html');
  await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.locator('#demo-help[aria-expanded=true]').click().catch(() => {});
  await p.locator('[data-fill-login]').first().click(); await p.waitForTimeout(200);
  const txt = await p.textContent('#app'); const m = txt.match(/\b(\d{6})\b/);
  if (m && await p.locator('input[name=code]').count()) { await p.fill('input[name=code]', m[1]); await p.locator('#app button[type=submit]').first().click(); }
  await p.waitForTimeout(200);
  await p.locator('#app a[href="/organisateur/rapports/nouveau"]').first().click();
  await p.waitForSelector('.stepper'); await p.click('[data-goto="3"]');
  await p.click('#demo-notes-btn');
  await p.fill('#demo-note-author', 'Paul');
  await p.click('#demo-note-pick'); await p.locator('#app [data-field=equipment1] .label').click();
  await p.fill('#demo-note-text', 'Un tableau par concurrent accidenté, colonnes Présent et Marque / modèle / homologation.'); await p.click('#demo-note-add');
  await p.fill('#demo-note-text', 'Ajouter « Extincteur manuel » à la liste des articles.'); await p.click('#demo-note-add');
  await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '24-notes-reunion.jpg', type: 'jpeg', quality: 82 });
  await b.close();
})();
