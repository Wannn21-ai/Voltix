import { db, DEVICE_ID } from './firebase-config.js';
import { onValue, ref } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js';
import { logout, requireAuth } from './auth.js';
import { sendStart, sendStop } from './command.js';
import {
  applyTheme,
  formatCost,
  formatCurrent,
  formatDuration,
  formatEnergyKwh,
  formatEnergyWh,
  formatFrequency,
  formatNumber,
  formatOnOff,
  formatPower,
  formatUnit,
  formatVoltage,
  formatYesNo,
  numberValue,
  qs,
  renderShell,
  safeText,
  sessionEnergyKwh,
  showToast
} from './utils.js';
import {
  computeEnergyInsights,
  normalizeCompletedSessions,
  renderInsightElements
} from './insights.js';

const els = {};
const state = {
  user: null,
  config: {},
  live: null,
  insightSessions: [],
  lastFreshValue: null,
  lastFreshChangeAt: 0,
  pendingCommand: null,
  powerSamples: [],
  charts: {}
};

async function init(){
  applyTheme();
  state.user = await requireAuth();
  renderShell('dashboard', 'Dashboard', {
    user: state.user,
    onLogout: async ()=>{
      await logout();
      window.location.href = 'login.html';
    }
  });
  cleanDashboardShell();
  bindEls();
  els.deviceId.textContent = DEVICE_ID;
  setupCommands();
  setupCharts();
  listenLive();
  listenConfig();
  listenCompletedSessions();
  listenLastAck();
  updateConnectionStatus();
  setInterval(updateConnectionStatus, 2000);
}

function cleanDashboardShell(){
  const kicker = document.querySelector('.topbar-title-block .page-kicker');
  if(kicker){
    kicker.innerHTML = `<span id="deviceId" hidden>${DEVICE_ID}</span>`;
  }

  document.querySelector('.topbar-actions a[href="history.html"]')?.remove();
}

function bindEls(){
  [
    'connectionStatus','deviceId','deviceName','systemMode','sessionState','relayState','loadDetected',
    'liveControlBar',
    'lastSeen','uptime','ipAddress','voltage','current','power','apparentPower','frequency','pf',
    'pzemTotalKWh','sessionEnergyWh','sessionEnergyKWh','sessionCost','elapsedSec','peakPower',
    'averagePower','tariff','overloadThreshold','warningLimit','overloadInfo','voltageGauge',
    'currentGauge','voltageGaugeValue','currentGaugeValue','powerCard','powerStatusBadge','webStatusText','cmdDeviceName','startBtn','topStopBtn',
    'commandFab','commandModal','commandModalClose',
    'commandStatus','lastAck','dashboardInsightStatus','totalSessions','totalEnergyKwh',
    'totalEnergyWh','totalCost','highestPeakPower','highestPeakPowerDevice','mostEnergyDevice',
    'mostEnergyValue','overloadCount','peakWarning','overloadWarning'
  ].forEach(id=>{ els[id] = qs(id); });
}

function setupCommands(){
  els.commandFab?.addEventListener('click', ()=>setCommandModalOpen(true));
  els.commandModalClose?.addEventListener('click', ()=>setCommandModalOpen(false));
  els.commandModal?.addEventListener('click', event=>{
    if(event.target === els.commandModal){
      setCommandModalOpen(false);
    }
  });

  els.startBtn.addEventListener('click', async ()=>{
    beginCommandSend('START');
    try{
      const cmd = await sendStart(els.cmdDeviceName.value.trim(), state.config);
      waitForAck(cmd);
      setCommandModalOpen(false);
      showToast(`START sent: ${cmd.id}`);
    }catch(error){
      clearPendingCommand();
      setCommandStatus(`START failed: ${error.message}`);
      showToast(`START failed: ${error.message}`);
    }
  });

  els.topStopBtn?.addEventListener('click', sendStopCommand);
}

async function sendStopCommand(){
    beginCommandSend('STOP');
    try{
      const sessId = state.live?.session?.sessionId;
      const cmd = await sendStop(sessId);
      waitForAck(cmd);
      setCommandModalOpen(false);
      showToast(`STOP sent: ${cmd.id}`);
    }catch(error){
      clearPendingCommand();
      setCommandStatus(`STOP failed: ${error.message}`);
      showToast(`STOP failed: ${error.message}`);
    }
}

function setCommandModalOpen(isOpen){
  if(!els.commandModal) return;
  els.commandModal.classList.toggle('show', isOpen);
  els.commandModal.setAttribute('aria-hidden', String(!isOpen));
  if(isOpen){
    els.cmdDeviceName?.focus();
  }
}

function listenLive(){
  onValue(ref(db, `/devices/${DEVICE_ID}/live`), snap=>{
    const live = snap.val() || {};
    state.live = live;
    trackFreshness(live.system || {});
    updateLiveUI(live);
    updatePowerChart(live);
  }, error=>{
    console.error('[dashboard] live load failed', error);
    setCommandStatus(`Live read failed: ${error.message}`);
  });
}

function listenConfig(){
  onValue(ref(db, `/devices/${DEVICE_ID}/config`), snap=>{
    state.config = snap.val() || {};
    updateConfigUI();
    renderInsights();
  });
}

function listenCompletedSessions(){
  onValue(ref(db, `/devices/${DEVICE_ID}/completedSessions`), snap=>{
    state.insightSessions = normalizeCompletedSessions(snap.val());
    renderInsights();
    updateHistoryCharts();
  }, error=>{
    console.error('[dashboard] insight history load failed', error);
    state.insightSessions = [];
    renderInsights();
    updateHistoryCharts();
  });
}

function listenLastAck(){
  onValue(ref(db, `/devices/${DEVICE_ID}/commands/lastAck`), snap=>{
    const ack = snap.val();
    if(!ack){
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
  const currency = state.config.currency ?? session.currency ?? 'IDR';

  setText('deviceName', session.deviceName ?? device.deviceName ?? live.deviceName);
  setText('systemMode', sys.systemMode);
  setText('sessionState', sys.sessionState);
  setText('relayState', formatOnOff(sys.relay));
  setText('loadDetected', formatYesNo(device.loadDetected));
  setText('lastSeen', formatFreshnessText());
  setText('uptime', formatDuration(sys.uptime ?? sys.uptimeSec));
  setText('ipAddress', sys.ip ?? sys.ipAddress ?? live.ip);

  setText('voltage', formatVoltage(device.voltage));
  setText('current', formatCurrent(device.current));
  setText('power', formatPower(device.power));
  setText('apparentPower', formatUnit(device.apparent ?? device.apparentPower, 1, 'VA'));
  setText('frequency', formatFrequency(device.frequency));
  setText('pf', formatNumber(device.powerFactor ?? device.pf, 2));
  setText('pzemTotalKWh', formatEnergyKwh(device.energy ?? device.pzemTotalKwh, 6));

  setText('sessionEnergyWh', formatEnergyWh(session.energyWh, 6));
  setText('sessionEnergyKWh', formatEnergyKwh(session.energy ?? session.energyKwh, 3));
  setText('sessionCost', formatCost(session.cost, currency, session.costText, currency === 'IDR' ? 'Rp 0' : '$0.00'));
  setText('elapsedSec', formatDuration(session.elapsedSec ?? session.durationSec));
  setText('peakPower', formatPower(session.peakPower));
  setText('averagePower', formatPower(session.averagePower));

  updateGauges(device);
  updateOverloadInfo(device, session);
  updateConnectionStatus();
  updateCommandButtons();
}

function updateConfigUI(){
  const currency = state.config.currency ?? 'IDR';
  const threshold = numberValue(state.config.overloadThreshold);
  const warningPercent = numberValue(state.config.overloadWarningPercent) ?? 90;

  setText('tariff', formatCost(state.config.tariff, currency, null, currency === 'IDR' ? 'Rp 0' : '$0.00'));
  setText('overloadThreshold', formatPower(threshold));
  setText('warningLimit', threshold === null ? '-' : formatPower(threshold * (warningPercent / 100)));
  updateOverloadInfo(state.live?.device || {}, state.live?.session || {});
}

function updateOverloadInfo(device){
  const power = numberValue(device.power);
  const threshold = numberValue(state.config.overloadThreshold);
  const warningPercent = numberValue(state.config.overloadWarningPercent) ?? 90;

  if(power === null || threshold === null || threshold <= 0){
    els.overloadInfo.textContent = 'Waiting for power and threshold data.';
    els.overloadInfo.className = 'notice';
    updatePowerCardState('normal');
    return;
  }

  const warningLimit = threshold * (warningPercent / 100);
  if(power >= threshold){
    els.overloadInfo.textContent = `Overload risk: ${formatPower(power)} is above ${formatPower(threshold)}.`;
    els.overloadInfo.className = 'notice danger';
    updatePowerCardState('danger');
  }else if(power >= warningLimit){
    els.overloadInfo.textContent = `Warning: ${formatPower(power)} is near the overload threshold.`;
    els.overloadInfo.className = 'notice warning';
    updatePowerCardState('warning');
  }else{
    els.overloadInfo.textContent = `Load is below warning limit (${formatPower(warningLimit)}).`;
    els.overloadInfo.className = 'notice success';
    updatePowerCardState('normal');
  }
}

function updatePowerCardState(stateName){
  if(!els.powerCard) return;
  els.powerCard.classList.toggle('power-warning', stateName === 'warning');
  els.powerCard.classList.toggle('power-danger', stateName === 'danger');
  updatePowerStatusBadge(stateName);
}

function updateGauges(device){
  const voltage = numberValue(device.voltage);
  const current = numberValue(device.current);
  setGauge(els.voltageGauge, els.voltageGaugeValue, voltage, 240, formatNumber(voltage, 1));
  setGauge(els.currentGauge, els.currentGaugeValue, current, 6, formatNumber(current, 3));
}

function setGauge(gauge, label, value, max, text){
  if(!gauge || !label) return;
  const number = numberValue(value) ?? 0;
  const degrees = Math.max(0, Math.min(360, (number / max) * 360));
  gauge.style.setProperty('--gauge-value', `${degrees}deg`);
  label.textContent = text;
}

function setupCharts(){
  if(!window.Chart) return;
  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: getChartTextColor() } }
    },
    scales: {
      x: { ticks: { color: getChartTextColor() }, grid: { color: getChartGridColor() } },
      y: { ticks: { color: getChartTextColor() }, grid: { color: getChartGridColor() }, beginAtZero: true }
    }
  };

  state.charts.power = new Chart(qs('powerChart'), {
    type: 'line',
    data: { labels: [], datasets: [{ label: 'Power W', data: [], borderColor: '#00e5ff', backgroundColor: 'rgba(0,229,255,0.16)', tension: 0.25, fill: true }] },
    options: baseOptions
  });

  state.charts.usage = new Chart(qs('usagePieChart'), {
    type: 'doughnut',
    data: { labels: [], datasets: [{ data: [], backgroundColor: ['#00e5ff', '#00e676', '#ffab00', '#ff1744', '#888888'] }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: getChartTextColor() } } } }
  });

  state.charts.comparison = new Chart(qs('comparisonBarChart'), {
    type: 'bar',
    data: { labels: [], datasets: [{ label: 'Peak W', data: [], backgroundColor: '#00e5ff', borderColor: '#00e676', borderWidth: 1 }] },
    options: baseOptions
  });
}

function updatePowerChart(live){
  const power = numberValue(live?.device?.power);
  if(power === null || !state.charts.power) return;

  state.powerSamples.push({
    label: new Date().toLocaleTimeString('id-ID', { hour12: false }),
    value: power
  });
  state.powerSamples = state.powerSamples.slice(-48);

  state.charts.power.data.labels = state.powerSamples.map(sample=>sample.label);
  state.charts.power.data.datasets[0].data = state.powerSamples.map(sample=>sample.value);
  state.charts.power.update('none');
}

function updateHistoryCharts(){
  if(!window.Chart) return;

  const topEnergy = [...state.insightSessions]
    .sort((a, b)=>(sessionEnergyKwh(b) ?? 0) - (sessionEnergyKwh(a) ?? 0))
    .slice(0, 5);
  if(state.charts.usage){
    state.charts.usage.data.labels = topEnergy.map(session=>session.deviceName ?? session.name ?? session.sessionId);
    state.charts.usage.data.datasets[0].data = topEnergy.map(session=>sessionEnergyKwh(session) ?? 0);
    state.charts.usage.update();
  }

  const topPeak = [...state.insightSessions]
    .sort((a, b)=>(numberValue(b.peakPower ?? b.power) ?? 0) - (numberValue(a.peakPower ?? a.power) ?? 0))
    .slice(0, 6);
  if(state.charts.comparison){
    state.charts.comparison.data.labels = topPeak.map(session=>session.deviceName ?? session.name ?? session.sessionId);
    state.charts.comparison.data.datasets[0].data = topPeak.map(session=>numberValue(session.peakPower ?? session.power) ?? 0);
    state.charts.comparison.update();
  }
}

function renderInsights(){
  const insights = computeEnergyInsights(state.insightSessions, state.config || {});
  renderInsightElements(els, insights, state.config.currency ?? 'IDR');
  els.dashboardInsightStatus.textContent = state.insightSessions.length ? `${state.insightSessions.length} completed sessions` : 'No completed sessions';
}

function trackFreshness(sys){
  const timestamp = sys.timestamp ?? null;
  const uptime = sys.uptime ?? sys.uptimeSec ?? null;
  const freshValue = `${timestamp ?? ''}:${uptime ?? ''}`;

  if(timestamp === null && uptime === null) return;
  if(state.lastFreshValue === null || state.lastFreshValue !== freshValue){
    state.lastFreshValue = freshValue;
    state.lastFreshChangeAt = Date.now();
  }
}

function updateConnectionStatus(){
  const online = isEspOnline();
  els.connectionStatus.textContent = online ? 'Online' : 'Offline';
  els.connectionStatus.className = `status-pill ${online ? 'online' : 'offline'}`;
  if(els.webStatusText){
    els.webStatusText.textContent = state.lastFreshValue === null
      ? 'Web: menunggu ESP32'
      : online ? 'Web: online' : 'Web: offline';
  }
  updatePowerStatusBadge();
  setText('lastSeen', formatFreshnessText());
}

function isEspOnline(){
  const staleMs = Date.now() - (state.lastFreshChangeAt || 0);
  return state.lastFreshValue !== null && staleMs <= 15000;
}

function updatePowerStatusBadge(powerState = null){
  if(!els.powerStatusBadge) return;
  const sessionState = String(state.live?.system?.sessionState ?? '').toUpperCase();
  const relayOn = state.live?.system?.relay === true;
  const active = state.live?.session?.active === true;
  const effectivePowerState = powerState || (
    els.powerCard?.classList.contains('power-danger') ? 'danger' :
    els.powerCard?.classList.contains('power-warning') ? 'warning' :
    'normal'
  );

  let label = 'Idle';
  let className = 'badge';
  if(effectivePowerState === 'danger'){
    label = 'Overload';
    className = 'badge danger';
  }else if(effectivePowerState === 'warning'){
    label = 'Monitoring';
    className = 'badge warning';
  }else if(active || relayOn || sessionState === 'MONITORING' || sessionState === 'WAITING_LOAD'){
    label = 'Monitoring';
    className = 'badge success';
  }

  els.powerStatusBadge.textContent = label;
  els.powerStatusBadge.className = className;
}

function formatFreshnessText(){
  if(!state.lastFreshChangeAt) return '-';
  const age = Math.max(0, Math.trunc((Date.now() - state.lastFreshChangeAt) / 1000));
  return age === 0 ? 'just now' : `${age}s ago`;
}

function beginCommandSend(type){
  state.pendingCommand = {
    id: null,
    type,
    timeoutId: null
  };
  setCommandStatus(`Sending ${type}...`);
  updateCommandButtons();
}

function waitForAck(cmd){
  state.pendingCommand = {
    ...state.pendingCommand,
    id: cmd.id,
    type: cmd.type,
    timeoutId: window.setTimeout(()=>{
      if(state.pendingCommand?.id === cmd.id){
        setCommandStatus(`${cmd.type} timeout: no matching ACK after 20 seconds`, 'warning');
        clearPendingCommand();
      }
    }, 20000)
  };
  setCommandStatus(`Waiting for ${cmd.type} ACK (${cmd.id})...`);
  updateCommandButtons();
  handleCommandAck(state.lastAck || {});
}

function handleCommandAck(ack){
  if(!state.pendingCommand?.id || ack.id !== state.pendingCommand.id) return;
  const message = ack.message ? `: ${ack.message}` : '';
  const status = String(ack.status ?? 'DONE').toUpperCase();
  const tone = status === 'REJECTED' ? 'warning' : status === 'ERROR' ? 'error' : 'success';
  setCommandStatus(`${ack.type ?? state.pendingCommand.type} ${status}${message}`, tone);
  if(status === 'REJECTED'){
    showToast(ack.message || 'Command rejected');
  }
  clearPendingCommand();
}

function clearPendingCommand(){
  if(state.pendingCommand?.timeoutId){
    window.clearTimeout(state.pendingCommand.timeoutId);
  }
  state.pendingCommand = null;
  updateCommandButtons();
}

function updateCommandButtons(){
  const sys = state.live?.system || {};
  const session = state.live?.session || {};
  const waiting = !!state.pendingCommand;
  const relayOn = sys.relay === true;
  const sessionState = String(sys.sessionState ?? '').toUpperCase();
  const busy = relayOn || session.active === true || sessionState === 'MONITORING' || sessionState === 'WAITING_LOAD';

  els.startBtn.disabled = waiting || busy;
  const stopDisabled = waiting || (!busy && session.active !== true);
  if(els.topStopBtn){
    els.topStopBtn.disabled = stopDisabled;
    els.topStopBtn.hidden = stopDisabled && state.pendingCommand?.type !== 'STOP';
    els.topStopBtn.classList.toggle('is-active', busy && !waiting);
  }
  if(els.liveControlBar){
    els.liveControlBar.hidden = !els.topStopBtn || els.topStopBtn.hidden;
  }
  els.startBtn.textContent = waiting && state.pendingCommand?.type === 'START' ? 'Sending START...' : 'Start Monitoring';
  if(els.topStopBtn){
    els.topStopBtn.textContent = waiting && state.pendingCommand?.type === 'STOP' ? 'Sending STOP...' : 'Stop';
  }
}

function setCommandStatus(message, tone = ''){
  els.commandStatus.textContent = message;
  els.commandStatus.className = tone ? `command-status ${tone}` : 'command-status';
}

function formatAck(ack){
  const fields = [
    ['ID', ack.id],
    ['Type', ack.type],
    ['Status', ack.status],
    ['Reason', ack.reason],
    ['Message', ack.message],
    ['Processed At', ack.processedAt]
  ];
  return fields.map(([label, value])=>`${label}: ${safeText(value)}`).join('\n');
}

function setText(id, value){
  if(els[id]) els[id].textContent = safeText(value);
}

function getChartTextColor(){
  return getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#90aeb0';
}

function getChartGridColor(){
  return getComputedStyle(document.documentElement).getPropertyValue('--line').trim() || 'rgba(255,255,255,0.12)';
}

window.addEventListener('load', ()=>init());
