'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const helmet = require('helmet');
const config = require('./config');
const db = require('./db');
const { loadUser } = require('./middleware/auth');
const { csrfToken, verifyCsrf } = require('./middleware/csrf');

// Couleur de discipline (charte FFSA) pour les pastilles du back office
function disciplineClass(discipline) {
  const d = String(discipline || '').toLowerCase();
  if (d.includes('karting')) return 'disc-karting';
  if (d.includes('drift')) return 'disc-drift';
  if (d.includes('tout-terrain') || d.includes('tout terrain') || /cross|trial|fol/.test(d)) return 'disc-tt';
  if (d.includes('côte') || d.includes('slalom')) return 'disc-montagne';
  if (d.includes('vhc')) return 'disc-vhc';
  if (d.includes('rallye')) return 'disc-rallye';
  if (d.includes('circuit') || d.includes('dragster')) return 'disc-circuit';
  return '';
}

function createApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);
  app.disable('x-powered-by');
  app.locals.sectionHasValues = require('./forms/engine').sectionHasValues;
  app.locals.disciplineClass = disciplineClass;
  app.locals.demoMode = config.demoMode;

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      referrerPolicy: { policy: 'no-referrer' }, // évite la fuite des jetons des liens médecin
    }),
  );
  app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1d' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  app.use(
    session({
      name: 'ffsa.sid',
      store: new PgStore({ pool: db.pool, tableName: 'session' }),
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.isProd,
        maxAge: config.sessionIdleMinutes * 60 * 1000,
      },
    }),
  );
  app.use((req, res, next) => {
    // Aucune page ne doit être mise en cache (données personnelles)
    res.set('Cache-Control', 'no-store');
    res.locals.appName = config.appName;
    res.locals.path = req.path;
    next();
  });
  app.use(loadUser);
  // Compteur des demandes d'accès à valider (menu du back office)
  app.use(async (req, res, next) => {
    res.locals.pendingRequests = 0;
    if (req.user && ['medical', 'admin'].includes(req.user.role) && req.method === 'GET') {
      res.locals.pendingRequests = await require('./services/accounts').pendingCount();
    }
    next();
  });
  app.use(csrfToken);
  app.use(verifyCsrf);

  app.get('/sante', (req, res) => res.type('text').send('ok'));
  app.use(require('./routes/auth'));
  app.use(require('./routes/organizer'));
  app.use(require('./routes/doctor'));
  app.use(require('./routes/backoffice'));
  if (config.demoMode) {
    app.use(require('./demo').router);
    // Portail licencié simulé tant qu'aucun vrai fournisseur OpenID Connect n'est configuré
    if (!config.oidc.issuer) {
      const { createDemoIdp } = require('./sso-demo-idp');
      const internal = () => `http://127.0.0.1:${config.port}/demo/sso`;
      Object.assign(config.oidc, { issuer: internal(), clientId: 'ffsa-medical-demo', clientSecret: 'demo-secret', label: 'Se connecter avec mon compte licencié FFSA (simulation)' });
      app.use('/demo/sso', createDemoIdp({ publicBase: () => `${config.baseUrl}/demo/sso`, internalIssuer: internal, clientId: 'ffsa-medical-demo', clientSecret: 'demo-secret' }));
    }
  }

  app.use((req, res) => res.status(404).render('errors/error', { title: 'Page introuvable', message: "Cette page n'existe pas." }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).render('errors/error', { title: 'Erreur', message: 'Une erreur inattendue est survenue.' });
  });
  return app;
}

module.exports = createApp;
