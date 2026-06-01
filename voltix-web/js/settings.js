import { auth, db, DEVICE_ID } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { ref, get, set } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js';

const DEFAULT_CONFIG = {
  tariff: 1444.7,
  currency: 'IDR',
  overloadThreshold: 2000,
  overloadWarningPercent: 99,
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

function $(id){ return document.getElementById(id); }

async function init(){
  bindEls();
  currentUser = await requireUser();
  els.settingsForm.addEventListener('submit', handleSave);
  await loadSettings();
}

function bindEls(){
  [
    'settingsForm','settingsStatus','settingsMessage','saveSettingsBtn','currency',
    ...numericFields
  ].forEach(id=>els[id] = $(id));
}

function requireUser(){
  return new Promise(resolve=>{
    onAuthStateChanged(auth, user=>{
      if(!user){
        location.href = 'login.html';
        return;
      }
      resolve(user);
    });
  });
}

async function loadSettings(){
  setBusy(true, 'Loading...', 'Save Settings');
  setMessage('');

  try{
    const configRef = ref(db, `/devices/${DEVICE_ID}/config`);
    const snap = await get(configRef);
    const config = withDefaults(snap.val());
    console.log('[settings] loaded', config);
    fillForm(config);
    els.settingsStatus.textContent = 'Loaded';
  }catch(error){
    console.error('[settings] failed to load', error);
    fillForm(DEFAULT_CONFIG);
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
  try{
    config = readFormConfig();
    validateConfig(config);
  }catch(error){
    setMessage(error.message, 'error');
    return;
  }

  setBusy(true, 'Saving...');
  try{
    await Promise.all([
      set(ref(db, `/devices/${DEVICE_ID}/config`), config),
      set(ref(db, `/users/${currentUser.uid}/settings`), config)
    ]);
    console.log('[settings] saved', config);
    setMessage('Settings saved. ESP32 will apply config on next sync.', 'success');
    els.settingsStatus.textContent = 'Saved';
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

function fillForm(config){
  numericFields.forEach(field=>{
    els[field].value = config[field] ?? DEFAULT_CONFIG[field];
  });
  els.currency.value = config.currency ?? DEFAULT_CONFIG.currency;
}

function readFormConfig(){
  const config = {
    currency: els.currency.value.trim()
  };

  numericFields.forEach(field=>{
    config[field] = readNumber(field);
  });

  return config;
}

function readNumber(field){
  const raw = els[field].value.trim();
  if(raw === '') throw new Error(`${field} is required.`);

  const value = Number(raw);
  if(Number.isNaN(value)) throw new Error(`${field} must be a number.`);
  return value;
}

function validateConfig(config){
  if(config.currency === '') throw new Error('currency is required.');
  if(config.tariff <= 0) throw new Error('tariff must be > 0.');
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
