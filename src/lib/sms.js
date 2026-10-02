'use strict';

const config = require('../config');
const templates = require('./sms-templates');
const mailer = require('./mailer');

// Numéro au format international (+33…) ; null si inexploitable
function normalizePhone(raw) {
  let n = String(raw || '').replace(/[\s.\-()]/g, '');
  if (n.startsWith('00')) n = `+${n.slice(2)}`;
  if (/^0[1-9]\d{8}$/.test(n)) n = `+33${n.slice(1)}`;
  return /^\+\d{8,15}$/.test(n) ? n : null;
}

const maskPhone = (raw) => {
  const n = String(raw || '').replace(/\D/g, '');
  return n.length >= 4 ? `•• •• •• ${n.slice(-4, -2)} ${n.slice(-2)}` : '';
};

async function sendSms(to, text) {
  const phone = normalizePhone(to);
  if (!phone) return false;
  if (config.sms.provider === 'brevo' && config.sms.apiKey) {
    const res = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
      method: 'POST',
      headers: { 'api-key': config.sms.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: config.sms.sender, recipient: phone.replace('+', ''), content: text, type: 'transactional' }),
    });
    if (!res.ok) throw new Error(`Envoi SMS refusé (${res.status})`);
    return true;
  }
  // Sans fournisseur configuré : le SMS est visible dans la boîte de démonstration / ./outbox
  await mailer.sendMail({ to: phone, subject: `[SMS] ${text.slice(0, 60)}…`, text, sms: true });
  return true;
}

// L'échec d'un SMS ne doit jamais bloquer le circuit (l'e-mail part toujours)
async function send(templateName, to, params) {
  if (!to) return false;
  try {
    return await sendSms(to, templates[templateName](params));
  } catch (err) {
    console.error('SMS non envoyé :', err.message);
    return false;
  }
}

module.exports = { send, normalizePhone, maskPhone };
