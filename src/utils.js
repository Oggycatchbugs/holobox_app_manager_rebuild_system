const crypto = require('crypto');
const path = require('path');

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeName(value) {
  return cleanName(value).toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function formatBytes(bytes) {
  const size = Number(bytes || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function safeStorageName(name) {
  const original = cleanName(name || 'upload.bin');
  const ext = path.extname(original).toLowerCase();
  const base = path.basename(original, ext)
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
    .slice(0, 90) || 'upload';
  return `${base}${ext || ''}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function randomToken(prefix = 'hb_live_') {
  return `${prefix}${crypto.randomBytes(32).toString('base64url')}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [method, salt, hash] = stored.split('$');
  if (method !== 'scrypt' || !salt || !hash) return false;
  const derived = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

function slugKind(mime, requestedKind) {
  const type = String(mime || '').toLowerCase();
  if (requestedKind === 'audio' || type.startsWith('audio/')) return 'system_audio';
  if (type.startsWith('image/')) return 'advertisement_image';
  return 'advertisement_video';
}

function publicRole(dbRole) {
  return dbRole === 'platform_admin' ? 'admin' : 'customer';
}

module.exports = {
  cleanName,
  normalizeName,
  nowIso,
  formatBytes,
  safeStorageName,
  sha256,
  sha256Buffer,
  randomToken,
  hashPassword,
  verifyPassword,
  slugKind,
  publicRole,
};
