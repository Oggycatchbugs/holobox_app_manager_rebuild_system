const config = require('./config');
const { getSupabase } = require('./db');
const {
  cleanName,
  normalizeName,
  nowIso,
  formatBytes,
  hashPassword,
  publicRole,
} = require('./utils');

async function ensureBootstrapAdmin() {
  const supabase = getSupabase();
  const { data: existing, error } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'platform_admin')
    .is('archived_at', null)
    .limit(1);
  if (error) throw new Error(`Could not check bootstrap admin: ${error.message}`);
  if (existing?.length) return false;
  if (!config.ADMIN_INITIAL_PASSWORD) {
    throw new Error('ADMIN_INITIAL_PASSWORD is required for the first deploy.');
  }
  const { error: insertError } = await supabase.from('users').insert({
    username: config.ADMIN_INITIAL_USERNAME,
    password_hash: hashPassword(config.ADMIN_INITIAL_PASSWORD),
    display_name: config.ADMIN_INITIAL_NAME,
    role: 'platform_admin',
    active: true,
    language: 'vi',
  });
  if (insertError) throw new Error(`Could not create bootstrap admin: ${insertError.message}`);
  return true;
}

async function audit({ actorType = 'user', actorId = null, organizationId = null, action, resourceType, resourceId = null, before = null, after = null }) {
  const supabase = getSupabase();
  const { error } = await supabase.from('audit_logs').insert({
    actor_type: actorType,
    actor_id: actorId,
    organization_id: organizationId,
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    before_data: before,
    after_data: after,
  });
  if (error) console.error('Audit insert failed:', error.message);
}

async function addDeviceEvent({ deviceId, eventType, severity = 'INFO', module = 'RUNTIME', message = '', payload = {}, occurredAt = null }) {
  const supabase = getSupabase();
  const { error } = await supabase.from('device_events').insert({
    device_id: deviceId,
    event_type: eventType,
    severity,
    module,
    message,
    payload,
    occurred_at: occurredAt || nowIso(),
  });
  if (error) throw new Error(`Could not store device event: ${error.message}`);
}

async function getSettings() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('app_settings').select('*').eq('id', 'main').maybeSingle();
  if (error) throw new Error(`Could not load settings: ${error.message}`);
  return data || {
    id: 'main',
    system_name: 'TLC HoloBox Manager',
    default_language: 'vi',
    maintenance_phone: '090x xxx xxx',
    maintenance_email: 'support@tlc.vn',
    maintenance_zalo: '',
    offline_warning_seconds: config.HEARTBEAT_WARNING_SEC,
    offline_timeout_seconds: config.HEARTBEAT_OFFLINE_SEC,
  };
}

async function ensureActivePlaylist(organizationId, userId = null) {
  const supabase = getSupabase();
  let { data, error } = await supabase
    .from('playlists')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('type', 'advertisement')
    .eq('is_active', true)
    .is('archived_at', null)
    .maybeSingle();
  if (error) throw new Error(`Could not load active playlist: ${error.message}`);
  if (data) return data;
  const inserted = await supabase.from('playlists').insert({
    organization_id: organizationId,
    name: 'Active Ads Playlist',
    type: 'advertisement',
    is_active: true,
    created_by: userId,
  }).select('*').single();
  if (inserted.error) throw new Error(`Could not create active playlist: ${inserted.error.message}`);
  return inserted.data;
}

async function getPlaylistItems(playlistId) {
  if (!playlistId) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('playlist_items')
    .select('id,playlist_id,media_asset_id,sort_order,media_assets(*)')
    .eq('playlist_id', playlistId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(`Could not load playlist items: ${error.message}`);
  return data || [];
}

async function reconcileActiveAdvertisementPlaylist(organizationId, playlistId) {
  const supabase = getSupabase();
  const [mediaResult, itemResult] = await Promise.all([
    supabase
      .from('media_assets')
      .select('id,created_at')
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .neq('kind', 'system_audio')
      .is('archived_at', null)
      .order('created_at', { ascending: true }),
    supabase
      .from('playlist_items')
      .select('media_asset_id,sort_order')
      .eq('playlist_id', playlistId)
      .order('sort_order', { ascending: true }),
  ]);
  if (mediaResult.error) throw new Error(`Could not load advertisement media: ${mediaResult.error.message}`);
  if (itemResult.error) throw new Error(`Could not load advertisement playlist items: ${itemResult.error.message}`);

  const existingIds = new Set((itemResult.data || []).map(item => String(item.media_asset_id)));
  let nextOrder = Math.max(0, ...(itemResult.data || []).map(item => Number(item.sort_order || 0))) + 1;
  const missingRows = (mediaResult.data || [])
    .filter(media => !existingIds.has(String(media.id)))
    .map(media => ({ playlist_id: playlistId, media_asset_id: media.id, sort_order: nextOrder++ }));

  if (missingRows.length) {
    const inserted = await supabase.from('playlist_items').insert(missingRows);
    if (inserted.error) throw new Error(`Could not repair advertisement playlist: ${inserted.error.message}`);
  }
  return missingRows.length;
}

function manifestMediaItem(media, sortOrder) {
  return {
    id: media.id,
    name: media.name,
    kind: media.kind,
    mimeType: media.mime_type,
    sizeBytes: Number(media.size_bytes || 0),
    checksumSha256: media.checksum_sha256 || '',
    durationSeconds: Number(media.duration_seconds || 0),
    storagePath: media.storage_path,
    order: Number(sortOrder || 0),
  };
}

async function buildManifestBase(device) {
  const supabase = getSupabase();
  // The organization active playlist is authoritative. Older devices may still
  // point to a stale playlist, which made Manager show two ads while the device
  // manifest contained only one.
  const playlist = await ensureActivePlaylist(device.organization_id);
  if (device.active_playlist_id !== playlist.id) {
    const update = await supabase
      .from('devices')
      .update({ active_playlist_id: playlist.id, updated_at: nowIso() })
      .eq('id', device.id);
    if (update.error) throw new Error(`Could not align device playlist: ${update.error.message}`);
    device.active_playlist_id = playlist.id;
  }
  // Uploads are designed to be auto-added to the active advertisement playlist.
  // Repair legacy/missing playlist rows before generating the manifest.
  await reconcileActiveAdvertisementPlaylist(device.organization_id, playlist.id);
  const playlistItems = await getPlaylistItems(playlist.id);
  const videos = playlistItems
    .filter(row => row.media_assets && row.media_assets.status === 'active' && !row.media_assets.archived_at && row.media_assets.kind !== 'system_audio')
    .map(row => manifestMediaItem(row.media_assets, row.sort_order));

  const { data: audio, error: audioError } = await supabase
    .from('media_assets')
    .select('*')
    .eq('organization_id', device.organization_id)
    .eq('kind', 'system_audio')
    .eq('status', 'active')
    .is('archived_at', null)
    .order('created_at', { ascending: true });
  if (audioError) throw new Error(`Could not load audio manifest: ${audioError.message}`);

  const { data: scripts, error: scriptError } = await supabase
    .from('assistant_scripts')
    .select('*')
    .eq('organization_id', device.organization_id)
    .eq('enabled', true)
    .is('archived_at', null)
    .order('created_at', { ascending: true });
  if (scriptError) throw new Error(`Could not load assistant scripts: ${scriptError.message}`);

  return {
    schemaVersion: 1,
    device: { id: device.id, deviceCode: device.device_code },
    desired: {
      powerState: device.desired_power_state,
      mode: device.desired_mode,
    },
    videoPlaylist: videos,
    audioPlaylist: (audio || []).map((media, index) => manifestMediaItem(media, index + 1)),
    assistantScripts: (scripts || []).map(script => ({
      id: script.id,
      key: script.script_key,
      title: script.title,
      language: script.language,
      text: script.text_content,
      audioMediaId: script.audio_media_id,
      enabled: script.enabled,
    })),
    settings: {
      loop: true,
      syncMode: 'startup_once_per_day',
      defaultLanguage: device.default_language === 'en' ? 'en' : 'vi',
    },
  };
}

async function rebuildDeviceManifest(deviceId, activated = true) {
  const supabase = getSupabase();
  const { data: device, error: deviceError } = await supabase
    .from('devices')
    .select('*')
    .eq('id', deviceId)
    .is('archived_at', null)
    .single();
  if (deviceError) throw new Error(`Could not load device for manifest: ${deviceError.message}`);

  const { data: latest, error: latestError } = await supabase
    .from('device_manifests')
    .select('version')
    .eq('device_id', deviceId)
    .order('version', { ascending: false })
    .limit(1);
  if (latestError) throw new Error(`Could not load manifest version: ${latestError.message}`);
  const version = Number(latest?.[0]?.version || 0) + 1;
  const payload = await buildManifestBase(device);
  payload.version = version;
  payload.generatedAt = nowIso();

  const { data, error } = await supabase.from('device_manifests').insert({
    device_id: deviceId,
    version,
    payload,
    activated_at: activated ? nowIso() : null,
  }).select('*').single();
  if (error) throw new Error(`Could not create manifest: ${error.message}`);
  return data;
}

async function rebuildOrganizationManifests(organizationId) {
  const supabase = getSupabase();
  const { data: devices, error } = await supabase
    .from('devices')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .is('archived_at', null);
  if (error) throw new Error(`Could not load devices for manifest rebuild: ${error.message}`);
  const results = [];
  for (const device of devices || []) results.push(await rebuildDeviceManifest(device.id));
  return results;
}

async function getLatestManifest(deviceId) {
  const supabase = getSupabase();
  const deviceResult = await supabase
    .from('devices')
    .select('*')
    .eq('id', deviceId)
    .is('archived_at', null)
    .single();
  if (deviceResult.error) throw new Error(`Could not load device for manifest validation: ${deviceResult.error.message}`);
  const device = deviceResult.data;
  const playlist = await ensureActivePlaylist(device.organization_id);
  let repaired = false;
  if (device.active_playlist_id !== playlist.id) {
    const update = await supabase
      .from('devices')
      .update({ active_playlist_id: playlist.id, updated_at: nowIso() })
      .eq('id', device.id);
    if (update.error) throw new Error(`Could not align device playlist: ${update.error.message}`);
    repaired = true;
  }
  repaired = (await reconcileActiveAdvertisementPlaylist(device.organization_id, playlist.id)) > 0 || repaired;

  let { data, error } = await supabase
    .from('device_manifests')
    .select('*')
    .eq('device_id', deviceId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not load latest manifest: ${error.message}`);

  const canonicalItems = (await getPlaylistItems(playlist.id))
    .filter(row => row.media_assets && row.media_assets.status === 'active' && !row.media_assets.archived_at && row.media_assets.kind !== 'system_audio')
    .map(row => [
      String(row.media_assets.id),
      String(row.media_assets.checksum_sha256 || ''),
      Number(row.sort_order || 0),
    ]);
  const manifestItems = (data?.payload?.videoPlaylist || []).map(item => [
    String(item.id || ''),
    String(item.checksumSha256 || ''),
    Number(item.order || 0),
  ]);
  const playlistChanged = JSON.stringify(canonicalItems) !== JSON.stringify(manifestItems);
  if (!data || repaired || playlistChanged) data = await rebuildDeviceManifest(deviceId);
  return data;
}

function computeDeviceState(device, reported, settings) {
  const warningSec = Number(settings.offline_warning_seconds || config.HEARTBEAT_WARNING_SEC);
  const offlineSec = Number(settings.offline_timeout_seconds || config.HEARTBEAT_OFFLINE_SEC);
  const lastSeen = reported?.reported_at ? new Date(reported.reported_at).getTime() : 0;
  const ageSec = lastSeen ? Math.max(0, (Date.now() - lastSeen) / 1000) : Infinity;
  let connectivity = 'OFFLINE';
  if (ageSec <= warningSec) connectivity = 'ONLINE';
  else if (ageSec <= offlineSec) connectivity = 'WARNING';

  let displayStatus = 'Offline';
  if (device.desired_power_state === 'OFF') displayStatus = 'Powered Off';
  else if (connectivity === 'OFFLINE') displayStatus = 'Offline';
  else if (connectivity === 'WARNING') displayStatus = 'Connecting';
  else if (['ERROR', 'MISSING'].includes(String(reported?.model_status || '').toUpperCase())) displayStatus = 'Error';
  else if (String(reported?.runtime_state || '').toUpperCase() === 'ERROR' || reported?.last_error) displayStatus = 'Error';
  else if ([
    'STARTING', 'BOOT', 'BOOTING', 'SETUP', 'SYSTEM_CHECK', 'MANIFEST_CHECK',
    'SYNC_PLAN', 'DOWNLOADING', 'VERIFYING', 'ACTIVATING', 'SYNC_COMPLETE',
    'SELF_TEST', 'SYNCING', 'LOADING',
  ].includes(String(reported?.runtime_state || '').toUpperCase())) displayStatus = 'Connecting';
  else displayStatus = 'Online';

  const companyStatus = displayStatus === 'Online'
    ? 'Đang hoạt động'
    : displayStatus === 'Powered Off'
      ? 'Đã tắt'
      : displayStatus === 'Connecting'
        ? 'Đang khởi động'
        : 'Cần hỗ trợ';

  return { connectivity, displayStatus, companyStatus, ageSec };
}

function mediaToLegacy(media) {
  const isAudio = media.kind === 'system_audio';
  const isImage = media.kind === 'advertisement_image';
  return {
    id: media.id,
    customerId: media.organization_id,
    organizationId: media.organization_id,
    name: media.name,
    kind: media.kind,
    type: isAudio ? 'Audio' : isImage ? 'Image' : 'Video',
    duration: formatDuration(media.duration_seconds),
    durationSeconds: Number(media.duration_seconds || 0),
    size: formatBytes(media.size_bytes),
    sizeBytes: Number(media.size_bytes || 0),
    role: media.role_key || '',
    status: media.status === 'active' ? 'Active' : 'Archived',
    mimeType: media.mime_type,
    storagePath: media.storage_path,
    checksumSha256: media.checksum_sha256,
    updated: media.updated_at || media.created_at,
  };
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

async function getBootstrapData(user) {
  const supabase = getSupabase();
  const settings = await getSettings();
  const orgFilter = user.role === 'platform_admin' ? null : user.organization_id;

  let orgQuery = supabase.from('organizations').select('*').is('archived_at', null).order('created_at', { ascending: false });
  let usersQuery = supabase.from('users').select('*').is('archived_at', null).order('created_at', { ascending: false });
  let deviceQuery = supabase.from('devices').select('*').is('archived_at', null).order('created_at', { ascending: false });
  let mediaQuery = supabase.from('media_assets').select('*').is('archived_at', null).order('created_at', { ascending: false });
  let playlistQuery = supabase.from('playlists').select('*').is('archived_at', null).order('created_at', { ascending: false });
  let scriptQuery = supabase.from('assistant_scripts').select('*').is('archived_at', null).order('created_at', { ascending: false });

  if (orgFilter) {
    orgQuery = orgQuery.eq('id', orgFilter);
    usersQuery = usersQuery.eq('organization_id', orgFilter);
    deviceQuery = deviceQuery.eq('organization_id', orgFilter);
    mediaQuery = mediaQuery.eq('organization_id', orgFilter);
    playlistQuery = playlistQuery.eq('organization_id', orgFilter);
    scriptQuery = scriptQuery.eq('organization_id', orgFilter);
  }

  const [orgRes, userRes, deviceRes, stateRes, mediaRes, playlistRes, itemRes, scriptRes, manifestRes] = await Promise.all([
    orgQuery,
    usersQuery,
    deviceQuery,
    supabase.from('device_reported_states').select('*'),
    mediaQuery,
    playlistQuery,
    supabase.from('playlist_items').select('*').order('sort_order', { ascending: true }),
    scriptQuery,
    supabase.from('device_manifests').select('device_id,version'),
  ]);
  for (const response of [orgRes, userRes, deviceRes, stateRes, mediaRes, playlistRes, itemRes, scriptRes, manifestRes]) {
    if (response.error) throw new Error(`Could not load manager data: ${response.error.message}`);
  }

  const organizations = orgRes.data || [];
  const users = (userRes.data || []).map(item => ({
    id: item.id,
    username: item.username,
    name: item.display_name,
    role: publicRole(item.role),
    rawRole: item.role,
    customerId: item.organization_id,
    organizationId: item.organization_id,
    active: item.active,
    language: item.language,
    lastLoginAt: item.last_login_at,
  }));
  const stateMap = new Map((stateRes.data || []).map(row => [row.device_id, row]));
  const manifestVersionMap = new Map();
  for (const row of manifestRes.data || []) {
    const current = Number(manifestVersionMap.get(row.device_id) || 0);
    manifestVersionMap.set(row.device_id, Math.max(current, Number(row.version || 0)));
  }
  const devices = (deviceRes.data || []).map(device => {
    const reported = stateMap.get(device.id) || null;
    const computed = computeDeviceState(device, reported, settings);
    return {
      id: device.id,
      customerId: device.organization_id,
      organizationId: device.organization_id,
      name: device.name,
      deviceCode: device.device_code,
      location: device.location_name,
      streamUrl: device.stream_url,
      screenUrl: reported?.telemetry?.holoboxScreenUrl || reported?.telemetry?.streamUrl || device.stream_url,
      defaultLanguage: device.default_language === 'en' ? 'en' : 'vi',
      desiredPowerState: device.desired_power_state,
      desiredMode: device.desired_mode,
      powerCommand: device.desired_power_state === 'ON' ? 'START' : 'STOP',
      runtimeMode: device.desired_mode === 'ADS_ONLY' ? 'JUST_ADS' : 'ASSISTANT',
      activePlaylistId: device.active_playlist_id,
      status: computed.displayStatus,
      companyStatus: computed.companyStatus,
      connectivity: computed.connectivity,
      lastSeenAt: reported?.reported_at || null,
      runtimeState: reported?.runtime_state || 'UNKNOWN',
      appliedPowerState: reported?.applied_power_state || 'UNKNOWN',
      appliedMode: reported?.applied_mode || 'UNKNOWN',
      cameraStatus: reported?.camera_status || 'UNKNOWN',
      armStatus: reported?.arm_status || 'NOT_CONFIGURED',
      doorStatus: reported?.door_status || 'NOT_CONFIGURED',
      modelStatus: reported?.model_status || 'UNKNOWN',
      syncStatus: reported?.sync_status || 'UNKNOWN',
      appVersion: reported?.app_version || '',
      installedManifestVersion: Number(reported?.installed_manifest_version || 0),
      desiredManifestVersion: Number(manifestVersionMap.get(device.id) || 0),
      currentVideoId: reported?.current_media_id || '',
      currentAd: reported?.current_media_name || '',
      currentAudio: reported?.current_audio_name || '',
      currentScreen: reported?.telemetry?.displayScreen || reported?.current_media_name || reported?.runtime_state || '',
      personDetected: Boolean(reported?.person_detected),
      storageFreeMb: reported?.storage_free_mb,
      lastError: reported?.last_error || '',
      telemetry: reported?.telemetry || {},
      syncRequestedAt: device.sync_requested_at,
      createdAt: device.created_at,
    };
  });

  const media = mediaRes.data || [];
  const videos = media.filter(item => item.kind !== 'system_audio').map(mediaToLegacy);
  const audio = media.filter(item => item.kind === 'system_audio').map(mediaToLegacy);
  const itemMap = new Map();
  for (const item of itemRes.data || []) {
    if (!itemMap.has(item.playlist_id)) itemMap.set(item.playlist_id, []);
    itemMap.get(item.playlist_id).push({ mediaId: item.media_asset_id, order: item.sort_order });
  }
  const videoPlaylists = (playlistRes.data || []).filter(p => p.type === 'advertisement').map(p => ({
    id: p.id,
    customerId: p.organization_id,
    organizationId: p.organization_id,
    name: p.name,
    autoGenerated: true,
    loop: true,
    isActive: p.is_active,
    items: itemMap.get(p.id) || [],
  }));
  const audioPlaylists = (playlistRes.data || []).filter(p => p.type === 'audio').map(p => ({
    id: p.id,
    customerId: p.organization_id,
    name: p.name,
    items: itemMap.get(p.id) || [],
  }));
  const assistantScripts = (scriptRes.data || []).map(script => ({
    id: script.id,
    customerId: script.organization_id,
    organizationId: script.organization_id,
    intent: script.script_key,
    title: script.title,
    language: script.language,
    text: script.text_content,
    audioId: script.audio_media_id || '',
    enabled: script.enabled,
    createdAt: script.created_at,
  }));

  let logs = [];
  if (user.role === 'platform_admin') {
    const [eventRes, auditRes] = await Promise.all([
      supabase.from('device_events').select('*,devices(name,device_code,organization_id)').order('occurred_at', { ascending: false }).limit(150),
      supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(150),
    ]);
    if (eventRes.error) throw new Error(`Could not load device events: ${eventRes.error.message}`);
    if (auditRes.error) throw new Error(`Could not load audit logs: ${auditRes.error.message}`);
    logs = [
      ...(eventRes.data || []).map(event => ({
        id: event.id,
        time: event.occurred_at,
        device: event.devices?.device_code || 'Device',
        category: event.module,
        event: event.event_type,
        status: event.severity,
        detail: event.message,
        customerId: event.devices?.organization_id,
        logType: 'device_event',
      })),
      ...(auditRes.data || []).map(row => ({
        id: row.id,
        time: row.created_at,
        device: 'Manager',
        category: 'Audit',
        event: row.action,
        status: 'INFO',
        detail: `${row.resource_type}${row.resource_id ? ` · ${row.resource_id}` : ''}`,
        customerId: row.organization_id,
        logType: 'audit',
      })),
    ].sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 200);
  }

  return {
    users,
    customers: organizations.map(org => ({
      id: org.id,
      name: org.name,
      contactName: org.contact_name,
      phone: org.phone,
      email: org.email,
      status: org.status,
      createdAt: org.created_at,
    })),
    locations: [],
    devices,
    videos,
    audio,
    videoPlaylists,
    audioPlaylists,
    autoPlaylists: [],
    assistantScripts,
    logs,
    settings: {
      systemName: settings.system_name,
      defaultLanguage: settings.default_language,
      language: settings.default_language,
      maintenancePhone: settings.maintenance_phone,
      maintenanceEmail: settings.maintenance_email,
      maintenanceZalo: settings.maintenance_zalo,
      offlineWarning: String(settings.offline_warning_seconds),
      offlineTimeout: String(settings.offline_timeout_seconds),
      maxUploadMb: String(Math.round(config.UPLOAD_MAX_BYTES / 1024 / 1024)),
    },
  };
}

module.exports = {
  ensureBootstrapAdmin,
  audit,
  addDeviceEvent,
  getSettings,
  ensureActivePlaylist,
  getPlaylistItems,
  rebuildDeviceManifest,
  rebuildOrganizationManifests,
  getLatestManifest,
  computeDeviceState,
  getBootstrapData,
};
