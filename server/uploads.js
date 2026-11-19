'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');

// What a file really is, judged by its first bytes rather than its name.
// SVG is deliberately not allowed because it can carry scripts.
function sniffImage(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const head = Buffer.alloc(12);
  try {
    fs.readSync(fd, head, 0, 12, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (head[0] === 0x89 && head.toString('latin1', 1, 4) === 'PNG') return '.png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return '.jpg';
  if (head.toString('latin1', 0, 4) === 'GIF8') return '.gif';
  if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return '.webp';
  return null;
}

const MOD_FILE_EXTENSIONS = new Set(['.jar', '.zip', '.mrpack', '.mcpack', '.mcaddon', '.7z', '.rar']);

function createUploader(config, models) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, models.tmpDir),
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex'))
  });

  const upload = multer({
    storage,
    limits: {
      fileSize: config.maxModFileMb * 1024 * 1024,
      files: 12,
      fields: 20,
      fieldSize: 200000
    }
  });

  const fields = upload.fields([
    { name: 'icon', maxCount: 1 },
    { name: 'screenshots', maxCount: 10 },
    { name: 'file', maxCount: 1 }
  ]);

  // Runs multer and turns its errors into clean JSON responses.
  function parse(req, res, next) {
    fields(req, res, (err) => {
      if (!err) return next();
      cleanupRequestFiles(req, models);
      if (err instanceof multer.MulterError) {
        const message = err.code === 'LIMIT_FILE_SIZE'
          ? `A file is too large. The mod file limit is ${config.maxModFileMb} MB and images are limited to ${config.maxImageMb} MB.`
          : `Upload problem: ${err.message}`;
        return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'upload_failed', message });
      }
      next(err);
    });
  }

  return { parse };
}

function uploadedFiles(req) {
  const f = req.files && !Array.isArray(req.files) ? req.files : {};
  return {
    icon: f.icon?.[0] || null,
    screenshots: f.screenshots || [],
    file: f.file?.[0] || null
  };
}

function cleanupRequestFiles(req, models) {
  const f = req.files && !Array.isArray(req.files) ? req.files : {};
  for (const list of Object.values(f)) for (const file of list) models.removeTmp(file.filename);
}

// Moves a temp upload into a public images folder after confirming it is an image.
// Returns the stored file name, or throws an Error with a user-facing message.
function storeImage(file, config, models) {
  if (file.size > config.maxImageMb * 1024 * 1024) {
    throw new Error(`Images must be ${config.maxImageMb} MB or smaller.`);
  }
  const ext = sniffImage(file.path);
  if (!ext) throw new Error('Images must be PNG, JPG, GIF or WebP.');
  const stored = crypto.randomBytes(16).toString('hex') + ext;
  fs.renameSync(file.path, path.join(models.uploadsDir, stored));
  return stored;
}

function storeModFile(file, models) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!MOD_FILE_EXTENSIONS.has(ext)) {
    throw new Error(`Mod files must be one of: ${[...MOD_FILE_EXTENSIONS].join(', ')}`);
  }
  const stored = crypto.randomBytes(16).toString('hex') + ext;
  fs.renameSync(file.path, path.join(models.filesDir, stored));
  return { stored, ext, size: file.size };
}

module.exports = { createUploader, uploadedFiles, cleanupRequestFiles, storeImage, storeModFile, MOD_FILE_EXTENSIONS };
