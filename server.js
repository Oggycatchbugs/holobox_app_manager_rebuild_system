const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const config = require('./src/config');
const { getSupabase } = require('./src/db');
const {
  cleanName,
  normalizeName,
  nowIso,
  safeStorageName,
  sha256,
  sha256Buffer,
  randomToken,
  hashPassword,
  verifyPassword,
  slugKind,
} = require('./src/utils');
const {
  createSessionToken,
  setSessionCookie,
  clearSessionCookie,
  publicUser,
  authMiddleware,
  requireUser,
  requireAdmin,
  requireCompanyOrAdmin,
  assertOrganizationAccess,
} = require('./src/auth');
const {
  ensureBootstrapAdmin,
  audit,
  addDeviceEvent,
  getSettings,
  ensureActivePlaylist,
  rebuildDeviceManifest,
  rebuildOrganizationManifests,
  getLatestManifest,
  getBootstrapData,
} = require('./src/services');

const app = express();
const loginAttempts = new Map();
app.disable('x-powered-by');
app.use(cookieParser());
app.use(authMiddleware);

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function errorResponse(res, status, message, details) {
  return res.status(status).json({ ok: false, error: message, details: details ? String(details) : undefined });
}

function getBearerToken(req) {
  const raw = String(req.headers.authorization || '');
  return raw.toLowerCase().startsWith('bearer ') ? raw.slice(7).trim() : '';
}

async function deviceAuth(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) return errorResponse(res, 401, 'Device token is required.');
    const tokenHash = sha256(token);
    const supabase = getSupabase();
    const { data: credential, error } = await supabase
      .from('device_credentials')
      .select('*,devices(*)')
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
      .maybeSingle();
    if (error) throw new Error(`Could not verify device token: ${error.message}`);
    if (!credential?.devices || credential.devices.archived_at || credential.devices.status !== 'active') {
      return errorResponse(res, 401, 'Invalid or revoked device token.');
    }
    const legacyCode = req.params.deviceCode;
    if (legacyCode && normalizeName(legacyCode) !== normalizeName(credential.devices.device_code)) {
      return errorResponse(res, 403, 'Device token does not match the requested device.');
    }
    req.deviceCredential = credential;
    req.device = credential.devices;
    await supabase.from('device_credentials').update({ last_used_at: nowIso() }).eq('id', credential.id);
    next();
  } catch (error) {
    next(error);
  }
}

function organizationIdForRequest(req, requested) {
  if (req.authUser.role === 'platform_admin') return cleanName(requested || '');
  return req.authUser.organization_id;
}

async function loadDeviceForUser(req, deviceId) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('devices').select('*').eq('id', deviceId).is('archived_at', null).maybeSingle();
  if (error) throw new Error(`Could not load device: ${error.message}`);
  if (!data) return null;
  if (!assertOrganizationAccess(req.authUser, data.organization_id)) return false;
  return data;
}

async function validateAssistantAudio(organizationId, audioMediaId) {
  if (!audioMediaId) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('media_assets')
    .select('id')
    .eq('id', audioMediaId)
    .eq('organization_id', organizationId)
    .eq('kind', 'system_audio')
    .eq('status', 'active')
    .is('archived_at', null)
    .maybeSingle();
  if (error) throw new Error(`Could not validate Assistant audio: ${error.message}`);
  if (!data) throw Object.assign(new Error('Selected audio is invalid or belongs to another company.'), { statusCode: 400 });
  return data.id;
}

async function signedMediaUrl(storagePath) {
  const supabase = getSupabase();
  const { data, error } = await supabase.storage.from(config.SUPABASE_BUCKET).createSignedUrl(storagePath, config.SIGNED_URL_TTL_SEC);
  if (error) throw new Error(`Could not create media URL: ${error.message}`);
  return data.signedUrl;
}

async function serializeManifestForDevice(device) {
  const latest = await getLatestManifest(device.id);
  const payload = JSON.parse(JSON.stringify(latest.payload || {}));
  payload.version = Number(latest.version || payload.version || 0);
  payload.generatedAt = payload.generatedAt || latest.created_at;
  for (const key of ['videoPlaylist', 'audioPlaylist']) {
    const items = Array.isArray(payload[key]) ? payload[key] : [];
    for (const item of items) {
      item.url = await signedMediaUrl(item.storagePath);
      item.size = item.sizeBytes;
      delete item.storagePath;
    }
    payload[key] = items;
  }
  return payload;
}

// Raw upload route must run before express.json().
app.post('/api/media/upload', requireCompanyOrAdmin, express.raw({ type: '*/*', limit: config.UPLOAD_MAX_BYTES }), asyncRoute(async (req, res) => {
  const kindParam = cleanName(req.query.kind);
  const originalName = cleanName(req.query.name || 'upload.bin');
  const mimeType = cleanName(req.query.mime || req.headers['content-type'] || 'application/octet-stream');
  const durationSeconds = Number(req.query.durationSeconds || 0);
  const roleKey = cleanName(req.query.role || '');
  const organizationId = organizationIdForRequest(req, req.query.customerId || req.query.organizationId);
  if (!organizationId) return errorResponse(res, 400, 'Organization is required.');
  if (!assertOrganizationAccess(req.authUser, organizationId)) return errorResponse(res, 403, 'Organization access denied.');
  if (!Buffer.isBuffer(req.body) || !req.body.length) return errorResponse(res, 400, 'Uploaded file is empty.');

  const kind = slugKind(mimeType, kindParam);
  const allowed = kind === 'system_audio'
    ? ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/mp4']
    : ['video/mp4', 'video/webm', 'video/quicktime', 'image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(mimeType.toLowerCase())) return errorResponse(res, 415, `Unsupported media type: ${mimeType}`);

  const supabase = getSupabase();
  const duplicate = await supabase.from('media_assets').select('id').eq('organization_id', organizationId).ilike('name', originalName).is('archived_at', null).limit(1);
  if (duplicate.error) throw new Error(`Could not check duplicate media: ${duplicate.error.message}`);
  if (duplicate.data?.length) return errorResponse(res, 409, `A file named "${originalName}" already exists.`);

  const fileName = safeStorageName(originalName);
  const folder = kind === 'system_audio' ? 'audio' : 'advertisements';
  const storagePath = `${folder}/${organizationId}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${fileName}`;
  const checksum = sha256Buffer(req.body);
  const upload = await supabase.storage.from(config.SUPABASE_BUCKET).upload(storagePath, req.body, {
    contentType: mimeType,
    cacheControl: '3600',
    upsert: false,
  });
  if (upload.error) throw new Error(`Storage upload failed: ${upload.error.message}`);

  const inserted = await supabase.from('media_assets').insert({
    organization_id: organizationId,
    kind,
    name: originalName,
    storage_path: storagePath,
    mime_type: mimeType,
    size_bytes: req.body.length,
    checksum_sha256: checksum,
    duration_seconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
    role_key: kind === 'system_audio' ? roleKey : '',
    status: 'active',
    uploaded_by: req.authUser.id,
  }).select('*').single();
  if (inserted.error) {
    await supabase.storage.from(config.SUPABASE_BUCKET).remove([storagePath]);
    throw new Error(`Could not save media metadata: ${inserted.error.message}`);
  }

  if (kind !== 'system_audio') {
    const playlist = await ensureActivePlaylist(organizationId, req.authUser.id);
    const existingItems = await supabase.from('playlist_items').select('sort_order').eq('playlist_id', playlist.id).order('sort_order', { ascending: false }).limit(1);
    if (existingItems.error) throw new Error(`Could not load playlist order: ${existingItems.error.message}`);
    const nextOrder = Number(existingItems.data?.[0]?.sort_order || 0) + 1;
    const addItem = await supabase.from('playlist_items').insert({ playlist_id: playlist.id, media_asset_id: inserted.data.id, sort_order: nextOrder });
    if (addItem.error) throw new Error(`Could not add media to playlist: ${addItem.error.message}`);
    await supabase.from('devices').update({ active_playlist_id: playlist.id, updated_at: nowIso() }).eq('organization_id', organizationId).is('archived_at', null);
  }

  await rebuildOrganizationManifests(organizationId);
  await audit({ actorId: req.authUser.id, organizationId, action: 'media_uploaded', resourceType: 'media_asset', resourceId: inserted.data.id, after: { name: originalName, kind, checksum } });
  res.json({ ok: true, item: inserted.data, data: await getBootstrapData(req.authUser) });
}));

app.use(express.json({ limit: '5mb' }));

app.get('/health', asyncRoute(async (_req, res) => {
  let database = false;
  let databaseError = '';
  try {
    const supabase = getSupabase();
    const check = await supabase.from('app_settings').select('id').eq('id', 'main').maybeSingle();
    if (check.error) throw check.error;
    database = true;
  } catch (error) {
    databaseError = error.message;
  }
  res.status(database ? 200 : 503).json({
    ok: database,
    version: '14.0.0-phase1-foundation',
    supabaseConfigured: Boolean(config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY),
    database,
    databaseError: databaseError || undefined,
  });
}));

app.get('/api/public/config', asyncRoute(async (_req, res) => {
  const settings = await getSettings();
  res.json({ ok: true, settings: {
    systemName: settings.system_name,
    defaultLanguage: settings.default_language,
    maintenancePhone: settings.maintenance_phone,
    maintenanceEmail: settings.maintenance_email,
    maintenanceZalo: settings.maintenance_zalo,
    offlineTimeout: String(settings.offline_timeout_seconds),
  } });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const username = normalizeName(req.body.username);
  const password = String(req.body.password || '');
  if (!username || !password) return errorResponse(res, 400, 'Username and password are required.');
  const attemptKey = `${req.ip || 'unknown'}:${username}`;
  const attempt = loginAttempts.get(attemptKey) || { count: 0, blockedUntil: 0 };
  if (attempt.blockedUntil > Date.now()) {
    return errorResponse(res, 429, 'Too many failed login attempts. Try again later.');
  }
  const supabase = getSupabase();
  const { data: users, error } = await supabase.from('users').select('*').ilike('username', username).eq('active', true).is('archived_at', null).limit(1);
  if (error) throw new Error(`Login query failed: ${error.message}`);
  const user = users?.[0];
  if (!user || !verifyPassword(password, user.password_hash)) {
    const nextCount = attempt.count + 1;
    loginAttempts.set(attemptKey, {
      count: nextCount >= 5 ? 0 : nextCount,
      blockedUntil: nextCount >= 5 ? Date.now() + 10 * 60 * 1000 : 0,
    });
    return errorResponse(res, 401, 'Sai tài khoản hoặc mật khẩu.');
  }
  loginAttempts.delete(attemptKey);
  await supabase.from('users').update({ last_login_at: nowIso(), updated_at: nowIso() }).eq('id', user.id);
  setSessionCookie(res, createSessionToken(user));
  await audit({ actorId: user.id, organizationId: user.organization_id, action: 'login_success', resourceType: 'session', resourceId: user.id });
  res.json({ ok: true, user: publicUser({ ...user, last_login_at: nowIso() }) });
}));

app.get('/api/auth/me', asyncRoute(async (req, res) => res.json({ ok: true, user: publicUser(req.authUser) })));
app.post('/api/auth/logout', asyncRoute(async (req, res) => {
  if (req.authUser) await audit({ actorId: req.authUser.id, organizationId: req.authUser.organization_id, action: 'logout', resourceType: 'session', resourceId: req.authUser.id });
  clearSessionCookie(res);
  res.json({ ok: true });
}));

app.post('/api/auth/change-password', requireUser, asyncRoute(async (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');
  if (newPassword.length < 8) return errorResponse(res, 400, 'New password must contain at least 8 characters.');
  if (!verifyPassword(currentPassword, req.authUser.password_hash)) return errorResponse(res, 400, 'Current password is incorrect.');
  const supabase = getSupabase();
  const update = await supabase.from('users').update({ password_hash: hashPassword(newPassword), updated_at: nowIso() }).eq('id', req.authUser.id);
  if (update.error) throw new Error(`Could not change password: ${update.error.message}`);
  await audit({ actorId: req.authUser.id, organizationId: req.authUser.organization_id, action: 'password_changed', resourceType: 'user', resourceId: req.authUser.id });
  res.json({ ok: true });
}));

app.get('/api/bootstrap', requireUser, asyncRoute(async (req, res) => {
  res.json({ ok: true, data: await getBootstrapData(req.authUser) });
}));

// Legacy read endpoint kept temporarily so an older browser cache does not break.
app.get('/api/state', requireUser, asyncRoute(async (req, res) => res.json({ ok: true, data: await getBootstrapData(req.authUser), legacy: true })));
app.put('/api/state', requireUser, (_req, res) => errorResponse(res, 410, 'The legacy state write endpoint was removed in Phase 1.'));

app.post('/api/admin/customers', requireAdmin, asyncRoute(async (req, res) => {
  const name = cleanName(req.body.name);
  const username = cleanName(req.body.username);
  const password = String(req.body.password || '');
  if (!name || !username || password.length < 8) return errorResponse(res, 400, 'Company name, username and a password of at least 8 characters are required.');
  const supabase = getSupabase();
  const exists = await supabase.from('users').select('id').ilike('username', username).is('archived_at', null).limit(1);
  if (exists.error) throw new Error(`Could not check username: ${exists.error.message}`);
  if (exists.data?.length) return errorResponse(res, 409, 'Username already exists.');

  const orgInsert = await supabase.from('organizations').insert({
    name,
    contact_name: cleanName(req.body.contactName),
    phone: cleanName(req.body.phone),
    email: cleanName(req.body.email),
  }).select('*').single();
  if (orgInsert.error) throw new Error(`Could not create company: ${orgInsert.error.message}`);

  const userInsert = await supabase.from('users').insert({
    organization_id: orgInsert.data.id,
    username,
    password_hash: hashPassword(password),
    display_name: name,
    role: 'company_operator',
    active: true,
    language: req.body.language === 'en' ? 'en' : 'vi',
  }).select('*').single();
  if (userInsert.error) {
    await supabase.from('organizations').delete().eq('id', orgInsert.data.id);
    if (userInsert.error.code === '23505') return errorResponse(res, 409, 'Username already exists.');
    throw new Error(`Could not create company operator: ${userInsert.error.message}`);
  }
  await ensureActivePlaylist(orgInsert.data.id, req.authUser.id);
  await audit({ actorId: req.authUser.id, organizationId: orgInsert.data.id, action: 'organization_created', resourceType: 'organization', resourceId: orgInsert.data.id, after: { name, username } });
  res.json({ ok: true, customer: orgInsert.data, user: publicUser(userInsert.data), data: await getBootstrapData(req.authUser) });
}));

app.put('/api/admin/customers/:id/login', requireAdmin, asyncRoute(async (req, res) => {
  const supabase = getSupabase();
  const organizationId = req.params.id;
  const existing = await supabase.from('users').select('*').eq('organization_id', organizationId).eq('role', 'company_operator').is('archived_at', null).limit(1);
  if (existing.error) throw new Error(`Could not load company operator: ${existing.error.message}`);
  const user = existing.data?.[0];
  if (!user) return errorResponse(res, 404, 'Company operator not found.');
  const patch = { updated_at: nowIso() };
  if (cleanName(req.body.username)) patch.username = cleanName(req.body.username);
  if (cleanName(req.body.name)) patch.display_name = cleanName(req.body.name);
  if (String(req.body.password || '').trim()) {
    if (String(req.body.password).length < 8) return errorResponse(res, 400, 'Password must contain at least 8 characters.');
    patch.password_hash = hashPassword(String(req.body.password));
  }
  if (req.body.active !== undefined) patch.active = String(req.body.active) !== 'false';
  const update = await supabase.from('users').update(patch).eq('id', user.id);
  if (update.error) throw new Error(`Could not update company operator: ${update.error.message}`);
  await audit({ actorId: req.authUser.id, organizationId, action: 'company_operator_updated', resourceType: 'user', resourceId: user.id, after: { username: patch.username, active: patch.active } });
  res.json({ ok: true, data: await getBootstrapData(req.authUser) });
}));

app.delete('/api/admin/customers/:id', requireAdmin, asyncRoute(async (req, res) => {
  const supabase = getSupabase();
  const organizationId = req.params.id;
  const timestamp = nowIso();
  const org = await supabase.from('organizations').select('*').eq('id', organizationId).maybeSingle();
  if (org.error) throw new Error(`Could not load company: ${org.error.message}`);
  if (!org.data) return errorResponse(res, 404, 'Company not found.');
  const update = await supabase.from('organizations').update({ status: 'archived', archived_at: timestamp, updated_at: timestamp }).eq('id', organizationId);
  if (update.error) throw new Error(`Could not archive company: ${update.error.message}`);
  await supabase.from('users').update({ active: false, archived_at: timestamp, updated_at: timestamp }).eq('organization_id', organizationId);
  await supabase.from('devices').update({ status: 'archived', archived_at: timestamp, updated_at: timestamp }).eq('organization_id', organizationId);
  await audit({ actorId: req.authUser.id, organizationId, action: 'organization_archived', resourceType: 'organization', resourceId: organizationId, before: org.data });
  res.json({ ok: true, data: await getBootstrapData(req.authUser) });
}));

app.post('/api/admin/devices', requireAdmin, asyncRoute(async (req, res) => {
  const organizationId = cleanName(req.body.customerId || req.body.organizationId);
  const name = cleanName(req.body.name);
  const deviceCode = cleanName(req.body.deviceCode);
  if (!organizationId || !name || !deviceCode) return errorResponse(res, 400, 'Company, device name and device code are required.');
  const supabase = getSupabase();
  const playlist = await ensureActivePlaylist(organizationId, req.authUser.id);
  const insert = await supabase.from('devices').insert({
    organization_id: organizationId,
    name,
    device_code: deviceCode,
    location_name: cleanName(req.body.location),
    stream_url: cleanName(req.body.streamUrl),
    desired_power_state: 'OFF',
    desired_mode: req.body.runtimeMode === 'JUST_ADS' ? 'ADS_ONLY' : 'ASSISTANT',
    active_playlist_id: playlist.id,
  }).select('*').single();
  if (insert.error) {
    if (insert.error.code === '23505') return errorResponse(res, 409, 'Device code already exists.');
    throw new Error(`Could not create device: ${insert.error.message}`);
  }
  const token = randomToken();
  const credential = await supabase.from('device_credentials').insert({
    device_id: insert.data.id,
    token_hash: sha256(token),
    token_prefix: token.slice(0, 16),
  });
  if (credential.error) {
    await supabase.from('devices').delete().eq('id', insert.data.id);
    throw new Error(`Could not create device token: ${credential.error.message}`);
  }
  await rebuildDeviceManifest(insert.data.id);
  await audit({ actorId: req.authUser.id, organizationId, action: 'device_created', resourceType: 'device', resourceId: insert.data.id, after: { name, deviceCode } });
  res.json({ ok: true, device: insert.data, deviceToken: token, data: await getBootstrapData(req.authUser) });
}));

app.put('/api/admin/devices/:id', requireAdmin, asyncRoute(async (req, res) => {
  const supabase = getSupabase();
  const before = await supabase.from('devices').select('*').eq('id', req.params.id).maybeSingle();
  if (before.error) throw new Error(`Could not load device: ${before.error.message}`);
  if (!before.data) return errorResponse(res, 404, 'Device not found.');
  const patch = {
    name: cleanName(req.body.name || before.data.name),
    device_code: cleanName(req.body.deviceCode || before.data.device_code),
    organization_id: cleanName(req.body.customerId || before.data.organization_id),
    stream_url: cleanName(req.body.streamUrl || ''),
    location_name: cleanName(req.body.location || before.data.location_name),
    desired_mode: req.body.runtimeMode === 'JUST_ADS' ? 'ADS_ONLY' : 'ASSISTANT',
    updated_at: nowIso(),
  };
  const playlist = await ensureActivePlaylist(patch.organization_id, req.authUser.id);
  patch.active_playlist_id = playlist.id;
  const update = await supabase.from('devices').update(patch).eq('id', req.params.id);
  if (update.error) throw new Error(`Could not update device: ${update.error.message}`);
  await rebuildDeviceManifest(req.params.id);
  await audit({ actorId: req.authUser.id, organizationId: patch.organization_id, action: 'device_updated', resourceType: 'device', resourceId: req.params.id, before: before.data, after: patch });
  res.json({ ok: true, data: await getBootstrapData(req.authUser) });
}));

app.delete('/api/admin/devices/:id', requireAdmin, asyncRoute(async (req, res) => {
  const supabase = getSupabase();
  const before = await supabase.from('devices').select('*').eq('id', req.params.id).maybeSingle();
  if (before.error) throw new Error(`Could not load device: ${before.error.message}`);
  if (!before.data) return errorResponse(res, 404, 'Device not found.');
  const timestamp = nowIso();
  const update = await supabase.from('devices').update({ status: 'archived', archived_at: timestamp, updated_at: timestamp }).eq('id', req.params.id);
  if (update.error) throw new Error(`Could not archive device: ${update.error.message}`);
  await supabase.from('device_credentials').update({ revoked_at: timestamp }).eq('device_id', req.params.id).is('revoked_at', null);
  await audit({ actorId: req.authUser.id, organizationId: before.data.organization_id, action: 'device_archived', resourceType: 'device', resourceId: req.params.id, before: before.data });
  res.json({ ok: true, data: await getBootstrapData(req.authUser) });
}));

app.post('/api/admin/devices/:id/credentials/rotate', requireAdmin, asyncRoute(async (req, res) => {
  const supabase = getSupabase();
  const device = await supabase.from('devices').select('*').eq('id', req.params.id).is('archived_at', null).maybeSingle();
  if (device.error) throw new Error(`Could not load device: ${device.error.message}`);
  if (!device.data) return errorResponse(res, 404, 'Device not found.');
  const timestamp = nowIso();
  await supabase.from('device_credentials').update({ revoked_at: timestamp }).eq('device_id', req.params.id).is('revoked_at', null);
  const token = randomToken();
  const insert = await supabase.from('device_credentials').insert({ device_id: req.params.id, token_hash: sha256(token), token_prefix: token.slice(0, 16) });
  if (insert.error) throw new Error(`Could not rotate device token: ${insert.error.message}`);
  await audit({ actorId: req.authUser.id, organizationId: device.data.organization_id, action: 'device_token_rotated', resourceType: 'device', resourceId: req.params.id });
  res.json({ ok: true, deviceToken: token });
}));

app.patch('/api/devices/:id/control', requireCompanyOrAdmin, asyncRoute(async (req, res) => {
  const device = await loadDeviceForUser(req, req.params.id);
  if (device === false) return errorResponse(res, 403, 'Device access denied.');
  if (!device) return errorResponse(res, 404, 'Device not found.');
  const patch = { updated_at: nowIso() };
  if (req.body.powerState) {
    const power = String(req.body.powerState).toUpperCase();
    if (!['ON', 'OFF'].includes(power)) return errorResponse(res, 400, 'Invalid power state.');
    patch.desired_power_state = power;
  }
  if (req.body.mode) {
    const mode = String(req.body.mode).toUpperCase();
    if (!['ASSISTANT', 'ADS_ONLY'].includes(mode)) return errorResponse(res, 400, 'Invalid mode.');
    patch.desired_mode = mode;
  }
  const supabase = getSupabase();
  const update = await supabase.from('devices').update(patch).eq('id', req.params.id);
  if (update.error) throw new Error(`Could not update device control: ${update.error.message}`);
  await audit({ actorId: req.authUser.id, organizationId: device.organization_id, action: 'device_control_changed', resourceType: 'device', resourceId: device.id, before: { power: device.desired_power_state, mode: device.desired_mode }, after: patch });
  res.json({ ok: true, data: await getBootstrapData(req.authUser) });
}));

app.post('/api/admin/devices/:id/sync-now', requireAdmin, asyncRoute(async (req, res) => {
  const supabase = getSupabase();
  const device = await supabase.from('devices').select('*').eq('id', req.params.id).is('archived_at', null).maybeSingle();
  if (device.error) throw new Error(`Could not load device: ${device.error.message}`);
  if (!device.data) return errorResponse(res, 404, 'Device not found.');
  const manifest = await rebuildDeviceManifest(req.params.id);
  const timestamp = nowIso();
  const update = await supabase.from('devices').update({ sync_requested_at: timestamp, updated_at: timestamp }).eq('id', req.params.id);
  if (update.error) throw new Error(`Could not request sync: ${update.error.message}`);
  await audit({ actorId: req.authUser.id, organizationId: device.data.organization_id, action: 'device_sync_requested', resourceType: 'device', resourceId: req.params.id, after: { manifestVersion: manifest.version } });
  res.json({ ok: true, manifestVersion: manifest.version, data: await getBootstrapData(req.authUser) });
}));

app.put('/api/playlists/active/items', requireCompanyOrAdmin, asyncRoute(async (req, res) => {
  const organizationId = organizationIdForRequest(req, req.body.customerId || req.body.organizationId);
  if (!organizationId) return errorResponse(res, 400, 'Organization is required.');
  if (!assertOrganizationAccess(req.authUser, organizationId)) return errorResponse(res, 403, 'Organization access denied.');
  const mediaIds = Array.isArray(req.body.mediaIds) ? req.body.mediaIds.map(String) : [];
  const supabase = getSupabase();
  if (mediaIds.length) {
    const mediaCheck = await supabase.from('media_assets').select('id').eq('organization_id', organizationId).in('id', mediaIds).neq('kind', 'system_audio').eq('status', 'active').is('archived_at', null);
    if (mediaCheck.error) throw new Error(`Could not verify playlist media: ${mediaCheck.error.message}`);
    if ((mediaCheck.data || []).length !== new Set(mediaIds).size) return errorResponse(res, 400, 'Playlist contains invalid or inaccessible media.');
  }
  const playlist = await ensureActivePlaylist(organizationId, req.authUser.id);
  const replace = await supabase.rpc('replace_playlist_items', { p_playlist_id: playlist.id, p_media_ids: mediaIds });
  if (replace.error) throw new Error(`Could not reorder playlist: ${replace.error.message}`);
  await supabase.from('devices').update({ active_playlist_id: playlist.id, updated_at: nowIso() }).eq('organization_id', organizationId).is('archived_at', null);
  await rebuildOrganizationManifests(organizationId);
  await audit({ actorId: req.authUser.id, organizationId, action: 'playlist_reordered', resourceType: 'playlist', resourceId: playlist.id, after: { mediaIds } });
  res.json({ ok: true, data: await getBootstrapData(req.authUser) });
}));

app.delete('/api/media/:kind/:id', requireCompanyOrAdmin, asyncRoute(async (req, res) => {
  const supabase = getSupabase();
  const media = await supabase.from('media_assets').select('*').eq('id', req.params.id).is('archived_at', null).maybeSingle();
  if (media.error) throw new Error(`Could not load media: ${media.error.message}`);
  if (!media.data) return errorResponse(res, 404, 'Media not found.');
  if (!assertOrganizationAccess(req.authUser, media.data.organization_id)) return errorResponse(res, 403, 'Media access denied.');
  const timestamp = nowIso();
  await supabase.from('playlist_items').delete().eq('media_asset_id', media.data.id);
  const archive = await supabase.from('media_assets').update({ status: 'archived', archived_at: timestamp, updated_at: timestamp }).eq('id', media.data.id);
  if (archive.error) throw new Error(`Could not archive media: ${archive.error.message}`);
  const remove = await supabase.storage.from(config.SUPABASE_BUCKET).remove([media.data.storage_path]);
  if (remove.error) console.error('Storage cleanup failed:', remove.error.message);
  await rebuildOrganizationManifests(media.data.organization_id);
  await audit({ actorId: req.authUser.id, organizationId: media.data.organization_id, action: 'media_archived', resourceType: 'media_asset', resourceId: media.data.id, before: { name: media.data.name, kind: media.data.kind } });
  res.json({ ok: true, data: await getBootstrapData(req.authUser) });
}));

async function getMediaAndAuthorize(req, res) {
  const supabase = getSupabase();
  const media = await supabase.from('media_assets').select('*').eq('id', req.params.id).eq('status', 'active').is('archived_at', null).maybeSingle();
  if (media.error) throw new Error(`Could not load media: ${media.error.message}`);
  if (!media.data) {
    errorResponse(res, 404, 'Media not found.');
    return null;
  }
  if (req.device) {
    if (String(req.device.organization_id) !== String(media.data.organization_id)) {
      errorResponse(res, 403, 'Media access denied.');
      return null;
    }
  } else if (!req.authUser || !assertOrganizationAccess(req.authUser, media.data.organization_id)) {
    errorResponse(res, req.authUser ? 403 : 401, req.authUser ? 'Media access denied.' : 'Authentication required.');
    return null;
  }
  return media.data;
}

app.get('/api/media/file/:kind/:id', requireUser, asyncRoute(async (req, res) => {
  const media = await getMediaAndAuthorize(req, res);
  if (!media) return;
  res.redirect(302, await signedMediaUrl(media.storage_path));
}));

app.get('/api/device/media/:id', deviceAuth, asyncRoute(async (req, res) => {
  const media = await getMediaAndAuthorize(req, res);
  if (!media) return;
  res.redirect(302, await signedMediaUrl(media.storage_path));
}));

app.post('/api/assistant/scripts', requireCompanyOrAdmin, asyncRoute(async (req, res) => {
  const organizationId = organizationIdForRequest(req, req.body.customerId || req.body.organizationId);
  if (!organizationId) return errorResponse(res, 400, 'Organization is required.');
  if (!assertOrganizationAccess(req.authUser, organizationId)) return errorResponse(res, 403, 'Organization access denied.');
  const title = cleanName(req.body.title);
  const text = cleanName(req.body.text);
  if (!title || !text) return errorResponse(res, 400, 'Title and content are required.');
  const supabase = getSupabase();
  let audioMediaId = null;
  try {
    audioMediaId = await validateAssistantAudio(organizationId, req.body.audioId || null);
  } catch (error) {
    if (error.statusCode) return errorResponse(res, error.statusCode, error.message);
    throw error;
  }
  const insert = await supabase.from('assistant_scripts').insert({
    organization_id: organizationId,
    script_key: cleanName(req.body.intent || 'manual'),
    title,
    language: req.body.language === 'en' ? 'en' : 'vi',
    text_content: text,
    audio_media_id: audioMediaId,
    enabled: req.body.enabled !== false,
    created_by: req.authUser.id,
  }).select('*').single();
  if (insert.error) throw new Error(`Could not create assistant script: ${insert.error.message}`);
  await rebuildOrganizationManifests(organizationId);
  await audit({ actorId: req.authUser.id, organizationId, action: 'assistant_script_created', resourceType: 'assistant_script', resourceId: insert.data.id, after: { title } });
  res.json({ ok: true, data: await getBootstrapData(req.authUser) });
}));

app.put('/api/assistant/scripts/:id', requireCompanyOrAdmin, asyncRoute(async (req, res) => {
  const supabase = getSupabase();
  const script = await supabase.from('assistant_scripts').select('*').eq('id', req.params.id).is('archived_at', null).maybeSingle();
  if (script.error) throw new Error(`Could not load assistant script: ${script.error.message}`);
  if (!script.data) return errorResponse(res, 404, 'Assistant script not found.');
  if (!assertOrganizationAccess(req.authUser, script.data.organization_id)) return errorResponse(res, 403, 'Assistant script access denied.');
  let audioMediaId = null;
  try {
    audioMediaId = await validateAssistantAudio(script.data.organization_id, req.body.audioId || null);
  } catch (error) {
    if (error.statusCode) return errorResponse(res, error.statusCode, error.message);
    throw error;
  }
  const patch = {
    title: cleanName(req.body.title || script.data.title),
    text_content: cleanName(req.body.text || script.data.text_content),
    script_key: cleanName(req.body.intent || script.data.script_key),
    language: req.body.language === 'en' ? 'en' : script.data.language,
    audio_media_id: audioMediaId,
    enabled: req.body.enabled !== false,
    updated_at: nowIso(),
  };
  const update = await supabase.from('assistant_scripts').update(patch).eq('id', req.params.id);
  if (update.error) throw new Error(`Could not update assistant script: ${update.error.message}`);
  await rebuildOrganizationManifests(script.data.organization_id);
  await audit({ actorId: req.authUser.id, organizationId: script.data.organization_id, action: 'assistant_script_updated', resourceType: 'assistant_script', resourceId: req.params.id, before: script.data, after: patch });
  res.json({ ok: true, data: await getBootstrapData(req.authUser) });
}));

app.delete('/api/assistant/scripts/:id', requireCompanyOrAdmin, asyncRoute(async (req, res) => {
  const supabase = getSupabase();
  const script = await supabase.from('assistant_scripts').select('*').eq('id', req.params.id).is('archived_at', null).maybeSingle();
  if (script.error) throw new Error(`Could not load assistant script: ${script.error.message}`);
  if (!script.data) return errorResponse(res, 404, 'Assistant script not found.');
  if (!assertOrganizationAccess(req.authUser, script.data.organization_id)) return errorResponse(res, 403, 'Assistant script access denied.');
  const timestamp = nowIso();
  const update = await supabase.from('assistant_scripts').update({ archived_at: timestamp, enabled: false, updated_at: timestamp }).eq('id', req.params.id);
  if (update.error) throw new Error(`Could not archive assistant script: ${update.error.message}`);
  await rebuildOrganizationManifests(script.data.organization_id);
  await audit({ actorId: req.authUser.id, organizationId: script.data.organization_id, action: 'assistant_script_archived', resourceType: 'assistant_script', resourceId: req.params.id, before: script.data });
  res.json({ ok: true, data: await getBootstrapData(req.authUser) });
}));

app.put('/api/admin/settings', requireAdmin, asyncRoute(async (req, res) => {
  const supabase = getSupabase();
  const patch = {
    maintenance_phone: cleanName(req.body.maintenancePhone),
    maintenance_email: cleanName(req.body.maintenanceEmail),
    maintenance_zalo: cleanName(req.body.maintenanceZalo),
    default_language: req.body.defaultLanguage === 'en' ? 'en' : 'vi',
    offline_warning_seconds: Math.max(15, Number(req.body.offlineWarning || 45)),
    offline_timeout_seconds: Math.max(30, Number(req.body.offlineTimeout || 90)),
    updated_at: nowIso(),
  };
  if (patch.offline_timeout_seconds <= patch.offline_warning_seconds) patch.offline_timeout_seconds = patch.offline_warning_seconds * 2;
  const update = await supabase.from('app_settings').update(patch).eq('id', 'main');
  if (update.error) throw new Error(`Could not update settings: ${update.error.message}`);
  await audit({ actorId: req.authUser.id, action: 'settings_updated', resourceType: 'app_settings', after: patch });
  res.json({ ok: true, data: await getBootstrapData(req.authUser) });
}));

// Device API - preferred routes without device code.
app.get('/api/device/manifest', deviceAuth, asyncRoute(async (req, res) => res.json(await serializeManifestForDevice(req.device))));
app.get('/api/device/:deviceCode/manifest', deviceAuth, asyncRoute(async (req, res) => res.json(await serializeManifestForDevice(req.device))));

async function heartbeatHandler(req, res) {
  const body = req.body || {};
  const supabase = getSupabase();
  const previous = await supabase.from('device_reported_states').select('*').eq('device_id', req.device.id).maybeSingle();
  if (previous.error) throw new Error(`Could not load previous heartbeat: ${previous.error.message}`);

  const runtimeState = cleanName(body.runtimeState || body.mode || 'UNKNOWN').toUpperCase();
  const appliedModeRaw = cleanName(body.appliedMode || body.mode || 'UNKNOWN').toUpperCase();
  const appliedMode = appliedModeRaw === 'JUST_ADS' ? 'ADS_ONLY' : appliedModeRaw;
  const cameraStatus = cleanName(body.components?.camera || body.cameraStatus || 'UNKNOWN').toUpperCase();
  const armStatus = cleanName(body.components?.arm || body.motorStatus || 'NOT_CONFIGURED').toUpperCase();
  const doorStatus = cleanName(body.components?.door || body.doorStatus || 'NOT_CONFIGURED').toUpperCase();
  const modelStatus = cleanName(body.components?.model || body.modelStatus || (body.frameOk === false ? 'MISSING' : 'UNKNOWN')).toUpperCase();
  const syncStatus = cleanName(body.sync?.status || body.syncStatus || 'UNKNOWN').toUpperCase();
  const installedVersion = Number(body.sync?.installedManifestVersion || body.contentVersion || 0);
  const lastError = cleanName(body.telemetry?.lastError || body.lastError || '');
  const reportedAt = body.reportedAt || nowIso();
  const telemetry = {
    ...(body.telemetry || {}),
    detectedZone: body.detectedZone,
    peopleCount: body.peopleCount,
    playbackTime: body.playbackTime,
    duration: body.duration,
    isPlaying: body.isPlaying,
    isPlayingAds: body.isPlayingAds,
    noPersonSeconds: body.noPersonSeconds,
    adsCountdown: body.adsCountdown,
    streamUrl: body.streamUrl,
    frameOk: body.frameOk,
    leftScore: body.leftScore,
    rightScore: body.rightScore,
    detectionThreshold: body.detectionThreshold,
  };

  const row = {
    device_id: req.device.id,
    reported_at: reportedAt,
    runtime_state: runtimeState,
    applied_power_state: cleanName(body.appliedPowerState || 'ON').toUpperCase(),
    applied_mode: appliedMode,
    camera_status: cameraStatus,
    arm_status: armStatus,
    door_status: doorStatus,
    model_status: modelStatus,
    sync_status: syncStatus,
    app_version: cleanName(body.application?.version || body.appVersion || ''),
    installed_manifest_version: installedVersion,
    current_media_id: body.application?.currentMediaId || null,
    current_media_name: cleanName(body.application?.currentMediaName || body.currentAd || ''),
    current_audio_name: cleanName(body.currentAudio || ''),
    person_detected: Boolean(body.telemetry?.personDetected ?? body.personDetected),
    storage_free_mb: Number(body.telemetry?.storageFreeMb ?? body.storageFreeMb) || null,
    last_error: lastError,
    telemetry,
    updated_at: nowIso(),
  };
  const upsert = await supabase.from('device_reported_states').upsert(row, { onConflict: 'device_id' });
  if (upsert.error) throw new Error(`Could not save heartbeat: ${upsert.error.message}`);

  if (!previous.data || (Date.now() - new Date(previous.data.reported_at).getTime()) / 1000 > config.HEARTBEAT_OFFLINE_SEC) {
    await addDeviceEvent({ deviceId: req.device.id, eventType: 'device_online', severity: 'SUCCESS', module: 'CONNECTIVITY', message: 'Device heartbeat restored.' });
  }
  const transitionFields = [
    ['camera_status', cameraStatus, 'camera_status_changed'],
    ['model_status', modelStatus, 'model_status_changed'],
    ['sync_status', syncStatus, 'sync_status_changed'],
    ['runtime_state', runtimeState, 'runtime_state_changed'],
  ];
  for (const [field, nextValue, eventType] of transitionFields) {
    if (previous.data && previous.data[field] !== nextValue) {
      await addDeviceEvent({
        deviceId: req.device.id,
        eventType,
        severity: ['ERROR', 'MISSING', 'FAILED'].includes(nextValue) ? 'ERROR' : 'INFO',
        module: field.split('_')[0].toUpperCase(),
        message: `${previous.data[field]} -> ${nextValue}`,
        payload: { from: previous.data[field], to: nextValue },
      });
    }
  }

  const latest = await getLatestManifest(req.device.id);
  const syncRequested = req.device.sync_requested_at ? new Date(req.device.sync_requested_at).getTime() : 0;
  const lastSync = body.sync?.lastSyncAt ? new Date(body.sync.lastSyncAt).getTime() : 0;
  res.json({
    ok: true,
    serverTime: nowIso(),
    desiredPowerState: req.device.desired_power_state,
    desiredMode: req.device.desired_mode,
    manifestVersion: Number(latest.version || 0),
    desiredManifestVersion: Number(latest.version || 0),
    manifestUpdateAvailable: installedVersion < Number(latest.version || 0),
    syncNow: Boolean(syncRequested && syncRequested > lastSync),
    heartbeatIntervalSec: config.DEVICE_HEARTBEAT_INTERVAL_SEC,
  });
}

app.post('/api/device/heartbeat', deviceAuth, asyncRoute(heartbeatHandler));
app.post('/api/device/:deviceCode/heartbeat', deviceAuth, asyncRoute(heartbeatHandler));

async function eventHandler(req, res) {
  const body = req.body || {};
  await addDeviceEvent({
    deviceId: req.device.id,
    eventType: cleanName(body.eventType || body.event || 'runtime_log').toLowerCase().replace(/\s+/g, '_'),
    severity: ['INFO', 'SUCCESS', 'WARNING', 'ERROR'].includes(String(body.severity || body.level || '').toUpperCase()) ? String(body.severity || body.level).toUpperCase() : 'INFO',
    module: cleanName(body.module || 'RUNTIME').toUpperCase(),
    message: cleanName(body.message || '').slice(0, 2000),
    payload: body.payload || {},
    occurredAt: body.occurredAt || null,
  });
  res.json({ ok: true });
}
app.post('/api/device/events', deviceAuth, asyncRoute(eventHandler));
app.post('/api/device/:deviceCode/logs', deviceAuth, asyncRoute(eventHandler));

app.use('/assets', express.static(path.join(config.ROOT, 'assets'), {
  etag: true,
  maxAge: config.isProduction ? '1h' : 0,
}));
app.get('/styles.css', (_req, res) => res.sendFile(path.join(config.ROOT, 'styles.css')));
app.get('/app.js', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(config.ROOT, 'app.js'));
});
app.get(['/', '/index.html'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(config.ROOT, 'index.html'));
});

app.use('/api', (_req, res) => errorResponse(res, 404, 'API route not found.'));
app.use((_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(config.ROOT, 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error.type === 'entity.too.large' ? 413 : Number(error.statusCode || 500);
  const message = status === 413 ? 'Uploaded data is too large.' : status < 500 ? error.message : 'Internal server error.';
  errorResponse(res, status, message, config.isProduction || status < 500 ? undefined : error.message);
});

async function start() {
  try {
    await ensureBootstrapAdmin();
    console.log('Phase 1 database ready.');
  } catch (error) {
    console.error('Startup database check failed:', error.message);
    console.error('The server will still start so /health can report the configuration problem.');
  }
  app.listen(config.PORT, () => {
    console.log(`TLC HoloBox Manager Phase 1 listening on http://localhost:${config.PORT}`);
  });
}

start();
