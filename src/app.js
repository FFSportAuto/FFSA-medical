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

function createApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);
  app.disable('x-powered-by');
  app.locals.sectionHasValues = require('./forms/engine').sectionHasValues;

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
  app.use(csrfToken);
  app.use(verifyCsrf);

  app.get('/sante', (req, res) => res.type('text').send('ok'));
  app.use(require('./routes/auth'));
  app.use(require('./routes/organizer'));
  app.use(require('./routes/doctor'));
  app.use(require('./routes/backoffice'));

  app.use((req, res) => res.status(404).render('errors/error', { title: 'Page introuvable', message: "Cette page n'existe pas." }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).render('errors/error', { title: 'Erreur', message: 'Une erreur inattendue est survenue.' });
  });
  return app;
}

module.exports = createApp;
