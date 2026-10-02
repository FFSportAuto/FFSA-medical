'use strict';

const crypto = require('crypto');
const { safeEqual } = require('../lib/crypto');

// Jeton synchronisé stocké en session, à placer dans un champ caché `_csrf`
function csrfToken(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('base64url');
  res.locals.csrfToken = req.session.csrf;
  next();
}

// Routes acceptant un envoi multipart : le CSRF y est vérifié après l'analyse du corps
const MULTIPART_ROUTES = [/^\/organisateur\/rapports$/, /^\/medecin\/[A-Za-z0-9_-]+$/];

function verifyCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.is('multipart/form-data') && !req.uploadParsed) {
    if (MULTIPART_ROUTES.some((re) => re.test(req.path))) return next();
    return res.status(415).send('Type de contenu non accepté');
  }
  const token = (req.body && req.body._csrf) || req.get('x-csrf-token');
  if (!token || !req.session.csrf || !safeEqual(token, req.session.csrf)) {
    return res.status(403).render('errors/error', {
      title: 'Session expirée',
      message: 'Le formulaire a expiré. Rechargez la page et réessayez.',
    });
  }
  next();
}

module.exports = { csrfToken, verifyCsrf };
