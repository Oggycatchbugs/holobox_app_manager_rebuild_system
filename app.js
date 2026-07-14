const APP_VERSION = '14.0.0-phase1-foundation';
const STORAGE_KEY = 'holobox_manager_phase1_cache_v14';
const TLC_LOGO_SRC = 'assets/tlc-logo.png';

let state = {
  ready: false,
  user: null,
  portal: 'login',
  view: 'login',
  language: localStorage.getItem('holobox_lang') || 'vi',
  viewingCustomerId: '',
  selectedCustomerId: '',
  mediaTab: 'video',
  data: defaultData(),
};

const appRoot = document.getElementById('app');
const modalRoot = document.getElementById('modalRoot');
const toastRoot = document.getElementById('toastRoot');

const dict = {
  vi: {
    Login: 'Đăng nhập', Logout: 'Đăng xuất', Username: 'Tên đăng nhập', Password: 'Mật khẩu',
    Home: 'Trang chủ', Video: 'Quảng cáo', Audio: 'Âm thanh', Assistant: 'Lễ tân ảo', Contact: 'Liên hệ',
    Dashboard: 'Tổng quan', Customers: 'Công ty', Logs: 'Nhật ký', Maintenance: 'Thiết bị', Settings: 'Cài đặt',
    Online: 'Online', Offline: 'Offline', Connecting: 'Đang kết nối', Error: 'Lỗi', 'Powered Off': 'Đã tắt',
    'Assistant Mode': 'Chế độ lễ tân', 'Just Ads Mode': 'Chỉ quảng cáo', Status: 'Trạng thái', Mode: 'Chế độ',
    'Last seen': 'Lần cuối', 'Video list': 'Danh sách quảng cáo', 'Receptionist audio': 'Audio lễ tân',
    Preview: 'Xem thử', Delete: 'Xóa', Edit: 'Sửa', Save: 'Lưu', Close: 'Đóng', Upload: 'Tải lên',
    'No data': 'Chưa có dữ liệu', 'Create customer': 'Tạo công ty', 'Create device': 'Tạo HoloBox',
    'View as Customer': 'Xem như công ty', 'Back to Admin': 'Về Admin', Open: 'Mở', Info: 'Thông tin',
  },
  en: {},
};
dict.en = Object.fromEntries(Object.keys(dict.vi).map(key => [key, key]));

function t(key) { return dict[state.language]?.[key] || key; }
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}
function normalizeName(value) { return String(value || '').trim().toLowerCase(); }
function formatTime(seconds) {
  const value = Math.max(0, Math.round(Number(seconds || 0)));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
function icon(name) {
  const icons = {
    home: '⌂', video: '▶', audio: '♪', logout: '↩', users: '👥', monitor: '▣', assistant: '◉',
    logs: '≡', wrench: '⚙', settings: '⚙', upload: '⇧', phone: '☎', mail: '✉', back: '←',
    refresh: '↻', info: 'i', edit: '✎', power: '⏻', plus: '+', key: '⌘', sync: '↻', drag: '☰',
  };
  return `<span class="ico">${icons[name] || '•'}</span>`;
}

function defaultData() {
  return {
    users: [], customers: [], devices: [], videos: [], audio: [], videoPlaylists: [], audioPlaylists: [],
    assistantScripts: [], logs: [], settings: {
      systemName: 'TLC HoloBox Manager', defaultLanguage: 'vi', maintenancePhone: '090x xxx xxx',
      maintenanceEmail: 'support@tlc.vn', maintenanceZalo: '', offlineWarning: '45', offlineTimeout: '90', maxUploadMb: '250',
    },
  };
}
function mergeData(remote) {
  const fallback = defaultData();
  const incoming = remote && typeof remote === 'object' ? remote : {};
  return {
    ...fallback, ...incoming,
    users: Array.isArray(incoming.users) ? incoming.users : [],
    customers: Array.isArray(incoming.customers) ? incoming.customers : [],
    devices: Array.isArray(incoming.devices) ? incoming.devices : [],
    videos: Array.isArray(incoming.videos) ? incoming.videos : [],
    audio: Array.isArray(incoming.audio) ? incoming.audio : [],
    videoPlaylists: Array.isArray(incoming.videoPlaylists) ? incoming.videoPlaylists : [],
    audioPlaylists: Array.isArray(incoming.audioPlaylists) ? incoming.audioPlaylists : [],
    assistantScripts: Array.isArray(incoming.assistantScripts) ? incoming.assistantScripts : [],
    logs: Array.isArray(incoming.logs) ? incoming.logs : [],
    settings: { ...fallback.settings, ...(incoming.settings || {}) },
  };
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}
async function loadData() {
  const payload = await apiJson('/api/bootstrap');
  state.data = mergeData(payload.data);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  return state.data;
}
async function refreshData() { await loadData(); render(); }

function showLoading(title = 'Processing...', subtitle = 'Please wait') {
  const overlay = document.getElementById('loadingOverlay');
  document.getElementById('loadingTitle').textContent = title;
  document.getElementById('loadingSubtitle').textContent = subtitle;
  overlay?.classList.remove('hidden');
}
function hideLoading() { document.getElementById('loadingOverlay')?.classList.add('hidden'); }
function toast(type, title, message = '') {
  const element = document.createElement('div');
  element.className = `toast ${type || 'info'}`;
  element.innerHTML = `<strong>${escapeHtml(title)}</strong>${message ? `<span>${escapeHtml(message)}</span>` : ''}`;
  toastRoot.appendChild(element);
  setTimeout(() => element.remove(), 4200);
}
function modal(title, body, actions = '') {
  modalRoot.innerHTML = `<div class="modal-backdrop" data-backdrop-close="true"><div class="modal-card">
    <div class="modal-head"><h2>${escapeHtml(title)}</h2><button class="icon-close" data-action="close-modal">×</button></div>
    <div class="modal-body">${body}</div>${actions ? `<div class="modal-actions">${actions}</div>` : ''}
  </div></div>`;
}
function closeModal() { modalRoot.innerHTML = ''; }
async function confirmModal(title, text) {
  return new Promise(resolve => {
    modal(title, `<p>${escapeHtml(text)}</p>`, `<button class="action-btn" data-confirm="no">${t('Close')}</button><button class="action-btn danger" data-confirm="yes">${t('Delete')}</button>`);
    const handler = event => {
      const button = event.target.closest('[data-confirm]');
      if (!button) return;
      modalRoot.removeEventListener('click', handler);
      closeModal();
      resolve(button.dataset.confirm === 'yes');
    };
    modalRoot.addEventListener('click', handler);
  });
}

function currentCustomerId() {
  if (state.user?.role === 'admin' && state.viewingCustomerId) return state.viewingCustomerId;
  return state.user?.customerId || '';
}
function customerName(id = currentCustomerId()) { return state.data.customers.find(item => item.id === id)?.name || 'Company'; }
function customerDevices(id = currentCustomerId()) { return state.data.devices.filter(item => String(item.customerId) === String(id)); }
function primaryDevice() { return customerDevices()[0] || null; }
function customerVideos(id = currentCustomerId()) { return state.data.videos.filter(item => String(item.customerId) === String(id)); }
function customerAudios(id = currentCustomerId()) { return state.data.audio.filter(item => String(item.customerId) === String(id)); }
function customerScripts(id = currentCustomerId()) { return state.data.assistantScripts.filter(item => String(item.customerId) === String(id)); }
function activePlaylist(id = currentCustomerId()) { return state.data.videoPlaylists.find(item => String(item.customerId) === String(id) && item.isActive) || state.data.videoPlaylists.find(item => String(item.customerId) === String(id)); }
function playlistMedia(id = currentCustomerId()) {
  const videos = customerVideos(id);
  const playlist = activePlaylist(id);
  if (!playlist) return videos;
  return (playlist.items || []).sort((a, b) => a.order - b.order).map(item => videos.find(video => video.id === item.mediaId)).filter(Boolean);
}
function mediaName(id) { return state.data.audio.find(item => item.id === id)?.name || ''; }
function computedDeviceStatus(device) { return device?.status || 'Offline'; }
function lastSeenLabel(value) {
  if (!value) return 'Never';
  const time = new Date(value).getTime();
  if (!time) return 'Never';
  const age = Math.max(0, Date.now() - time);
  if (age < 10000) return 'Just now';
  if (age < 60000) return `${Math.round(age / 1000)}s ago`;
  if (age < 3600000) return `${Math.round(age / 60000)}m ago`;
  return new Date(time).toLocaleString();
}
function statusBadge(status) {
  const value = String(status || 'Offline');
  const normalized = value.toLowerCase();
  let cls = 'gray';
  if (['online', 'active', 'success', 'đang hoạt động'].includes(normalized)) cls = 'green';
  else if (['connecting', 'warning', 'pending', 'đang khởi động'].includes(normalized)) cls = 'orange';
  else if (['offline', 'error', 'inactive', 'powered off', 'cần hỗ trợ', 'đã tắt'].includes(normalized)) cls = 'red';
  return `<span class="badge ${cls}">${cls === 'green' ? '<span class="status-dot"></span>' : ''}${escapeHtml(t(value))}</span>`;
}

const adminNav = [
  ['dashboard', 'Dashboard', 'home'], ['customers', 'Customers', 'users'],
  ['logs', 'Logs', 'logs'], ['maintenance', 'Maintenance', 'wrench'], ['settings', 'Settings', 'settings'],
];
const customerNav = [
  ['customerHome', 'Home', 'home'], ['customerVideo', 'Video', 'video'], ['customerAudio', 'Audio', 'audio'], ['customerAssistant', 'Assistant', 'assistant'],
];

function flagSvg(lang) {
  if (lang === 'vi') {
    return `<svg viewBox="0 0 30 20" class="flag-svg" aria-hidden="true"><rect width="30" height="20" rx="2" fill="#da251d"/><polygon fill="#ff0" points="15,3.2 16.8,8.1 22,8.1 17.7,11.1 19.4,16 15,13 10.6,16 12.3,11.1 8,8.1 13.2,8.1"/></svg>`;
  }
  return `<svg viewBox="0 0 30 20" class="flag-svg" aria-hidden="true"><rect width="30" height="20" rx="2" fill="#fff"/><g fill="#b22234"><rect y="0" width="30" height="1.54"/><rect y="3.08" width="30" height="1.54"/><rect y="6.16" width="30" height="1.54"/><rect y="9.24" width="30" height="1.54"/><rect y="12.32" width="30" height="1.54"/><rect y="15.4" width="30" height="1.54"/><rect y="18.48" width="30" height="1.52"/></g><rect width="12.6" height="10.8" rx="1" fill="#3c3b6e"/><g fill="#fff"><circle cx="2" cy="2" r=".55"/><circle cx="5" cy="2" r=".55"/><circle cx="8" cy="2" r=".55"/><circle cx="11" cy="2" r=".55"/><circle cx="3.5" cy="4" r=".55"/><circle cx="6.5" cy="4" r=".55"/><circle cx="9.5" cy="4" r=".55"/><circle cx="2" cy="6" r=".55"/><circle cx="5" cy="6" r=".55"/><circle cx="8" cy="6" r=".55"/><circle cx="11" cy="6" r=".55"/><circle cx="3.5" cy="8" r=".55"/><circle cx="6.5" cy="8" r=".55"/><circle cx="9.5" cy="8" r=".55"/></g></svg>`;
}
function renderLanguageTools() {
  return `<div class="lang-switch"><button class="flag-btn ${state.language === 'vi' ? 'active' : ''}" data-action="change-language" data-lang="vi" title="Tiếng Việt">${flagSvg('vi')}</button><button class="flag-btn ${state.language === 'en' ? 'active' : ''}" data-action="change-language" data-lang="en" title="English">${flagSvg('en')}</button></div>`;
}
function renderTopbar(title, subtitle = '') {
  return `<header class="topbar"><div><h1>${escapeHtml(title)}</h1>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div><div class="topbar-actions">
    ${state.user?.role === 'admin' && state.portal === 'customer' ? `<button class="header-btn" data-action="back-admin">${icon('back')} ${t('Back to Admin')}</button>` : ''}
    ${renderLanguageTools()}<button class="header-btn" data-action="contact">${t('Contact')}</button><div class="account-pill">${escapeHtml(state.user?.name || state.user?.username || '')}</div>
  </div></header>`;
}
function renderCustomerSidebarPower() {
  if (state.portal !== 'customer') return '';
  const device = primaryDevice();
  const isOff = !device || device.desiredPowerState === 'OFF';
  return `<div class="sidebar-power-dock"><button class="sidebar-power-button ${isOff ? 'is-off' : 'is-on'}" data-action="toggle-customer-device-power" data-id="${device?.id || ''}" title="${isOff ? 'Bật HoloBox' : 'Tắt HoloBox'}">${icon('power')}</button></div>`;
}
function renderSidebar(items) {
  return `<aside class="sidebar"><div class="brand brand-logo-only"><img class="tlc-logo-img tlc-sidebar-logo" src="${TLC_LOGO_SRC}" alt="TLC"></div>
    <nav class="nav">${items.map(([view, label, ico]) => `<button class="nav-btn ${state.view === view ? 'active' : ''}" data-action="nav" data-view="${view}">${icon(ico)}<span>${t(label)}</span></button>`).join('')}</nav>
    ${renderCustomerSidebarPower()}<div class="sidebar-spacer"></div><button class="nav-btn logout" data-action="logout">${icon('logout')}<span>${t('Logout')}</span></button></aside>`;
}

function renderLogin() {
  return `<div class="login-shell"><div class="login-tools">${renderLanguageTools()}<button class="header-btn" data-action="contact">${t('Contact')}</button></div>
    <section class="login-hero"><div class="login-brand-card"><img class="tlc-logo-img tlc-login-logo" src="${TLC_LOGO_SRC}" alt="TLC"><h1>TLC HoloBox Manager</h1></div>
      <form class="login-card" data-form="login"><h2>${t('Login')}</h2><p class="subtitle">Đăng nhập bằng tài khoản được tạo trong hệ thống.</p>
      <label>${t('Username')}<input class="input" name="username" autocomplete="username" required></label>
      <label>${t('Password')}<div class="password-field"><input class="input" name="password" type="password" autocomplete="current-password" required data-login-password><button class="password-eye" data-action="toggle-login-password" type="button">${icon('info')}</button></div></label>
      <button class="action-btn primary wide" type="submit">${t('Login')}</button></form></section></div>`;
}
function render() {
  if (!state.ready) return void (appRoot.innerHTML = '<div class="splash"><div class="spinner-glow"></div><h2>HoloBox</h2><p>Loading...</p></div>');
  if (!state.user) return void (appRoot.innerHTML = renderLogin());
  appRoot.innerHTML = state.portal === 'customer' ? renderCustomerShell() : renderAdminShell();
  queueMicrotask(initDynamicUi);
}

function renderAdminShell() {
  const label = adminNav.find(item => item[0] === state.view)?.[1] || 'Dashboard';
  return `<div class="app-shell phase-shell admin-shell">${renderSidebar(adminNav)}<main class="main">${renderTopbar(t(label), 'Quản lý công ty, Holobox, nội dung và trạng thái thiết bị.')}<section class="content">${renderAdminView()}</section></main></div>`;
}
function renderAdminView() {
  if (state.view === 'customers') return renderAdminCustomers();
  if (state.view === 'logs') return renderAdminLogs();
  if (state.view === 'maintenance') return renderAdminMaintenance();
  if (state.view === 'settings') return renderAdminSettings();
  return renderAdminDashboard();
}
function statCard(title, value, caption, ico) { return `<div class="card stat-card"><div class="icon-bubble">${icon(ico)}</div><div><div class="stat-title">${escapeHtml(title)}</div><div class="stat-number">${escapeHtml(value)}</div><div class="stat-caption">${escapeHtml(caption)}</div></div></div>`; }
function renderAdminDashboard() {
  const online = state.data.devices.filter(item => item.status === 'Online').length;
  const support = state.data.devices.filter(item => ['Offline', 'Error'].includes(item.status)).length;
  return `<div class="stats-grid">${statCard('Companies', state.data.customers.length, 'Registered companies', 'users')}${statCard('HoloBox', state.data.devices.length, `${online} online`, 'monitor')}${statCard('Media', state.data.videos.length + state.data.audio.length, 'Ads and assistant audio', 'video')}${statCard('Need support', support, 'Offline or error', 'logs')}</div>
    <div class="two-col equal"><section class="panel"><div class="panel-toolbar"><h2>HoloBox</h2><button class="mini-btn" data-action="refresh">${icon('refresh')} Refresh</button></div>${renderDeviceTable(state.data.devices, true)}</section><section class="panel"><h2>Recent events</h2>${renderLogList(state.data.logs.slice(0, 10))}</section></div>`;
}

function renderAdminCustomers() {
  if (state.selectedCustomerId) return renderAdminCustomerDashboard(state.selectedCustomerId);
  return `<div class="two-col"><form class="card form-card" data-form="admin-create-customer"><h2>${icon('plus')} ${t('Create customer')}</h2>
    <label>Tên công ty<input class="input" name="name" required placeholder="Glidfer"></label><label>Người liên hệ<input class="input" name="contactName"></label><label>Điện thoại<input class="input" name="phone"></label><label>Email<input class="input" name="email" type="email"></label><div class="divider"></div>
    <label>Tên đăng nhập<input class="input" name="username" required></label><label>Mật khẩu tạm<input class="input" name="password" type="text" minlength="8" required></label><button class="btn btn-primary wide" type="submit">${t('Create customer')}</button></form>
    <section class="panel"><div class="panel-toolbar"><h2>${t('Customers')}</h2><button class="mini-btn" data-action="refresh">${icon('refresh')} Refresh</button></div><div class="customer-list">${state.data.customers.map(company => {
      const user = state.data.users.find(item => item.customerId === company.id && item.role === 'customer');
      return `<div class="customer-row"><div><b>${escapeHtml(company.name)}</b><div class="sub">${escapeHtml(company.email || '—')} · ${escapeHtml(company.phone || '—')}</div></div><div class="actions"><button class="btn btn-small btn-primary" data-action="open-customer" data-id="${company.id}">${t('Open')}</button>${user ? `<button class="btn btn-small btn-soft" data-action="customer-login-info" data-id="${company.id}">${t('Info')}</button>` : ''}<button class="btn btn-small btn-soft" data-action="view-as-customer" data-id="${company.id}">${t('View as Customer')}</button><button class="btn btn-small btn-danger" data-action="delete-customer" data-id="${company.id}">${t('Delete')}</button></div></div>`;
    }).join('') || `<div class="empty">${t('No data')}</div>`}</div></section></div>`;
}
function renderAdminCustomerDashboard(customerId) {
  const company = state.data.customers.find(item => item.id === customerId);
  if (!company) { state.selectedCustomerId = ''; return renderAdminCustomers(); }
  const devices = customerDevices(customerId);
  return `<div class="customer-dashboard"><div class="panel-toolbar"><div><button class="btn btn-small" data-action="customer-back-list">${icon('back')} Back</button><h2 style="margin-top:12px">${escapeHtml(company.name)}</h2><p class="subtitle">${escapeHtml(company.email || '—')} · ${escapeHtml(company.phone || '—')}</p></div><div class="actions"><button class="btn" data-action="customer-login-info" data-id="${company.id}">${t('Info')}</button><button class="btn btn-primary" data-action="view-as-customer" data-id="${company.id}">${t('View as Customer')}</button></div></div>
    <div class="stats-grid">${statCard('HoloBox', devices.length, `${devices.filter(item => item.status === 'Online').length} online`, 'monitor')}${statCard('Advertisements', customerVideos(customerId).length, 'Video and images', 'video')}${statCard('Audio', customerAudios(customerId).length, 'Assistant audio', 'audio')}${statCard('Assistant', customerScripts(customerId).length, 'Editable scripts', 'assistant')}</div>
    <div class="two-col"><form class="card form-card" data-form="admin-create-device"><h2>${icon('plus')} Thêm HoloBox</h2><input type="hidden" name="customerId" value="${company.id}"><label>Tên thiết bị<input class="input" name="name" required></label><label>Mã thiết bị<input class="input" name="deviceCode" required placeholder="GLIDFER-HB-001"></label><label>Vị trí<input class="input" name="location"></label><label>Stream URL beta<input class="input" name="streamUrl"></label><button class="btn btn-primary wide" type="submit">${t('Create device')}</button></form><section class="panel"><h2>Device dashboard</h2>${renderDeviceTable(devices, true)}</section></div></div>`;
}
function renderDeviceTable(devices, admin = false) {
  return `<div class="device-card-list">${devices.map(device => `<div class="device-card-item"><div class="device-card-head"><div><b>${escapeHtml(device.name)}</b><div class="sub">${escapeHtml(device.deviceCode)}${admin ? ` · ${escapeHtml(customerName(device.customerId))}` : ''}</div></div><div class="device-card-actions">${admin ? `<button class="btn btn-small btn-soft" data-action="sync-device" data-id="${device.id}">${icon('sync')} Sync</button><button class="btn btn-small btn-soft" data-action="rotate-device-token" data-id="${device.id}">${icon('key')} Token</button><button class="btn btn-small btn-soft" data-action="edit-device" data-id="${device.id}">${t('Edit')}</button><button class="btn btn-small btn-danger" data-action="delete-device" data-id="${device.id}">${t('Delete')}</button>` : ''}</div></div>
    <div class="device-card-meta"><div><span>Status</span>${statusBadge(device.status)}</div><div><span>Power</span><b>${escapeHtml(device.desiredPowerState)}</b></div><div><span>Mode</span><b>${escapeHtml(device.desiredMode)}</b></div><div><span>Last seen</span><b>${lastSeenLabel(device.lastSeenAt)}</b></div><div><span>Model</span><b>${escapeHtml(device.modelStatus || 'UNKNOWN')}</b></div><div><span>Manifest</span><b>v${escapeHtml(device.installedManifestVersion || 0)}</b></div></div>${device.lastError ? `<div class="sub error-text">${escapeHtml(device.lastError)}</div>` : ''}</div>`).join('') || `<div class="empty">${t('No data')}</div>`}</div>`;
}
function renderAdminLogs() { return `<section class="panel"><div class="panel-toolbar"><h2>${t('Logs')}</h2><button class="mini-btn" data-action="refresh">${icon('refresh')} Refresh</button></div>${renderLogList(state.data.logs)}</section>`; }
function renderLogList(logs) { return `<div class="log-list">${(logs || []).map(log => `<div class="log-row"><div><b>${escapeHtml(log.event || 'Event')}</b><div class="sub">${escapeHtml(new Date(log.time).toLocaleString())} · ${escapeHtml(log.device || '')}</div></div>${statusBadge(log.status || 'INFO')}<div class="sub">${escapeHtml(log.detail || '')}</div></div>`).join('') || `<div class="empty">${t('No data')}</div>`}</div>`; }
function renderAdminMaintenance() { return `<div class="panel-toolbar"><div><h2>Thiết bị HoloBox</h2><p class="subtitle">Quản lý trạng thái và đồng bộ thiết bị.</p></div><button class="btn btn-primary" data-action="open-create-device">${icon('plus')} ${t('Create device')}</button></div><div class="grid cards">${state.data.devices.map(device => `<div class="card"><h2>${escapeHtml(device.name)}</h2><div class="sub">${escapeHtml(device.deviceCode)}</div><div class="detail-badges">${statusBadge(device.status)}${statusBadge(device.cameraStatus)}${statusBadge(device.modelStatus)}</div><p>Runtime: ${escapeHtml(device.runtimeState)} · Sync: ${escapeHtml(device.syncStatus)}</p><p>Storage: ${escapeHtml(device.storageFreeMb ?? '—')} MB</p><button class="btn" data-action="sync-device" data-id="${device.id}">Đồng bộ ngay</button></div>`).join('') || `<div class="empty">${t('No data')}</div>`}</div>`; }
function renderAdminSettings() {
  const settings = state.data.settings;
  return `<form class="panel form-grid" data-form="admin-settings"><h2>${t('Settings')}</h2><label>Maintenance phone<input class="input" name="maintenancePhone" value="${escapeHtml(settings.maintenancePhone || '')}"></label><label>Maintenance email<input class="input" name="maintenanceEmail" value="${escapeHtml(settings.maintenanceEmail || '')}"></label><label>Default language<select name="defaultLanguage"><option value="vi" ${settings.defaultLanguage === 'vi' ? 'selected' : ''}>Tiếng Việt</option><option value="en" ${settings.defaultLanguage === 'en' ? 'selected' : ''}>English</option></select></label><label>Warning after seconds<input class="input" type="number" name="offlineWarning" value="${escapeHtml(settings.offlineWarning || '45')}"></label><label>Offline after seconds<input class="input" type="number" name="offlineTimeout" value="${escapeHtml(settings.offlineTimeout || '90')}"></label><button class="action-btn primary" type="submit">${t('Save')}</button></form>`;
}

function renderCustomerShell() {
  const device = primaryDevice();
  return `<div class="app-shell phase-shell customer-shell">${renderSidebar(customerNav)}<main class="main">${renderTopbar(device?.name || customerName(), `${device?.companyStatus || 'Cần hỗ trợ'} · ${device?.desiredMode === 'ADS_ONLY' ? t('Just Ads Mode') : t('Assistant Mode')}`)}<section class="content">${renderCustomerView()}</section></main></div>`;
}
function renderCustomerView() {
  if (state.view === 'customerVideo') return renderCustomerVideo();
  if (state.view === 'customerAudio') return renderCustomerAudio();
  if (state.view === 'customerAssistant') return renderAssistantManager(false);
  return renderCustomerHome();
}
function renderCustomerHome() {
  const device = primaryDevice();
  return `<div class="customer-home-grid"><section class="holobox-screen-panel">${renderHoloboxScreenPreview(device)}</section><aside class="customer-list-panel"><div class="mini-list-block"><div class="panel-toolbar"><h2>${t('Video list')}</h2><button class="mini-btn" data-action="nav" data-view="customerVideo">${t('Video')}</button></div>${renderMiniMediaList(playlistMedia(), 'video')}</div><div class="mini-list-block"><div class="panel-toolbar"><h2>${t('Receptionist audio')}</h2><button class="mini-btn" data-action="nav" data-view="customerAudio">${t('Audio')}</button></div>${renderMiniMediaList(customerAudios(), 'audio')}</div></aside></div>`;
}
function renderHoloboxScreenPreview(device) {
  const isOff = !device || device.desiredPowerState === 'OFF';
  const isAds = device?.desiredMode === 'ADS_ONLY';
  return `<div class="holobox-preview-card ${isAds && !isOff ? 'ads-output-card' : ''}"><div class="screen-output-area"><div class="preview-screen ${isOff ? 'off-mode' : isAds ? 'ads-mode' : 'assistant-mode'}">${isOff ? '<div class="preview-main turned-off-text">HoloBox turned off</div>' : isAds ? renderAdsPreview() : renderAssistantPreview(device)}</div></div><div class="screen-control-area"><div class="preview-meta compact-meta"><div>${t('Status')}: ${statusBadge(device?.companyStatus || 'Cần hỗ trợ')}</div><div>${t('Mode')}: ${escapeHtml(isAds ? t('Just Ads Mode') : t('Assistant Mode'))}</div><div>${t('Last seen')}: ${lastSeenLabel(device?.lastSeenAt)}</div></div><div class="mode-toggle-panel"><h3>Chuyển chế độ HoloBox</h3>${renderCustomerDeviceModeControls(device)}</div></div></div>`;
}
function renderAssistantPreview(device) {
  if (device?.streamUrl) return `<div class="stream-output-wrap"><img class="holobox-stream-output" src="${escapeHtml(device.streamUrl)}" alt="HoloBox output"></div>`;
  return `<div class="preview-main assistant-output"><img class="preview-device-logo" src="assets/holobox-device.png" alt="HoloBox"><b>Assistant Mode</b><span>${escapeHtml(device?.runtimeState || 'Ready for avatar runtime')}</span></div>`;
}
function renderAdsPreview() {
  const item = playlistMedia()[0];
  if (!item) return `<div class="ads-empty">${t('No data')}</div>`;
  const url = `/api/media/file/video/${encodeURIComponent(item.id)}`;
  return item.kind === 'advertisement_image' || String(item.mimeType || '').startsWith('image/')
    ? `<img class="holobox-ads-player" src="${url}" alt="${escapeHtml(item.name)}">`
    : `<video class="holobox-ads-player" src="${url}" autoplay muted loop playsinline></video>`;
}
function renderCustomerDeviceModeControls(activeDevice) {
  const devices = customerDevices();
  return `<div class="device-mode-list">${devices.map(device => {
    const ads = device.desiredMode === 'ADS_ONLY';
    return `<div class="device-mode-row ${activeDevice?.id === device.id ? 'active' : ''}"><div><b>${escapeHtml(device.name)}</b><div class="sub">${escapeHtml(device.deviceCode)} · ${ads ? t('Just Ads Mode') : t('Assistant Mode')}</div></div><button class="btn ${ads ? '' : 'btn-primary'}" data-action="toggle-customer-device-mode" data-id="${device.id}">${ads ? 'Chuyển sang Assistant Mode' : 'Chuyển sang Just Ads Mode'}</button></div>`;
  }).join('') || '<div class="empty">Chưa có HoloBox.</div>'}</div>`;
}
function renderMiniMediaList(list, kind) { return `<div class="mini-media-list">${list.slice(0, 8).map(item => `<div class="mini-media-row"><div><b>${escapeHtml(item.name)}</b><div class="sub">${escapeHtml(item.duration || '00:00')} · ${escapeHtml(kind === 'audio' ? item.role || 'audio' : item.type || 'Media')}</div></div>${icon(kind)}</div>`).join('') || `<div class="empty">${t('No data')}</div>`}</div>`; }

function renderCustomerVideo() {
  const videos = customerVideos();
  const ordered = playlistMedia();
  return `<div class="customer-two-col"><section class="card upload-card v3-upload"><h2>${icon('upload')} Thêm quảng cáo</h2><p class="subtitle">Video hoặc hình ảnh mới được tự động thêm vào cuối playlist.</p><label class="drop-zone v3-drop"><input class="hidden-file" type="file" accept="video/mp4,video/webm,video/quicktime,image/jpeg,image/png,image/webp" data-upload-kind="video" multiple><div class="drop-icon">${icon('upload')}</div><strong>Chọn hoặc kéo file vào đây</strong><span>MP4, WebM, MOV, JPG, PNG, WebP</span><span class="btn btn-primary">Chọn file</span></label></section><section class="panel"><div class="panel-toolbar"><div><h2>Playlist quảng cáo</h2><p class="subtitle">Kéo thả để đổi thứ tự. Playlist phát lặp vô hạn.</p></div><span class="sub">${ordered.length} files</span></div>${renderPlaylistEditor(ordered)}<div class="divider"></div><div class="media-grid">${videos.map(item => renderMediaCard(item, 'video')).join('') || `<div class="empty">${t('No data')}</div>`}</div></section></div>`;
}
function renderPlaylistEditor(items) {
  return `<div class="playlist-sort-list" data-playlist-sort>${items.map((item, index) => `<div class="playlist-sort-row" draggable="true" data-media-id="${item.id}"><span class="drag-handle">${icon('drag')}</span><span class="playlist-index">${index + 1}</span><div><b>${escapeHtml(item.name)}</b><div class="sub">${escapeHtml(item.type)} · ${escapeHtml(item.duration || '00:00')}</div></div></div>`).join('') || `<div class="empty">Playlist rỗng — màn hình quảng cáo sẽ không hiện nội dung.</div>`}</div>`;
}
function renderCustomerAudio() {
  const audios = customerAudios();
  return `<div class="customer-two-col"><section class="card upload-card v3-upload"><h2>${icon('upload')} ${t('Audio')}</h2><label>Vai trò audio<select data-audio-role><option value="greeting">Chào khách</option><option value="request_qr">Yêu cầu QR</option><option value="confirmation">Xác nhận thông tin</option><option value="fallback">Không hiểu</option><option value="goodbye">Tạm biệt</option></select></label><label class="drop-zone v3-drop"><input class="hidden-file" type="file" accept="audio/*" data-upload-kind="audio" multiple><div class="drop-icon">${icon('audio')}</div><strong>Chọn hoặc kéo audio vào đây</strong><span>MP3, WAV, OGG</span><span class="btn btn-primary">Chọn audio</span></label></section><section class="panel"><div class="panel-toolbar"><h2>${t('Receptionist audio')}</h2><span class="sub">${audios.length} files</span></div><div class="media-grid">${audios.map(item => renderMediaCard(item, 'audio')).join('') || `<div class="empty">${t('No data')}</div>`}</div></section></div>`;
}
function renderMediaCard(item, kind) {
  return `<div class="media-card"><div class="media-thumb">${icon(kind)}</div><div class="media-info"><b>${escapeHtml(item.name)}</b><div class="sub">${escapeHtml(item.duration || '00:00')} · ${escapeHtml(item.size || '')}</div>${kind === 'audio' ? `<div class="sub">Role: ${escapeHtml(item.role || 'audio')}</div>` : `<div class="sub">${escapeHtml(item.type || 'Media')}</div>`}</div><div class="actions"><button class="mini-btn" data-action="preview-media" data-kind="${kind}" data-id="${item.id}">${t('Preview')}</button><button class="mini-btn danger" data-action="delete-media" data-kind="${kind}" data-id="${item.id}">${t('Delete')}</button></div></div>`;
}

function renderAssistantManager(admin) {
  const companyId = admin ? (state.selectedCustomerId || state.data.customers[0]?.id || '') : currentCustomerId();
  const scripts = admin ? state.data.assistantScripts : customerScripts();
  const audios = admin ? state.data.audio : customerAudios();
  return `<div class="two-col"><form class="card form-card" data-form="assistant-script"><h2>${icon('plus')} Thêm câu thoại</h2>${admin ? `<label>Công ty<select name="customerId" required>${state.data.customers.map(company => `<option value="${company.id}" ${company.id === companyId ? 'selected' : ''}>${escapeHtml(company.name)}</option>`).join('')}</select></label>` : `<input type="hidden" name="customerId" value="${companyId}">`}<label>Tiêu đề<input class="input" name="title" required placeholder="Chào khách"></label><label>Nhóm câu thoại<select name="intent"><option value="greeting">Chào khách</option><option value="request_qr">Yêu cầu quét QR</option><option value="confirmation">Xác nhận thông tin</option><option value="fallback">Ngoài phạm vi</option><option value="goodbye">Tạm biệt</option></select></label><label>Nội dung<textarea name="text" rows="6" required></textarea></label><label>Audio<select name="audioId"><option value="">Chưa gắn audio</option>${audios.map(audio => `<option value="${audio.id}">${escapeHtml(audio.name)}</option>`).join('')}</select></label><button class="btn btn-primary wide" type="submit">${t('Save')}</button><p class="subtitle">Công ty chỉ sửa nội dung và audio; logic check-in không nằm ở đây.</p></form><section class="panel"><div class="panel-toolbar"><h2>${t('Assistant')}</h2><span class="sub">${scripts.length} scripts</span></div><div class="intent-grid">${scripts.map(script => `<div class="card intent-card"><div class="intent-title">${escapeHtml(script.title)}</div><p>${escapeHtml(script.text)}</p><div class="sub">${escapeHtml(script.intent)} · Audio: ${escapeHtml(mediaName(script.audioId) || '—')}</div><div class="actions"><button class="btn btn-small btn-soft" data-action="edit-assistant-template" data-id="${script.id}">${t('Edit')}</button><button class="btn btn-small btn-danger" data-action="delete-assistant-template" data-id="${script.id}">${t('Delete')}</button></div></div>`).join('') || `<div class="empty">${t('No data')}</div>`}</div></section></div>`;
}

async function measureDuration(file) {
  if (file.type.startsWith('image/')) return { durationSeconds: 10, duration: '00:10' };
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const element = document.createElement(file.type.startsWith('audio/') ? 'audio' : 'video');
    element.preload = 'metadata';
    element.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve({ durationSeconds: Number(element.duration || 0), duration: formatTime(element.duration || 0) }); };
    element.onerror = () => { URL.revokeObjectURL(url); resolve({ durationSeconds: 0, duration: '00:00' }); };
    element.src = url;
  });
}
async function uploadFile(file, kind) {
  const meta = await measureDuration(file);
  const params = new URLSearchParams({
    kind, name: file.name, mime: file.type || 'application/octet-stream', size: String(file.size || 0),
    durationSeconds: String(Math.round(meta.durationSeconds || 0)), customerId: currentCustomerId(),
  });
  if (kind === 'audio') params.set('role', document.querySelector('[data-audio-role]')?.value || 'greeting');
  const response = await fetch(`/api/media/upload?${params}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || 'Upload failed');
  state.data = mergeData(payload.data);
}
async function uploadFiles(files, kind) {
  if (!files.length) return;
  showLoading('Uploading media...', `${files.length} file(s)`);
  try {
    for (const file of files) await uploadFile(file, kind);
    toast('success', 'Upload complete');
    render();
  } catch (error) { toast('error', 'Upload failed', error.message); }
  finally { hideLoading(); }
}
async function savePlaylistOrder(mediaIds) {
  const payload = await apiJson('/api/playlists/active/items', { method: 'PUT', body: JSON.stringify({ customerId: currentCustomerId(), mediaIds }) });
  state.data = mergeData(payload.data);
  toast('success', 'Đã lưu thứ tự playlist');
  render();
}

const actionHandlers = {
  nav: async target => { state.view = target.dataset.view || (state.portal === 'admin' ? 'dashboard' : 'customerHome'); render(); },
  'change-language': async target => { state.language = target.dataset.lang || 'vi'; localStorage.setItem('holobox_lang', state.language); render(); },
  contact: async () => { const settings = state.data.settings; modal('Maintenance Contact', `<div class="contact-card"><div class="contact-row">${icon('phone')} <b>Phone:</b> ${escapeHtml(settings.maintenancePhone)}</div><div class="contact-row">${icon('mail')} <b>Email:</b> ${escapeHtml(settings.maintenanceEmail)}</div><div class="contact-row">${icon('monitor')} <b>Device:</b> ${escapeHtml(primaryDevice()?.deviceCode || '—')}</div></div>`, `<button class="action-btn primary" data-action="close-modal">${t('Close')}</button>`); },
  'close-modal': async () => closeModal(),
  'toggle-login-password': async target => { const input = target.closest('.password-field')?.querySelector('input'); if (input) input.type = input.type === 'password' ? 'text' : 'password'; },
  logout: async () => { await apiJson('/api/auth/logout', { method: 'POST', body: '{}' }); state.user = null; state.portal = 'login'; state.view = 'login'; render(); },
  'back-admin': async () => { state.portal = 'admin'; state.viewingCustomerId = ''; state.view = 'dashboard'; await refreshData(); },
  refresh: async () => { showLoading('Refreshing...', 'Loading latest data'); try { await refreshData(); toast('success', 'Refreshed'); } finally { hideLoading(); } },
  'open-customer': async target => { state.selectedCustomerId = target.dataset.id; render(); },
  'customer-back-list': async () => { state.selectedCustomerId = ''; render(); },
  'view-as-customer': async target => { state.viewingCustomerId = target.dataset.id; state.portal = 'customer'; state.view = 'customerHome'; render(); },
  'customer-login-info': async target => {
    const user = state.data.users.find(item => item.customerId === target.dataset.id && item.role === 'customer');
    modal('Company login', `<div class="contact-card"><label>Username<input class="input" value="${escapeHtml(user?.username || '—')}" disabled></label><label>Password<input class="input" value="••••••••" disabled></label></div>`, `<button class="btn" data-action="customer-login-edit" data-id="${target.dataset.id}">${t('Edit')}</button><button class="btn btn-primary" data-action="close-modal">${t('Close')}</button>`);
  },
  'customer-login-edit': async target => {
    const user = state.data.users.find(item => item.customerId === target.dataset.id && item.role === 'customer');
    modal('Edit company login', `<form class="form-card modal-form" data-form="admin-edit-customer-login"><input type="hidden" name="customerId" value="${target.dataset.id}"><label>Username<input class="input" name="username" value="${escapeHtml(user?.username || '')}" required></label><label>Mật khẩu mới<input class="input" name="password" type="text" minlength="8" placeholder="Để trống nếu không đổi"></label><button class="btn btn-primary wide" type="submit">${t('Save')}</button></form>`);
  },
  'delete-customer': async target => { if (!(await confirmModal('Archive company', 'Công ty, tài khoản và thiết bị sẽ được lưu trữ thay vì xóa vĩnh viễn.'))) return; const payload = await apiJson(`/api/admin/customers/${target.dataset.id}`, { method: 'DELETE' }); state.data = mergeData(payload.data); state.selectedCustomerId = ''; render(); },
  'toggle-customer-device-power': async target => { const device = state.data.devices.find(item => item.id === target.dataset.id) || primaryDevice(); if (!device) return toast('error', 'No HoloBox'); const payload = await apiJson(`/api/devices/${device.id}/control`, { method: 'PATCH', body: JSON.stringify({ powerState: device.desiredPowerState === 'ON' ? 'OFF' : 'ON' }) }); state.data = mergeData(payload.data); render(); },
  'toggle-customer-device-mode': async target => { const device = state.data.devices.find(item => item.id === target.dataset.id); if (!device) return; const payload = await apiJson(`/api/devices/${device.id}/control`, { method: 'PATCH', body: JSON.stringify({ powerState: 'ON', mode: device.desiredMode === 'ADS_ONLY' ? 'ASSISTANT' : 'ADS_ONLY' }) }); state.data = mergeData(payload.data); render(); },
  'preview-media': async target => { const list = target.dataset.kind === 'audio' ? state.data.audio : state.data.videos; const item = list.find(media => media.id === target.dataset.id); if (!item) return; const url = `/api/media/file/${target.dataset.kind}/${item.id}`; const preview = target.dataset.kind === 'audio' ? `<audio controls src="${url}" style="width:100%"></audio>` : item.kind === 'advertisement_image' ? `<img src="${url}" style="width:100%;border-radius:18px">` : `<video controls src="${url}" style="width:100%;border-radius:18px;max-height:60vh"></video>`; modal(item.name, preview, `<button class="btn" data-action="close-modal">${t('Close')}</button>`); },
  'delete-media': async target => { if (!(await confirmModal('Delete media', 'File sẽ bị loại khỏi playlist và bộ nhớ cloud.'))) return; const payload = await apiJson(`/api/media/${target.dataset.kind}/${target.dataset.id}`, { method: 'DELETE' }); state.data = mergeData(payload.data); render(); },
  'delete-assistant-template': async target => { if (!(await confirmModal('Delete assistant script', 'Xóa câu thoại này?'))) return; const payload = await apiJson(`/api/assistant/scripts/${target.dataset.id}`, { method: 'DELETE' }); state.data = mergeData(payload.data); render(); },
  'edit-assistant-template': async target => {
    const script = state.data.assistantScripts.find(item => item.id === target.dataset.id); if (!script) return;
    const audios = customerAudios(script.customerId);
    modal('Edit assistant script', `<form class="form-card modal-form" data-form="assistant-script-edit"><input type="hidden" name="id" value="${script.id}"><label>Title<input class="input" name="title" value="${escapeHtml(script.title)}" required></label><label>Intent<input class="input" name="intent" value="${escapeHtml(script.intent)}" required></label><label>Content<textarea name="text" rows="6" required>${escapeHtml(script.text)}</textarea></label><label>Audio<select name="audioId"><option value="">No audio</option>${audios.map(audio => `<option value="${audio.id}" ${audio.id === script.audioId ? 'selected' : ''}>${escapeHtml(audio.name)}</option>`).join('')}</select></label><button class="btn btn-primary wide" type="submit">${t('Save')}</button></form>`);
  },
  'open-create-device': async () => {
    if (!state.data.customers.length) {
      toast('error', 'Chưa có công ty', 'Hãy tạo công ty trước khi thêm HoloBox.');
      state.view = 'customers';
      render();
      return;
    }
    modal('Thêm HoloBox', `<form class="form-card modal-form" data-form="admin-create-device"><label>Công ty<select name="customerId" required>${state.data.customers.map(company => `<option value="${company.id}">${escapeHtml(company.name)}</option>`).join('')}</select></label><label>Tên thiết bị<input class="input" name="name" required placeholder="Glidfer HoloBox"></label><label>Mã thiết bị<input class="input" name="deviceCode" required placeholder="GLIDFER-HB-001"></label><label>Vị trí<input class="input" name="location" placeholder="Cổng check-in"></label><label>Stream URL beta<input class="input" name="streamUrl" placeholder="http://..."></label><button class="btn btn-primary wide" type="submit">${t('Create device')}</button></form>`);
  },
  'sync-device': async target => { const payload = await apiJson(`/api/admin/devices/${target.dataset.id}/sync-now`, { method: 'POST', body: '{}' }); state.data = mergeData(payload.data); toast('success', 'Sync requested', `Manifest v${payload.manifestVersion}`); render(); },
  'rotate-device-token': async target => { if (!(await confirmModal('Rotate device token', 'Token cũ sẽ ngừng hoạt động ngay.'))) return; const payload = await apiJson(`/api/admin/devices/${target.dataset.id}/credentials/rotate`, { method: 'POST', body: '{}' }); modal('New device token', `<p>Chỉ hiển thị một lần. Sao chép vào file .env của mini PC.</p><textarea class="input" rows="4" readonly>${escapeHtml(payload.deviceToken)}</textarea>`, `<button class="btn" data-copy-token="${escapeHtml(payload.deviceToken)}">Copy</button><button class="btn btn-primary" data-action="close-modal">Close</button>`); },
  'edit-device': async target => { const device = state.data.devices.find(item => item.id === target.dataset.id); if (!device) return; modal('Edit HoloBox', `<form class="form-card modal-form" data-form="admin-edit-device"><input type="hidden" name="id" value="${device.id}"><label>Name<input class="input" name="name" value="${escapeHtml(device.name)}" required></label><label>Device code<input class="input" name="deviceCode" value="${escapeHtml(device.deviceCode)}" required></label><label>Company<select name="customerId">${state.data.customers.map(company => `<option value="${company.id}" ${company.id === device.customerId ? 'selected' : ''}>${escapeHtml(company.name)}</option>`).join('')}</select></label><label>Location<input class="input" name="location" value="${escapeHtml(device.location || '')}"></label><label>Stream URL<input class="input" name="streamUrl" value="${escapeHtml(device.streamUrl || '')}"></label><label>Mode<select name="runtimeMode"><option value="ASSISTANT" ${device.desiredMode === 'ASSISTANT' ? 'selected' : ''}>Assistant</option><option value="JUST_ADS" ${device.desiredMode === 'ADS_ONLY' ? 'selected' : ''}>Ads only</option></select></label><button class="btn btn-primary wide" type="submit">${t('Save')}</button></form>`); },
  'delete-device': async target => { if (!(await confirmModal('Archive HoloBox', 'Thiết bị sẽ bị archive và token bị thu hồi.'))) return; const payload = await apiJson(`/api/admin/devices/${target.dataset.id}`, { method: 'DELETE' }); state.data = mergeData(payload.data); render(); },
};

async function handleAction(action, target) {
  try { if (actionHandlers[action]) await actionHandlers[action](target); }
  catch (error) { toast('error', 'Action failed', error.message); }
}

document.addEventListener('click', event => {
  if (event.target?.dataset?.backdropClose === 'true') { closeModal(); return; }
  const copy = event.target.closest('[data-copy-token]');
  if (copy) { navigator.clipboard?.writeText(copy.dataset.copyToken); toast('success', 'Copied'); return; }
  const target = event.target.closest('[data-action]');
  if (!target) return;
  event.preventDefault();
  handleAction(target.dataset.action, target);
});
document.addEventListener('change', event => { const input = event.target.closest('[data-upload-kind]'); if (input) uploadFiles(Array.from(input.files || []), input.dataset.uploadKind); });

document.addEventListener('submit', async event => {
  const form = event.target.closest('[data-form]');
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  showLoading('Saving...', 'Please wait');
  try {
    let payload;
    switch (form.dataset.form) {
      case 'login':
        payload = await apiJson('/api/auth/login', { method: 'POST', body: JSON.stringify(data) });
        state.user = payload.user; state.portal = state.user.role === 'admin' ? 'admin' : 'customer'; state.view = state.user.role === 'admin' ? 'dashboard' : 'customerHome'; await loadData(); break;
      case 'admin-create-customer':
        payload = await apiJson('/api/admin/customers', { method: 'POST', body: JSON.stringify(data) }); state.data = mergeData(payload.data); modal('Company created', `<p>Username: <b>${escapeHtml(data.username)}</b></p><p>Password: <b>${escapeHtml(data.password)}</b></p><p class="subtitle">Gửi thông tin này cho công ty và yêu cầu đổi mật khẩu.</p>`, `<button class="btn btn-primary" data-action="close-modal">Close</button>`); break;
      case 'admin-edit-customer-login':
        payload = await apiJson(`/api/admin/customers/${data.customerId}/login`, { method: 'PUT', body: JSON.stringify(data) }); state.data = mergeData(payload.data); closeModal(); break;
      case 'admin-create-device':
        payload = await apiJson('/api/admin/devices', { method: 'POST', body: JSON.stringify(data) }); state.data = mergeData(payload.data); modal('HoloBox created', `<p>Device token chỉ hiển thị một lần:</p><textarea class="input" rows="4" readonly>${escapeHtml(payload.deviceToken)}</textarea><p class="subtitle">Đặt token này vào DEVICE_TOKEN trong file .env của runtime.</p>`, `<button class="btn" data-copy-token="${escapeHtml(payload.deviceToken)}">Copy</button><button class="btn btn-primary" data-action="close-modal">Close</button>`); break;
      case 'admin-edit-device':
        payload = await apiJson(`/api/admin/devices/${data.id}`, { method: 'PUT', body: JSON.stringify(data) }); state.data = mergeData(payload.data); closeModal(); break;
      case 'assistant-script':
        payload = await apiJson('/api/assistant/scripts', { method: 'POST', body: JSON.stringify({ ...data, language: state.language }) }); state.data = mergeData(payload.data); form.reset(); break;
      case 'assistant-script-edit':
        payload = await apiJson(`/api/assistant/scripts/${data.id}`, { method: 'PUT', body: JSON.stringify({ ...data, language: state.language }) }); state.data = mergeData(payload.data); closeModal(); break;
      case 'admin-settings':
        payload = await apiJson('/api/admin/settings', { method: 'PUT', body: JSON.stringify(data) }); state.data = mergeData(payload.data); break;
      default: return;
    }
    toast('success', 'Saved'); render();
  } catch (error) { toast('error', 'Submit failed', error.message); }
  finally { hideLoading(); }
});

function initDynamicUi() {
  const list = document.querySelector('[data-playlist-sort]');
  if (!list || list.dataset.ready) return;
  list.dataset.ready = 'true';
  let dragged = null;
  list.addEventListener('dragstart', event => { dragged = event.target.closest('[data-media-id]'); dragged?.classList.add('dragging'); });
  list.addEventListener('dragend', async () => { dragged?.classList.remove('dragging'); dragged = null; const ids = Array.from(list.querySelectorAll('[data-media-id]')).map(item => item.dataset.mediaId); try { await savePlaylistOrder(ids); } catch (error) { toast('error', 'Could not save playlist', error.message); await refreshData(); } });
  list.addEventListener('dragover', event => {
    event.preventDefault();
    if (!dragged) return;
    const after = Array.from(list.querySelectorAll('[data-media-id]:not(.dragging)')).find(item => event.clientY <= item.getBoundingClientRect().top + item.offsetHeight / 2);
    if (after) list.insertBefore(dragged, after); else list.appendChild(dragged);
  });
}

async function initApp() {
  console.info('HoloBox Manager', APP_VERSION);
  try {
    const me = await apiJson('/api/auth/me');
    state.user = me.user;
    if (state.user) {
      state.portal = state.user.role === 'admin' ? 'admin' : 'customer';
      state.view = state.user.role === 'admin' ? 'dashboard' : 'customerHome';
      state.language = state.user.language || state.language;
      await loadData();
    } else {
      const publicConfig = await apiJson('/api/public/config').catch(() => null);
      if (publicConfig?.settings) state.data.settings = { ...state.data.settings, ...publicConfig.settings };
    }
  } catch (error) {
    console.error(error);
    try { state.data = mergeData(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')); } catch {}
  } finally { state.ready = true; render(); }
}

initApp();
