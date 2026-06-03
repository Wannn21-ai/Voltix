import { db, DEVICE_ID } from './firebase-config.js';
import { get, ref, remove, set } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js';
import { logout, requireAuth } from './auth.js';
import {
  applyTheme,
  csvEscape,
  downloadText,
  isOfflineSession,
  loadUiSettings,
  normalizeSessionMap,
  qs,
  renderShell,
  saveUiSettings,
  showToast
} from './utils.js';

const DEFAULT_CONFIG = {
  tariff: 1444.7,
  currency: 'IDR',
  overloadThreshold: 2000,
  overloadWarningPercent: 90,
  loadPowerThreshold: 1,
  loadCurrentThreshold: 0.02,
  loadRemovedDelaySec: 2,
  offlineTimeoutSec: 300,
  checkpointIntervalSec: 30
};

const numericFields = [
  'tariff',
  'overloadThreshold',
  'overloadWarningPercent',
  'loadPowerThreshold',
  'loadCurrentThreshold',
  'loadRemovedDelaySec',
  'offlineTimeoutSec',
  'checkpointIntervalSec'
];

const els = {};
let currentUser = null;

async function init(){
  applyTheme();
  currentUser = await requireAuth();
  renderShell('settings', 'Settings', {
    user: currentUser,
    onLogout: async ()=>{
      await logout();
      window.location.href = 'login.html';
    }
  });
  bindEls();

  els.settingsForm.addEventListener('submit', handleSave);
  els.exportUserHistoryBtn.addEventListener('click', exportUserHistory);
  els.deleteUserHistoryBtn.addEventListener('click', deleteAllHistory);
  els.theme.addEventListener('change', ()=>applyTheme(els.theme.value));

  await loadSettings();
}

function bindEls(){
  [
    'settingsForm','settingsStatus','settingsMessage','saveSettingsBtn','currency',
    'theme','language','notifyStale','notifyOverload','notifyCommandAck',
    'exportUserHistoryBtn','deleteUserHistoryBtn',
    ...numericFields
  ].forEach(id=>{ els[id] = qs(id); });
}

async function loadSettings(){
  setBusy(true, 'Loading...', 'Loading...');
  setMessage('');

  try{
    const [configSnap, userSettingsSnap] = await Promise.all([
      get(ref(db, `/devices/${DEVICE_ID}/config`)),
      get(ref(db, `/users/${currentUser.uid}/settings`)).catch(error=>{
        console.warn('[settings] user settings unavailable', error);
        return null;
      })
    ]);

    const config = withDefaults(configSnap.val());
    const local = loadUiSettings();
    const userSettings = userSettingsSnap?.val() || {};
    const ui = {
      ...local,
      ...(userSettings.ui || {}),
      currency: userSettings.currency ?? config.currency ?? local.currency
    };

    fillDeviceForm(config);
    fillUiForm(ui);
    els.settingsStatus.textContent = 'Loaded';
  }catch(error){
    console.error('[settings] failed to load', error);
    fillDeviceForm(DEFAULT_CONFIG);
    fillUiForm(loadUiSettings());
    setMessage(`Failed to load settings: ${error.message}`, 'error');
    els.settingsStatus.textContent = 'Using defaults';
  }finally{
    setBusy(false);
  }
}

async function handleSave(event){
  event.preventDefault();
  setMessage('');

  let config;
  let uiSettings;
  try{
    config = readDeviceConfig();
    validateConfig(config);
    uiSettings = readUiSettings(config.currency);
  }catch(error){
    setMessage(error.message, 'error');
    return;
  }

  setBusy(true, 'Saving...');
  try{
    await Promise.all([
      set(ref(db, `/devices/${DEVICE_ID}/config`), config),
      set(ref(db, `/users/${currentUser.uid}/settings`), {
        currency: config.currency,
        ui: uiSettings,
        notifications: uiSettings.notifications,
        updatedAt: Date.now()
      })
    ]);
    saveUiSettings(uiSettings);
    setMessage('Settings saved. ESP32 will apply device config on its next config sync.', 'success');
    els.settingsStatus.textContent = 'Saved';
    showToast('Settings saved');
  }catch(error){
    console.error('[settings] failed to save', error);
    setMessage(`Failed to save settings: ${error.message}`, 'error');
    els.settingsStatus.textContent = 'Save failed';
  }finally{
    setBusy(false);
  }
}

function withDefaults(config){
  const source = config ?? {};
  return {
    tariff: source.tariff ?? DEFAULT_CONFIG.tariff,
    currency: source.currency ?? DEFAULT_CONFIG.currency,
    overloadThreshold: source.overloadThreshold ?? DEFAULT_CONFIG.overloadThreshold,
    overloadWarningPercent: source.overloadWarningPercent ?? DEFAULT_CONFIG.overloadWarningPercent,
    loadPowerThreshold: source.loadPowerThreshold ?? DEFAULT_CONFIG.loadPowerThreshold,
    loadCurrentThreshold: source.loadCurrentThreshold ?? DEFAULT_CONFIG.loadCurrentThreshold,
    loadRemovedDelaySec: source.loadRemovedDelaySec ?? DEFAULT_CONFIG.loadRemovedDelaySec,
    offlineTimeoutSec: source.offlineTimeoutSec ?? DEFAULT_CONFIG.offlineTimeoutSec,
    checkpointIntervalSec: source.checkpointIntervalSec ?? DEFAULT_CONFIG.checkpointIntervalSec
  };
}

function fillDeviceForm(config){
  numericFields.forEach(field=>{
    els[field].value = config[field] ?? DEFAULT_CONFIG[field];
  });
  els.currency.value = config.currency ?? DEFAULT_CONFIG.currency;
}

function fillUiForm(settings){
  els.theme.value = ['electric', 'dark', 'light'].includes(settings.theme) ? settings.theme : 'electric';
  els.language.value = settings.language ?? 'en';
  els.notifyStale.checked = settings.notifications?.stale ?? true;
  els.notifyOverload.checked = settings.notifications?.overload ?? true;
  els.notifyCommandAck.checked = settings.notifications?.commandAck ?? true;
  applyTheme(els.theme.value);
}

function readDeviceConfig(){
  const config = {
    currency: els.currency.value.trim().toUpperCase()
  };

  numericFields.forEach(field=>{
    config[field] = readNumber(field);
  });

  return config;
}

function readUiSettings(currency){
  return {
    theme: els.theme.value,
    language: els.language.value,
    currency,
    notifications: {
      stale: els.notifyStale.checked,
      overload: els.notifyOverload.checked,
      commandAck: els.notifyCommandAck.checked
    }
  };
}

function readNumber(field){
  const raw = els[field].value.trim();
  if(raw === '') throw new Error(`${field} is required.`);

  const value = Number(raw);
  if(Number.isNaN(value)) throw new Error(`${field} must be a number.`);
  return value;
}

function validateConfig(config){
  if(!['IDR', 'USD'].includes(config.currency)){
    throw new Error('currency must be IDR or USD.');
  }
  if(config.tariff < 0) throw new Error('tariff must be >= 0.');
  if(config.overloadThreshold <= 0) throw new Error('overloadThreshold must be > 0.');
  if(config.overloadWarningPercent < 1 || config.overloadWarningPercent > 100){
    throw new Error('overloadWarningPercent must be between 1 and 100.');
  }
  if(config.loadPowerThreshold < 0) throw new Error('loadPowerThreshold must be >= 0.');
  if(config.loadCurrentThreshold < 0) throw new Error('loadCurrentThreshold must be >= 0.');
  if(config.loadRemovedDelaySec < 1) throw new Error('loadRemovedDelaySec must be >= 1.');
  if(config.offlineTimeoutSec < 10) throw new Error('offlineTimeoutSec must be >= 10.');
  if(config.checkpointIntervalSec < 5) throw new Error('checkpointIntervalSec must be >= 5.');
}

async function exportUserHistory(){
  try{
    const snap = await get(ref(db, `/users/${currentUser.uid}/history`));
    const sessions = normalizeSessionMap(snap.val());
    const rows = [['sessionId','deviceName','energy','energyWh','cost','endReason','timestamp','sessionTag','offlineSession','startMode','endMode','syncStatus']];
    sessions.forEach(session=>{
      rows.push([
        session.sessionId,
        session.deviceName ?? session.name,
        session.energy ?? session.energyKwh,
        session.energyWh,
        session.cost,
        session.endReason,
        session.timestamp ?? session.endUnixMs ?? session.startUnixMs,
        session.sessionTag ?? (isOfflineSession(session) ? 'Sesi Offline' : ''),
        isOfflineSession(session),
        session.startMode,
        session.endMode,
        session.syncStatus
      ]);
    });
    downloadText(`voltix-user-history-${Date.now()}.csv`, rows.map(row=>row.map(csvEscape).join(',')).join('\n'), 'text/csv;charset=utf-8');
  }catch(error){
    setMessage(`Export failed: ${error.message}`, 'error');
  }
}

async function deleteAllHistory(){
  const answer = window.prompt(`Type DELETE to clear /devices/${DEVICE_ID}/completedSessions and /users/{your uid}/history.`);
  if(answer !== 'DELETE') return;

  setBusy(true, 'Deleting...', 'Deleting...');
  try{
    await Promise.all([
      remove(ref(db, `/devices/${DEVICE_ID}/completedSessions`)),
      remove(ref(db, `/users/${currentUser.uid}/history`))
    ]);
    setMessage('All history was cleared from device completedSessions and your account history.', 'success');
    showToast('All history cleared');
  }catch(error){
    setMessage(`Delete failed: ${error.message}`, 'error');
  }finally{
    setBusy(false);
  }
}

function setBusy(isBusy, status, busyLabel = 'Saving...'){
  els.saveSettingsBtn.disabled = isBusy;
  els.saveSettingsBtn.textContent = isBusy ? busyLabel : 'Save Settings';
  if(status !== undefined){
    els.settingsStatus.textContent = status;
  }
}

function setMessage(message, type){
  els.settingsMessage.textContent = message;
  els.settingsMessage.className = type ? `status-message ${type}` : 'status-message';
}

window.addEventListener('load', ()=>init());
