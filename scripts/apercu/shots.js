const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2] + '/apercu3/img/';
const B = 'http://localhost:3000';
const SUB = 'main button.btn.primary[type=submit]';
const log = (...a) => console.log(...a);
const shot = async (p, name, opts = {}) => { await p.waitForTimeout(250); await p.screenshot({ path: OUT + name + '.jpg', type: 'jpeg', quality: 82, ...opts }); log('shot', name); };
const elShot = async (p, sel, name) => { await p.waitForTimeout(250); await p.locator(sel).first().screenshot({ path: OUT + name + '.jpg', type: 'jpeg', quality: 82 }); log('shot', name); };
const top = async (p, sel, off = 16) => { await p.evaluate(([s, o]) => { const el = document.querySelector(s); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - o); }, [sel, off]); await p.waitForTimeout(150); };
const mfa = async (p) => { await p.waitForURL('**/2fa'); await p.fill('#code', (await p.textContent('.alert.info strong')).trim()); await p.click(SUB); };
const mails = async (p) => { await p.goto(B + '/demo/emails'); return p.evaluate(() => [...document.querySelectorAll('article.mail')].map((a) => a.innerText)); };
const outboxLink = (ref) => { const dir = '/home/user/FFSA-medical/outbox/'; return fs.readdirSync(dir).sort().reverse().map((f) => fs.readFileSync(dir + f, 'utf8')).filter((t) => t.includes(ref) && t.includes('/medecin/')).map((t) => t.match(/http:\/\/localhost:3000\/medecin\/[\w-]+/)[0])[0]; };
const hideNav = (p) => p.addStyleTag({ content: '.step-nav{position:static !important}' });

(async () => {
  const b = await chromium.launch();
  const desk = await b.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1.5, bypassCSP: true });
  const p = await desk.newPage();
  p.on('pageerror', (e) => log('PAGEERROR', e.message));

  // ---- Connexion, portail licencié, inscription
  await p.goto(B + '/connexion'); await shot(p, '01-connexion');
  await p.click('a.btn.sso'); await p.waitForURL('**/authorize**'); await shot(p, '02-portail-licencie');
  await p.goto(B + '/inscription');
  await p.fill('#s_last_name', 'Moreau'); await p.fill('#s_first_name', 'Julie'); await p.fill('#s_email', 'julie.moreau@club-exemple.fr'); await p.fill('#s_phone', '06 98 76 54 32');
  await p.fill('#s_organization', 'Écurie du Val'); await p.selectOption('#s_job_title', { index: 1 }); await p.fill('#s_message', 'Direction de course du slalom du Val en juin.');
  await shot(p, '03-inscription');
  await p.fill('#s_password', 'Motdepasse-Solide-2026'); await p.fill('#s_confirm', 'Motdepasse-Solide-2026'); await p.check('input[name=terms]');
  await p.click('form.signup-form button[type=submit]'); await p.waitForTimeout(400);
  const conf = (await mails(p)).find((t) => /Confirmez votre adresse/.test(t)).match(/\/inscription\/confirmer\/\S+/)[0]; await p.goto(B + conf);

  // ---- Directeur de course
  await p.goto(B + '/connexion'); await p.click('[data-fill-login="directeur@demo.ffsa.fr"]'); await p.waitForURL('**/2fa');
  await shot(p, '04-code-connexion');
  await mfa(p); await p.waitForURL('**/organisateur'); await shot(p, '05-mes-declarations');
  await p.goto(B + '/organisateur/rapports/nouveau');
  await p.fill('#f_league', 'Nouvelle-Aquitaine'); await p.fill('#f_asa', 'ASA Vienne'); await p.fill('#f_as_code', '0412'); await p.fill('#f_visa_number', 'R-2026-118');
  await p.fill('#f_event_name', 'Trophée de l’Ouest'); await p.fill('#f_event_location', 'Circuit du Val de Vienne'); await p.selectOption('#f_discipline', 'Circuit asphalte'); await p.selectOption('#f_event_level', 'Épreuve régionale'); await p.fill('#f_event_date', '2026-10-04');
  await p.fill('[name=casualties__0__0]', '1'); await p.fill('[name=casualties__3__0]', '1');
  await p.fill('#f_doctor_first_name', 'Claire'); await p.fill('#f_doctor_last_name', 'Moreau'); await p.fill('#f_doctor_email', 'dr.moreau@exemple.fr'); await p.fill('#f_doctor_phone', '06 11 22 33 44');
  await top(p, '.stepper'); await shot(p, '06-etapes'); await hideNav(p);
  await p.click('[data-next]');
  await p.fill('#f_summary_victim_last_name', 'Girard'); await p.fill('#f_summary_victim_first_name', 'Thomas'); await p.fill('#f_summary_victim_license', '254781');
  await p.locator('[data-field=accident_date] .quick-btn:has-text("Jour de")').click(); await p.fill('#f_accident_time', '11:20');
  await p.fill('#f_circumstances', 'Perte de contrôle au freinage du virage n°4, sortie dans le bac à graviers puis tonneau. Pilote extrait par l’équipe d’intervention.');
  await p.fill('#f_monday_contact_name', 'Sophie Laurent'); await p.fill('#f_monday_contact_phone', '06 21 43 65 87');
  await p.click('[data-next]');
  await p.fill('#f_vehicle1_number', '27'); await p.fill('#f_vehicle1_license', '254781'); await p.fill('#f_vehicle1_driver_first_name', 'Thomas'); await p.fill('#f_vehicle1_driver_last_name', 'Girard');
  await p.selectOption('#f_vehicle1_vehicle_type', 'GT'); await p.selectOption('#f_vehicle1_specification', 'Moderne (Annexe J)');
  await p.fill('#f_vehicle1_make', 'Alpine'); await p.fill('#f_vehicle1_model', 'A110 GT4'); await p.fill('#f_vehicle1_year', '2022'); await p.fill('#f_vehicle1_group', 'GT4');
  await p.selectOption('#f_vehicle1_cockpit', 'Fermé'); await p.selectOption('#f_vehicle1_driving_position', 'Gauche'); await p.selectOption('#f_vehicle1_engine_type', 'Moteur thermique'); await p.selectOption('#f_vehicle1_fuel_type', 'Essence');
  await p.selectOption('#f_vehicle1_adr', 'Oui'); await p.fill('#f_vehicle1_adr_reference', 'ADR-2024-0457'); await p.selectOption('#f_vehicle1_adr_data', 'Oui');
  await p.locator('#f_vehicle1_adr_data').press('Tab');
  await elShot(p, 'fieldset[data-repeat=vehicle]', '07-pilote-vehicule');
  await top(p, '.add-repeat'); await shot(p, '08-ajouter-bloc');
  await p.click('[data-next]');
  await p.locator('[data-field=weather] .check:has-text("Nuageux")').click(); await p.fill('#f_temperature', '14 °C');
  await p.locator('[data-field=visibility] .check:has-text("Bonne")').click();
  await p.locator('[data-field=surface] .check:has-text("Asphalte")').click(); await p.locator('[data-field=track_condition] .check:has-text("Mouillé")').click();
  const items = { 0: 'Sparco Prime RS-8, FIA 8856-2018', 1: 'Sparco Arrow, FIA 8856-2018', 4: 'Stilo ST5 GT, FIA 8860-2018', 6: 'Simpson Hybrid, FIA 8858-2010', 13: 'Sabelt 6 points, FIA 8853-2016' };
  for (const [ri, txt] of Object.entries(items)) { await p.selectOption(`[name=equipment1__${ri}__0]`, 'Oui'); await p.fill(`[name=equipment1__${ri}__1]`, txt); }
  await p.selectOption('[name=equipment1__15__0]', 'Non'); await p.selectOption('[name=equipment1__16__0]', 'Oui'); await p.selectOption('[name=equipment1__18__0]', 'NSP');
  await p.locator('[name=equipment1__18__0]').press('Tab');
  await top(p, '[data-field=equipment1]', 80); await shot(p, '09-equipement');
  await p.click('[data-next]');
  await p.locator('[data-field=diagram] input[type=file]:not([name])').last().setInputFiles(process.argv[2] + '/apercu3/photo-piste.jpg');
  await p.waitForSelector('[data-field=diagram] .file-list li');
  await p.fill('#f_rescue_observations', '11:20 accident – 11:21 drapeau rouge – 11:23 arrivée VIR et médecin – 11:31 extraction – 11:48 départ ambulance.');
  await p.click('[data-next]');
  await p.fill('#f_witness1_first_name', 'Paul'); await p.fill('#f_witness1_last_name', 'Lefèvre'); await p.fill('#f_witness1_role', 'Commissaire poste 4'); await p.check('[name=witness1_confirmed]');
  await p.click('[data-next]');
  await p.fill('#f_author_first_name', 'Jean'); await p.fill('#f_author_last_name', 'Martin'); await p.fill('#f_author_license', '178842'); await p.fill('#f_author_role', 'Directeur de course');
  await p.locator('.stepper-list [data-goto="5"]').click(); await p.locator('.stepper-list [data-goto="6"]').click();
  await top(p, '.stepper'); await shot(p, '10-recapitulatif');
  await p.click('.step-nav button[type=submit]'); await p.waitForURL('**/organisateur?cree=*');
  const ref = new URL(p.url()).searchParams.get('cree'); log('ref', ref);

  // ---- Mobile : directeur (photos), médecin (code, formulaire)
  const mob = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await mob.newPage();
  m.on('pageerror', (e) => log('PAGEERROR mobile', e.message));
  await m.goto(B + '/connexion'); await m.click('[data-fill-login="directeur@demo.ffsa.fr"]'); await mfa(m); await m.waitForURL('**/organisateur');
  await m.goto(B + '/organisateur/rapports/nouveau');
  await m.locator('.stepper-list [data-goto="4"]').click();
  await m.locator('[data-field=diagram] input[type=file]:not([name])').last().setInputFiles(process.argv[2] + '/apercu3/photo-piste.jpg');
  await m.waitForSelector('[data-field=diagram] .file-list li');
  await top(m, '[data-field=diagram]', 200); await shot(m, '11-photos-mobile');
  const link = outboxLink(ref); log('link', link);
  await m.goto(link); await m.locator('main form button[type=submit]').first().click(); await m.waitForLoadState();
  const code1 = (await mails(p)).find((t) => /Code de vérification/.test(t)).match(/(\d{6})/)[1];
  await m.fill('#code', code1); await shot(m, '12-medecin-code-mobile');
  await m.click('form[action$=verifier] button'); await m.waitForLoadState();
  await m.locator('a:has-text("Remplir"), a:has-text("Ajouter un rapport patient")').first().click(); await m.waitForLoadState();
  await top(m, '.stepper', 8); await shot(m, '13-medecin-formulaire-mobile');

  // ---- Médecin sur ordinateur
  const d = await desk.newPage();
  d.on('dialog', (x) => x.accept());
  await d.goto(link); await d.locator('main form button[type=submit]').first().click(); await d.waitForLoadState();
  const code2 = (await mails(p)).find((t) => /Code de vérification/.test(t)).match(/(\d{6})/)[1];
  await d.fill('#code', code2); await d.click('form[action$=verifier] button'); await d.waitForLoadState();
  await shot(d, '14-medecin-dossier');
  await d.locator('a:has-text("Remplir"), a:has-text("Ajouter un rapport patient")').first().click(); await d.waitForLoadState(); await hideNav(d);
  await d.locator('[data-field=session_type] .check:has-text("Course")').click();
  await d.locator('[data-field=patient_type] .check:has-text("Pilote")').first().click();
  await d.click('[data-next]');
  await d.locator('[data-field=conditions] .check:has-text("Tonneau")').click();
  await d.fill('#f_bp', '125/80'); await d.fill('#f_pulse', '84'); await d.fill('#f_sao2', '98'); await d.fill('#f_glasgow', '15');
  await d.locator('[data-field=coloration] .check:has-text("Normal")').click(); await d.locator('[data-field=pci] .check:has-text("Non")').click();
  await d.click('[data-next]');
  await d.selectOption('[name=upper_limbs__0__0]', 'Fracture'); await d.selectOption('[name=upper_limbs__1__0]', 'Contusion'); await d.selectOption('[name=lower_limbs__2__1]', 'Dermabrasion');
  await d.locator('[data-field=spine] .check:has-text("Cervical")').click();
  await top(d, '.stepper'); await shot(d, '15-medecin-blessures');
  await d.click('[data-next]');
  await d.locator('[data-field=decision] .check:has-text("Évacuation non urgente")').click(); await d.locator('[data-field=decision] .check:has-text("Imagerie")').click();
  await d.fill('#f_hospital', 'CHU de Poitiers'); await d.fill('#f_diagnosis', 'Fracture de la clavicule droite. Surveillance cervicale.');
  await d.click('[data-next]');
  await d.locator('[data-field=classification] .check').nth(2).click();
  await d.locator('[data-field=fit] .check:has-text("Oui")').click(); await d.locator('[data-field=current_event] .check:has-text("Inapte")').click();
  await top(d, '.stepper'); await shot(d, '16-medecin-conclusion');
  await d.click('[data-next]'); await d.fill('#f_rpps', '10003456789');
  await d.click('.step-nav button[type=submit]'); await d.waitForLoadState();
  await d.locator('form[action$=cloturer] button').click().catch(() => {}); await d.waitForLoadState();

  // ---- Service médical
  const s = await (await b.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1.5, bypassCSP: true })).newPage();
  await s.goto(B + '/connexion'); await s.click('[data-fill-login="medical@demo.ffsa.fr"]'); await s.waitForURL('**/2fa');
  await shot(s, '17-double-authentification');
  await mfa(s); await s.waitForURL('**/back-office**');
  await shot(s, '18-back-office-liste');
  await s.locator(`a:has-text("${ref}")`).first().click(); await s.waitForLoadState();
  await shot(s, '19-back-office-dossier');
  await s.goto(B + '/back-office/demandes'); await shot(s, '20-demandes');
  // ---- Administrateur
  const a = await (await b.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1.5, bypassCSP: true })).newPage();
  await a.goto(B + '/connexion'); await a.click('[data-fill-login="admin@demo.ffsa.fr"]'); await mfa(a); await a.waitForLoadState();
  await a.goto(B + '/back-office/utilisateurs'); await shot(a, '21-utilisateurs');
  await a.goto(B + '/back-office/audit'); await shot(a, '22-audit');
  await p.goto(B + '/demo/emails'); await shot(p, '23-boite-mail-demo');
  await b.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
