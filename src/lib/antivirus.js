'use strict';

// Analyse antivirus des pièces jointes avec ClamAV (démon clamd, protocole INSTREAM).
// Si CLAMAV_HOST est configuré et que l'analyse échoue (antivirus injoignable), le fichier est
// refusé : on ne laisse jamais entrer un fichier non analysé.
const net = require('net');
const config = require('../config');

const isEnabled = () => Boolean(config.antivirus.host);

function scanBuffer(buffer, { host = config.antivirus.host, port = config.antivirus.port, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const chunks = [];
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('Délai dépassé')));
    socket.on('error', reject);
    socket.on('data', (d) => chunks.push(d));
    socket.on('end', () => {
      const reply = Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim();
      if (/OK$/.test(reply)) return resolve({ clean: true });
      const found = reply.match(/: (.+) FOUND$/);
      if (found) return resolve({ clean: false, virus: found[1] });
      reject(new Error(`Réponse antivirus inattendue : ${reply.slice(0, 100)}`));
    });
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      const CHUNK = 64 * 1024;
      for (let i = 0; i < buffer.length; i += CHUNK) {
        const part = buffer.subarray(i, i + CHUNK);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(part.length);
        socket.write(size);
        socket.write(part);
      }
      socket.write(Buffer.alloc(4)); // fin du flux
    });
  });
}

module.exports = { isEnabled, scanBuffer };
