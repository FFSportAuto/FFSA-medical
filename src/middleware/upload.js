'use strict';

const multer = require('multer');
const config = require('../config');
const { verifyCsrf } = require('./csrf');

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'application/pdf']);
const MAGIC = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 },
  { mime: 'image/png', test: (b) => b.subarray(0, 4).toString('hex') === '89504e47' },
  { mime: 'application/pdf', test: (b) => b.subarray(0, 4).toString() === '%PDF' },
  { mime: 'image/webp', test: (b) => b.subarray(8, 12).toString() === 'WEBP' },
  { mime: 'image/heic', test: (b) => b.subarray(4, 8).toString() === 'ftyp' },
  { mime: 'image/heif', test: (b) => b.subarray(4, 8).toString() === 'ftyp' },
];

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 10, fields: 200, fieldSize: 400 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED.has(file.mimetype)),
});

// Analyse le multipart, vérifie le CSRF puis le contenu réel des fichiers
function uploadFields(form) {
  const fileFields = form.sections
    .flatMap((s) => s.fields)
    .filter((f) => f.type === 'file')
    .map((f) => ({ name: f.name, maxCount: f.multiple ? 10 : 1 }));
  const handler = parser.fields(fileFields);
  return [
    (req, res, next) =>
      handler(req, res, (err) => {
        if (err) {
          req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? `Fichier trop volumineux (max ${config.maxUploadMb} Mo).` : 'Envoi de fichier invalide.';
          req.files = {};
        }
        req.uploadParsed = true;
        next();
      }),
    verifyCsrf,
    (req, res, next) => {
      for (const list of Object.values(req.files || {})) {
        for (const file of list) {
          const ok = MAGIC.some((m) => m.mime === file.mimetype && m.test(file.buffer));
          if (!ok) req.uploadError = `Le fichier « ${file.originalname} » n'est pas valide.`;
        }
      }
      next();
    },
  ];
}

module.exports = { uploadFields };
