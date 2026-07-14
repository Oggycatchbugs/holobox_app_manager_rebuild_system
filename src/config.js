const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function clean(value) {
  return String(value || '')
    .replace(/[\r\n\t]/g, '')
    .replace(/^["']+|["']+$/g, '')
    .trim();
}

const NODE_ENV = clean(process.env.NODE_ENV) || 'development';
const isProduction = NODE_ENV === 'production';

module.exports = {
  NODE_ENV,
  isProduction,
  PORT: Number(process.env.PORT || 3000),
  ROOT: path.join(__dirname, '..'),
  SUPABASE_URL: clean(process.env.SUPABASE_URL),
  SUPABASE_SERVICE_ROLE_KEY: clean(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_KEY
  ),
  SUPABASE_BUCKET: clean(process.env.SUPABASE_BUCKET) || 'holobox-media',
  SESSION_SECRET: clean(process.env.SESSION_SECRET),
  SESSION_COOKIE_NAME: clean(process.env.SESSION_COOKIE_NAME) || 'hb_session',
  SESSION_MAX_AGE_SEC: Number(process.env.SESSION_MAX_AGE_SEC || 60 * 60 * 24 * 14),
  ADMIN_INITIAL_USERNAME: clean(process.env.ADMIN_INITIAL_USERNAME) || 'admin',
  ADMIN_INITIAL_PASSWORD: clean(process.env.ADMIN_INITIAL_PASSWORD),
  ADMIN_INITIAL_NAME: clean(process.env.ADMIN_INITIAL_NAME) || 'TLC Admin',
  UPLOAD_MAX_BYTES: Number(process.env.UPLOAD_MAX_BYTES || 250 * 1024 * 1024),
  SIGNED_URL_TTL_SEC: Number(process.env.SIGNED_URL_TTL_SEC || 60 * 60),
  HEARTBEAT_WARNING_SEC: Number(process.env.HEARTBEAT_WARNING_SEC || 45),
  HEARTBEAT_OFFLINE_SEC: Number(process.env.HEARTBEAT_OFFLINE_SEC || 90),
  DEVICE_HEARTBEAT_INTERVAL_SEC: Number(process.env.DEVICE_HEARTBEAT_INTERVAL_SEC || 15),
};
