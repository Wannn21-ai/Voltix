import { db, DEVICE_ID } from './firebase-config.js';
import { ref, onValue } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js';
import { requireAuth, logout } from './auth.js';
import { sendStart, sendStop } from './command.js';
import { showToast } from './utils.js';
import {
  computeEnergyInsights,
  normalizeCompletedSessions,
  renderInsightElements
} from './insights.js';

const els = {};
const state = {
  config: null,
  live: null,
  insightSessions: [],
  liveSystemTimestamp: undefined,
  lastTimestampChangeAt: Date.now(),
  pendingCommand: null
};

function $(id){ return document.getElementById(id); }

async function init(){
  await requireAuth();
  bindEls();
  setupAuthUI();
  listenLive();
  listenConfig();
  listenHistoryInsights();
  listenLastAck();
  startOnlineChecker();
}

function bindEls(){
  ['deviceId','deviceName','systemMode','sessionState','relayState','loadDetected','elapsedSec',
   'voltage','current','power','apparentPower','frequency','pf','pzemTotalWh',
   'sessionEnergyWh','sessionEnergyKWh','sessionCost','lastAck','connectionStatus','cmdDeviceName','commandStatus',
   'startBtn','stopBtn','logoutBtn','dashboardInsightStatus','totalSessions','totalEnergyKwh','totalEnergyWh',
   'totalCost','highestPeakPower','highestPeakPowerDevice','mostEnergyDevice','mostEnergyValue',
   'overloadCount','peakWarning','overloadWarning'].forEach(id=>els[id] = $(id));
}

function setupAuthUI(){
  els.deviceId.textContent = DEVICE_ID;
  els.logoutBtn.addEventListener('click', async ()=>{ await logout(); location.href='login.html'; });

  els.startBtn.addEventListener('click', async ()=>{
    beginCommandSend('START');
    try{
      const cmd = await sendStart(els.cmdDeviceName.value, state.config);
      waitForAck(cmd);
      showToast('START sent: '+cmd.id);
    }catch(e){
      clearPendingCommand();
      setCommandStatus('START failed: '+e.message);
      showToast('Failed: '+e.message);
    }
  });

  els.stopBtn.addEventListener('click', async ()=>{
    beginCommandSend('STOP');
    try{
      const sessId = state.live && state.live.session && state.live.session.sessionId;
      const cmd = await sendStop(sessId);
      waitForAck(cmd);
      showToast('STOP sent: '+cmd.id);
    }catch(e){
      clearPendingCommand();
      setCommandStatus('STOP failed: '+e.message);
      showToast('Failed: '+e.message);
    }
  });
}

function listenLive(){
  const liveRef = ref(db, `/devices/${DEVICE_ID}/live`);
  onValue(liveRef, snap=>{
    const live = snap.val() || {};
    state.live = live;
    trackLiveTimestamp(live.system || {});
    updateLiveUI(live);
  });
}

function listenConfig(){
  const cfgRef = ref(db, `/devices/${DEVICE_ID}/config`);
  onValue(cfgRef, snap=>{
    const cfg = snap.val() || {};
    state.config = cfg;
    renderHistoryInsights();
  });
}

function listenHistoryInsights(){
  const sessionsRef = ref(db, `/devices/${DEVICE_ID}/completedSessions`);
  onValue(sessionsRef, snap=>{
    state.insightSessions = normalizeCompletedSessions(snap.val());
    renderHistoryInsights();
  }, error=>{
    console.error('[dashboard] failed to load history insights', error);
    state.insightSessions = [];
    renderHistoryInsights();
    if(els.dashboardInsightStatus){
      els.dashboardInsightStatus.textContent = 'Insight load failed';
    }
  });
}

function renderHistoryInsights(){
  renderInsightElements(els, computeEnergyInsights(state.insightSessions, state.config || {}));
  if(els.dashboardInsightStatus){
    els.dashboardInsightStatus.textContent = state.insightSessions.length ? `${state.insightSessions.length} sessions` : 'No sessions';
  }
}

function listenLastAck(){
  const ackRef = ref(db, `/devices/${DEVICE_ID}/commands/lastAck`);
  onValue(ackRef, snap=>{
    const ack = snap.val();
    if(!ack) {
      state.lastAck = null;
      els.lastAck.textContent = '-';
      return;
    }
    state.lastAck = ack;
    els.lastAck.textContent = formatAck(ack);
    handleCommandAck(ack);
  });
}

function updateLiveUI(live){
  const sys = live.system || {};
  const device = live.device || {};
  const session = live.session || {};

  els.deviceName.textContent = safeText(session.deviceName);
  els.systemMode.textContent = safeText(sys.systemMode);
  els.sessionState.textContent = safeText(sys.sessionState);
  els.relayState.textContent = formatOnOff(sys.relay);
  els.loadDetected.textContent = formatYesNo(device.loadDetected);
  els.elapsedSec.textContent = formatValue(session.elapsedSec, 0, 's');

  els.voltage.textContent = formatValue(device.voltage, 1, 'V');
  els.current.textContent = formatValue(device.current, 3, 'A');
  els.power.textContent = formatValue(device.power, 1, 'W');
  els.apparentPower.textContent = formatValue(device.apparent, 1, 'VA');
  els.frequency.textContent = formatValue(device.frequency, 1, 'Hz');
  els.pf.textContent = formatValue(device.powerFactor, 2);
  els.pzemTotalWh.textContent = formatValue(device.energy, 6, 'kWh');

  els.sessionEnergyWh.textContent = formatValue(session.energyWh, 6, 'Wh');
  els.sessionEnergyKWh.textContent = formatValue(session.energy, 8, 'kWh');
  els.sessionCost.textContent = formatValue(session.cost, 4, 'IDR');

  const relayOn = sys.relay === true;
  const monitoring = sys.sessionState === 'MONITORING';
  const sessionActive = session.active === true;
  updateCommandButtons({ relayOn, monitoring, sessionActive });
  updateConnectionStatus();
}

function trackLiveTimestamp(sys){
  const timestamp = sys.timestamp;
  if(timestamp === null || timestamp === undefined) return;

  if(state.liveSystemTimestamp === undefined || timestamp !== state.liveSystemTimestamp){
    state.liveSystemTimestamp = timestamp;
    state.lastTimestampChangeAt = Date.now();
  }
}

function startOnlineChecker(){
  setInterval(updateConnectionStatus, 2000);
}

function updateConnectionStatus(){
  const staleMs = Date.now() - (state.lastTimestampChangeAt || 0);
  const online = state.liveSystemTimestamp !== undefined && staleMs <= 15000;
  els.connectionStatus.textContent = online ? 'ESP32 ONLINE' : 'ESP32 OFFLINE / stale';
}

function beginCommandSend(type){
  state.pendingCommand = {
    id: null,
    type,
    startedAt: Date.now(),
    timeoutId: null
  };
  setCommandStatus(`Sending ${type}...`);
  updateCommandButtons();
}

function waitForAck(cmd){
  if(!state.pendingCommand || state.pendingCommand.type !== cmd.type){
    state.pendingCommand = { type: cmd.type };
  }

  state.pendingCommand.id = cmd.id;
  state.pendingCommand.startedAt = Date.now();
  state.pendingCommand.timeoutId = setTimeout(()=>{
    if(state.pendingCommand && state.pendingCommand.id === cmd.id){
      setCommandStatus(`${cmd.type} timeout: no matching ack after 10 seconds`);
      clearPendingCommand();
    }
  }, 10000);

  setCommandStatus(`Waiting for ${cmd.type} ack (${cmd.id})...`);
  updateCommandButtons();
  handleCommandAck(state.lastAck || {});
}

function handleCommandAck(ack){
  if(!state.pendingCommand || !state.pendingCommand.id) return;
  if(ack.id !== state.pendingCommand.id) return;

  const type = ack.type || state.pendingCommand.type;
  const status = ack.status || 'DONE';
  const message = ack.message ? `: ${ack.message}` : '';
  setCommandStatus(`${type} ${status}${message}`);
  clearPendingCommand();
}

function clearPendingCommand(){
  if(state.pendingCommand && state.pendingCommand.timeoutId){
    clearTimeout(state.pendingCommand.timeoutId);
  }
  state.pendingCommand = null;
  updateCommandButtons();
}

function updateCommandButtons(liveState){
  const sys = (state.live && state.live.system) || {};
  const session = (state.live && state.live.session) || {};
  const relayOn = liveState ? liveState.relayOn : sys.relay === true;
  const monitoring = liveState ? liveState.monitoring : sys.sessionState === 'MONITORING';
  const sessionActive = liveState ? liveState.sessionActive : session.active === true;
  const waiting = !!state.pendingCommand;

  els.startBtn.disabled = waiting || relayOn || monitoring;
  els.stopBtn.disabled = waiting || (!relayOn && !sessionActive);
  els.startBtn.textContent = waiting && state.pendingCommand.type === 'START' ? 'Sending START...' : 'START';
  els.stopBtn.textContent = waiting && state.pendingCommand.type === 'STOP' ? 'Sending STOP...' : 'STOP';
}

function setCommandStatus(message){
  if(els.commandStatus){
    els.commandStatus.textContent = message;
  }
}

function formatValue(value, decimals, unit = ''){
  if(value === null || value === undefined) return '-';
  const number = Number(value);
  if(Number.isNaN(number)) return '-';
  const suffix = unit ? unit : '';
  return `${number.toFixed(decimals)}${suffix}`;
}

function safeText(value){
  if(value === null || value === undefined || value === '') return '-';
  return String(value);
}

function formatYesNo(value){
  if(value === null || value === undefined) return '-';
  return value ? 'Yes' : 'No';
}

function formatOnOff(value){
  if(value === null || value === undefined) return '-';
  return value ? 'ON' : 'OFF';
}

function formatAck(ack){
  const lines = [
    `ID: ${safeText(ack.id)}`,
    `Type: ${safeText(ack.type)}`,
    `Status: ${safeText(ack.status)}`,
    `Message: ${safeText(ack.message)}`
  ];
  if(ack.processedAt !== null && ack.processedAt !== undefined){
    lines.push(`Processed At: ${ack.processedAt}`);
  }
  return lines.join('\n');
}

window.addEventListener('load', ()=>init());
