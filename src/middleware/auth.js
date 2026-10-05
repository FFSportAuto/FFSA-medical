'use strict';

const db = require('../db');

const ABSOLUTE_SESSION_HOURS = 12;
const BACKOFFICE_ROLES = ['medical', 'admin'];

async function loadUser(req, res, next) {
  req.user = null;
  const s = req.session;
  if (s && s.userId) {
    if (Date.now() - (s.createdAt || 0) > ABSOLUTE_SESSION_HOURS * 3600 * 1000) {
      return s.regenerate(() => next());
    }
    const user = await db.one(
      'SELECT id, email, full_name, role, totp_enabled, active, organization, license_number FROM users WHERE id = $1',
      [s.userId],
    );
    if (user && user.active) req.user = user;
    else delete s.userId;
  }
  res.locals.user = req.user;
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/connexion');
  }
  // La double authentification est obligatoire pour les profils du back office
  if (BACKOFFICE_ROLES.includes(req.user.role) && !req.user.totp_enabled && !req.path.startsWith('/compte/2fa')) {
    return res.redirect('/compte/2fa');
  }
  next();
}

const requireRole = (...roles) => [
  requireLogin,
  (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).render('errors/error', { title: 'Accès refusé', message: "Vous n'avez pas accès à cette page." });
    }
    next();
  },
];

function homeFor(user) {
  if (!user) return '/connexion';
  return user.role === 'organizer' ? '/organisateur' : '/back-office';
}

module.exports = { loadUser, requireLogin, requireRole, homeFor, BACKOFFICE_ROLES };
