export const UI_SETTINGS_KEY = 'voltix.ui.settings';
export const MIN_UNIX_MS = 946684800000;

export function showToast(message, timeout = 3000){
  const el = document.getElementById('toast');
  if(!el) return;
  el.textContent = message;
  el.style.display = 'block';
  window.clearTimeout(el.dataset.timeoutId);
  const timeoutId = window.setTimeout(()=>{ el.style.display = 'none'; }, timeout);
  el.dataset.timeoutId = String(timeoutId);
}

export function qs(id){
  return document.getElementById(id);
}

export function loadUiSettings(){
  try{
    return {
      theme: 'electric',
      language: 'en',
      currency: 'IDR',
      notifications: {
        stale: true,
        overload: true,
        commandAck: true
      },
      ...(JSON.parse(localStorage.getItem(UI_SETTINGS_KEY) || '{}'))
    };
  }catch(error){
    console.warn('[ui] failed to parse local settings', error);
    return { theme: 'electric', language: 'en', currency: 'IDR', notifications: {} };
  }
}

export function saveUiSettings(settings){
  localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(settings));
  applyTheme(settings.theme);
}

export function applyTheme(theme = loadUiSettings().theme){
  const normalized = ['electric', 'dark', 'light'].includes(theme) ? theme : 'electric';
  document.documentElement.dataset.theme = normalized;
}

export function renderShell(activePage, pageTitle, { user = null, onLogout = null } = {}){
  applyTheme();

  const sidebar = qs('sidebar');
  const topbar = qs('topbar');
  const mainContent = qs('main-content');
  if(!sidebar || !topbar || !mainContent){
    console.warn('[shell] missing sidebar/topbar container');
    return;
  }

  sidebar.innerHTML = `
    <div class="brand-block sidebar-logo">
      <div class="brand-mark sidebar-logo-icon">V</div>
      <div>
        <h1 class="brand-title sidebar-logo-text">Voltix</h1>
        <div class="brand-subtitle sidebar-logo-sub">Electric energy monitor</div>
      </div>
    </div>
    <nav class="sidebar-nav" aria-label="Main navigation">
      ${navLink('dashboard', 'Dashboard', 'dashboard.html', activePage)}
      ${navLink('history', 'History', 'history.html', activePage)}
      ${navLink('advanced', 'Advanced', 'advanced.html', activePage)}
      ${navLink('settings', 'Settings', 'settings.html', activePage)}
    </nav>
    <div class="sidebar-footer sidebar-bottom">
      <div class="sidebar-user">
        <div class="sidebar-user-avatar">${safeText(user?.email ?? user?.uid, 'V').slice(0, 1).toUpperCase()}</div>
        <div class="sidebar-user-info">
          <div class="sidebar-user-name">Signed in</div>
          <div id="userEmail" class="user-email sidebar-user-email">${safeText(user?.email ?? user?.uid, 'Voltix user')}</div>
        </div>
      </div>
      <button id="logoutBtn" class="button-secondary sidebar-logout" type="button">Sign Out</button>
    </div>
  `;

  topbar.innerHTML = `
    <button id="menu-btn" class="topbar-menu-btn" type="button" aria-label="Toggle sidebar" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
    <div class="topbar-title-block">
      <h2 class="page-title topbar-title">${safeText(pageTitle, 'Voltix')}</h2>
      ${topbarSubtitle(activePage)}
    </div>
    <div class="topbar-actions">
      ${topbarActions(activePage)}
    </div>
  `;

  const backdrop = ensureSidebarBackdrop();
  const menuBtn = qs('menu-btn');
  const logoutBtn = qs('logoutBtn');

  if(logoutBtn && onLogout){
    logoutBtn.addEventListener('click', onLogout);
  }

  menuBtn?.addEventListener('click', ()=>{
    if(isMobileSidebar()){
      const isOpen = sidebar.classList.toggle('open');
      backdrop.classList.toggle('show', isOpen);
      menuBtn.setAttribute('aria-expanded', String(isOpen));
      return;
    }

    const isCollapsed = sidebar.classList.toggle('collapsed');
    mainContent.classList.toggle('sidebar-collapsed', isCollapsed);
    menuBtn.setAttribute('aria-expanded', String(!isCollapsed));
  });

  backdrop.addEventListener('click', ()=>{
    sidebar.classList.remove('open');
    backdrop.classList.remove('show');
    menuBtn?.setAttribute('aria-expanded', 'false');
  });

  window.addEventListener('resize', ()=>{
    if(isMobileSidebar()){
      mainContent.classList.remove('sidebar-collapsed');
      sidebar.classList.remove('collapsed');
      return;
    }
    sidebar.classList.remove('open');
    backdrop.classList.remove('show');
    menuBtn?.setAttribute('aria-expanded', String(!sidebar.classList.contains('collapsed')));
  });

  console.log('[shell] rendered', activePage);
}

export function initShell(options = {}){
  renderShell(options.active, pageTitleFor(options.active), options);
}

function navLink(page, label, href, activePage){
  const active = page === activePage ? ' active' : '';
  return `<a class="${active.trim() ? `active` : ''}" data-nav="${page}" href="${href}">${label}</a>`;
}

function pageTitleFor(activePage){
  const titles = {
    dashboard: 'Dashboard',
    history: 'History',
    advanced: 'Advanced',
    settings: 'Settings'
  };
  return titles[activePage] ?? 'Voltix';
}

function topbarSubtitle(activePage){
  if(activePage === 'dashboard'){
    return '<p class="page-kicker">Real-time load monitoring for device <span id="deviceId">esp32-voltix-001</span></p>';
  }
  if(activePage === 'history'){
    return '<p class="page-kicker">Completed sessions copied from the device queue into your account.</p>';
  }
  if(activePage === 'settings'){
    return '<p class="page-kicker">Device configuration and personal dashboard preferences.</p>';
  }
  if(activePage === 'advanced'){
    return '<p class="page-kicker">How Voltix measures, protects, and syncs sessions.</p>';
  }
  return '';
}

function topbarActions(activePage){
  if(activePage === 'dashboard'){
    return '<span id="connectionStatus" class="status-pill">Connecting...</span><a class="button-link button-secondary" href="history.html">History</a>';
  }
  if(activePage === 'history'){
    return '<button id="refreshBtn" type="button">Refresh</button>';
  }
  if(activePage === 'settings'){
    return '<span id="settingsStatus" class="status-pill">Loading...</span>';
  }
  return '<span class="status-pill">Voltix</span>';
}

function ensureSidebarBackdrop(){
  let backdrop = qs('sidebar-backdrop');
  if(!backdrop){
    backdrop = document.createElement('div');
    backdrop.id = 'sidebar-backdrop';
    backdrop.className = 'sidebar-backdrop';
    document.body.appendChild(backdrop);
  }
  return backdrop;
}

function isMobileSidebar(){
  return window.matchMedia('(max-width: 768px)').matches;
}

export function safeText(value, empty = '-'){
  if(value === null || value === undefined || value === '') return empty;
  return String(value);
}

export function numberValue(value){
  if(value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isNaN(number) ? null : number;
}

export function numberOrZero(value){
  const number = numberValue(value);
  return number === null ? 0 : number;
}

export function formatNumber(value, decimals = 2, empty = '-'){
  const number = numberValue(value);
  if(number === null) return empty;
  return number.toFixed(decimals);
}

export function formatUnit(value, decimals, unit, empty = '-'){
  const formatted = formatNumber(value, decimals, empty);
  return formatted === empty ? empty : `${formatted} ${unit}`;
}

export function formatPower(value){
  return formatUnit(value, 1, 'W');
}

export function formatVoltage(value){
  return formatUnit(value, 1, 'V');
}

export function formatCurrent(value){
  return formatUnit(value, 3, 'A');
}

export function formatFrequency(value){
  return formatUnit(value, 1, 'Hz');
}

export function formatEnergyKwh(value, decimals = 6){
  return formatUnit(value, decimals, 'kWh');
}

export function formatEnergyWh(value, decimals = 3){
  return formatUnit(value, decimals, 'Wh');
}

export function formatCost(value, currency = 'IDR', costText = null, emptyText = '-'){
  const number = numberValue(value);
  const code = String(currency || 'IDR').toUpperCase();

  if(number !== null && code === 'IDR'){
    if(number > 0 && number < 1) return '< Rp 1';
    return `Rp ${Math.round(number).toLocaleString('id-ID')}`;
  }

  if(number !== null && code === 'USD'){
    return `$${number.toFixed(number > 0 && number < 1 ? 4 : 2)}`;
  }

  if(number !== null) return `${code} ${number.toLocaleString('id-ID', { maximumFractionDigits: 4 })}`;
  if(costText !== null && costText !== undefined && costText !== '') return String(costText);
  return emptyText;
}

export function formatDuration(value, fallbackSeconds = null){
  if(typeof value === 'string' && value.trim() !== '' && Number.isNaN(Number(value))){
    return value;
  }

  const seconds = numberValue(value) ?? numberValue(fallbackSeconds);
  if(seconds === null) return '-';

  const total = Math.max(0, Math.trunc(seconds));
  const h = Math.trunc(total / 3600);
  const m = Math.trunc((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map(part=>String(part).padStart(2, '0')).join(':');
}

export function formatDateTime(timestamp, fallbackDate = null, fallbackTime = null){
  const dateText = cleanText(fallbackDate);
  const timeText = cleanText(fallbackTime);
  if(dateText && timeText) return `${dateText} ${timeText}`;
  if(dateText) return dateText;

  const numeric = numberValue(timestamp);
  if(numeric === null || numeric < MIN_UNIX_MS){
    return timeText ?? '-';
  }

  try{
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(new Date(numeric));
  }catch(error){
    const date = new Date(numeric);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('id-ID');
  }
}

export function cleanText(value){
  if(value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' || text === '-' ? null : text;
}

export function formatYesNo(value){
  if(value === null || value === undefined) return '-';
  return value ? 'Yes' : 'No';
}

export function formatOnOff(value){
  if(value === null || value === undefined) return '-';
  return value ? 'ON' : 'OFF';
}

export function formatSessionName(name){
  const text = cleanText(name);
  if(!text || text.toLowerCase() === 'unnamed load') return 'Unnamed Load';
  return text;
}

export function sessionEnergyKwh(session){
  const energy = numberValue(session?.energy ?? session?.energyKwh);
  if(energy !== null) return energy;
  const wh = numberValue(session?.energyWh);
  return wh === null ? null : wh / 1000;
}

export function sessionEnergyWh(session){
  const wh = numberValue(session?.energyWh);
  if(wh !== null) return wh;
  const kwh = sessionEnergyKwh(session);
  return kwh === null ? null : kwh * 1000;
}

export function sessionTimestamp(session){
  return numberValue(
    session?.endUnixMs ??
    session?.timestamp ??
    session?.startUnixMs ??
    session?.createdAt ??
    session?.copiedAt
  );
}

export function isOverloadSession(session){
  const reason = String(session?.endReason ?? session?.reason ?? '').trim().toUpperCase();
  return reason === 'OVERLOAD' || session?.overload === true || session?.isOverload === true;
}

export function isRecoveredSession(session){
  return session?.recovered === true || cleanText(session?.recoverySource) !== null;
}

export function isOfflineSession(session){
  const tag = String(session?.sessionTag ?? '').trim().toLowerCase();
  const startMode = String(session?.startMode ?? '').trim().toUpperCase();
  return session?.offlineSession === true ||
    startMode === 'OFFLINE' ||
    tag === 'sesi offline';
}

export function normalizeSessionMap(value){
  if(value === null || value === undefined) return [];
  return Object.entries(value)
    .map(([key, session])=>({
      ...(session ?? {}),
      id: session?.id ?? key,
      sessionId: session?.sessionId ?? key
    }))
    .sort((a, b)=>(sessionTimestamp(b) ?? 0) - (sessionTimestamp(a) ?? 0));
}

export function isValidFirebaseKey(value){
  if(value === null || value === undefined) return false;
  return !/[.#$\[\]\/]/.test(String(value));
}

export function downloadText(filename, text, mime = 'text/plain;charset=utf-8'){
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function csvEscape(value){
  const text = value === null || value === undefined ? '' : String(value);
  if(/[",\n\r]/.test(text)){
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}
