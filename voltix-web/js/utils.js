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

export function initShell({ active, user, onLogout } = {}){
  applyTheme();
  document.querySelectorAll('[data-nav]').forEach(link=>{
    link.classList.toggle('active', link.dataset.nav === active);
  });

  const userEmail = qs('userEmail');
  if(userEmail && user){
    userEmail.textContent = user.email ?? user.uid ?? 'Signed in';
  }

  const logoutBtn = qs('logoutBtn');
  if(logoutBtn && onLogout){
    logoutBtn.addEventListener('click', onLogout);
  }
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
