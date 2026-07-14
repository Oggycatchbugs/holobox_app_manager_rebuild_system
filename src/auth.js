const crypto = require('crypto');
const config = require('./config');
const { getSupabase } = require('./db');
const { publicRole } = require('./utils');

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function hmac(input) {
  return crypto.createHmac('sha256', config.SESSION_SECRET).update(input).digest('base64url');
}

function createSessionToken(user) {
  if (!config.SESSION_SECRET) throw new Error('SESSION_SECRET is required.');
  const payload = base64url(JSON.stringify({
    userId: user.id,
    exp: Date.now() + config.SESSION_MAX_AGE_SEC * 1000,
  }));
  return `${payload}.${hmac(payload)}`;
}

function verifySessionToken(token) {
  if (!config.SESSION_SECRET || !token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const expected = hmac(payload);
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded.exp || decoded.exp < Date.now()) return null;
    return decoded;
  } catch {
    return null;
  }
}

function setSessionCookie(res, token) {
  res.cookie(config.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    maxAge: config.SESSION_MAX_AGE_SEC * 1000,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(config.SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
  });
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    name: user.display_name,
    role: publicRole(user.role),
    rawRole: user.role,
    customerId: user.organization_id || null,
    organizationId: user.organization_id || null,
    language: user.language || 'vi',
    active: user.active,
    lastLoginAt: user.last_login_at,
  };
}

async function getUserById(userId) {
  if (!userId) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .eq('active', true)
    .is('archived_at', null)
    .maybeSingle();
  if (error) throw new Error(`Could not load session user: ${error.message}`);
  return data || null;
}

async function authMiddleware(req, _res, next) {
  try {
    const token = req.cookies?.[config.SESSION_COOKIE_NAME];
    const session = verifySessionToken(token);
    req.authUser = session ? await getUserById(session.userId) : null;
    next();
  } catch (error) {
    next(error);
  }
}

function requireUser(req, res, next) {
  if (!req.authUser) return res.status(401).json({ ok: false, error: 'Authentication required.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.authUser) return res.status(401).json({ ok: false, error: 'Authentication required.' });
  if (req.authUser.role !== 'platform_admin') return res.status(403).json({ ok: false, error: 'Admin permission required.' });
  next();
}

function requireCompanyOrAdmin(req, res, next) {
  if (!req.authUser) return res.status(401).json({ ok: false, error: 'Authentication required.' });
  if (!['platform_admin', 'company_operator'].includes(req.authUser.role)) {
    return res.status(403).json({ ok: false, error: 'Permission denied.' });
  }
  next();
}

function assertOrganizationAccess(user, organizationId) {
  if (user.role === 'platform_admin') return true;
  return String(user.organization_id || '') === String(organizationId || '');
}

module.exports = {
  createSessionToken,
  setSessionCookie,
  clearSessionCookie,
  publicUser,
  authMiddleware,
  requireUser,
  requireAdmin,
  requireCompanyOrAdmin,
  assertOrganizationAccess,
};
