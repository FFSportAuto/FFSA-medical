'use strict';

const db = require('../db');

// Trace une action. N'y mettre JAMAIS de donnée de santé dans `details`.
async function audit(req, action, { targetType = null, targetId = null, details = null, actor } = {}) {
  const user = req && req.user;
  try {
    await db.query(
      `INSERT INTO audit_log (user_id, actor, action, target_type, target_id, ip, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        user ? user.id : null,
        actor || (user ? `${user.email} (${user.role})` : 'anonyme'),
        action,
        targetType,
        targetId ? String(targetId) : null,
        req ? req.ip : null,
        details ? JSON.stringify(details) : null,
      ],
    );
  } catch (err) {
    console.error('Échec écriture audit', err);
  }
}

module.exports = audit;
