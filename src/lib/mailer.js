'use strict';

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const config = require('../config');
const templates = require('./mail-templates');

// Règle : les e-mails ne contiennent JAMAIS de donnée de santé ni d'identité de victime,
// uniquement une référence de dossier et un lien vers l'application.

let transport;
function getTransport() {
  if (transport) return transport;
  if (config.mail.host) {
    transport = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      requireTLS: !config.mail.secure,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
    });
  } else {
    transport = nodemailer.createTransport({ jsonTransport: true });
  }
  return transport;
}

const outbox = [];

async function sendMail({ to, subject, text }) {
  const message = { from: config.mail.from, to, subject, text };
  const info = await getTransport().sendMail(message);
  if (!config.mail.host) {
    // Mode développement : conserve les messages en mémoire et dans ./outbox
    outbox.push({ ...message, date: new Date() });
    if (outbox.length > 200) outbox.shift();
    if (config.env !== 'test') {
      const dir = path.join(process.cwd(), 'outbox');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${Date.now()}-${subject.replace(/[^a-z0-9]+/gi, '_').slice(0, 50)}.txt`);
      fs.writeFileSync(file, `To: ${[].concat(to).join(', ')}\nSubject: ${subject}\n\n${text}\n`);
      console.log(`[mail] ${subject} -> ${[].concat(to).join(', ')} (${file})`);
    }
  }
  return info;
}

async function send(templateName, to, params) {
  const { subject, text } = templates[templateName](params);
  return sendMail({ to, subject, text });
}

module.exports = { send, sendMail, outbox };
