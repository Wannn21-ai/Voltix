import { db, DEVICE_ID } from './firebase-config.js';
import { onValue, ref } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js';
import { logout, requireAuth } from './auth.js';
import {
  applyTheme,
  csvEscape,
  downloadText,
  formatCost,
  numberValue,
  qs,
  renderShell,
  showToast
} from './utils.js';

const MAX_SAMPLES = 60;
const MAX_LOG_ROWS = 100;
const ADV_EMPTY = '-';

const els = {};
const state = {
  config: {},
  samples: [],
  logRows: [],
  charts: {}
};

async function init(){
  applyTheme();
  const user = await requireAuth();
  renderShell('advanced', 'Advanced', {
    user,
    onLogout: async ()=>{
      await logout();
      window.location.href = 'login.html';
    }
  });

  bindEls();
  bindActions();
  setupChartsWhenReady();
  listenConfig();
  listenLive();
}

function bindEls(){
  [
    'advancedLiveBadge','pfStatus','pfValue','frequencyValue','apparentPowerValue',
    'reactivePowerValue','overloadThresholdValue','activePowerRef','apparentPowerRef','reactivePowerRef',
    'powerFactorRef','sessionEnergyWhRef','sessionEnergyKwhRef','sessionCostRef',
    'tariffRef','pfChart','frequencyChart','powerAdvancedChart','advancedLogBody',
    'clearLogBtn','exportLogBtn'
  ].forEach(id=>{ els[id] = qs(id); });
}

function bindActions(){
  els.clearLogBtn?.addEventListener('click', clearAdvancedLog);
  els.exportLogBtn?.addEventListener('click', exportAdvancedLogCsv);
}

function listenConfig(){
  onValue(ref(db, `/devices/${DEVICE_ID}/config`), snap=>{
    state.config = snap.val() || {};
    renderConfigRefs();
  }, error=>{
    console.error('[advanced] config read failed', error);
  });
}

function listenLive(){
  onValue(ref(db, `/devices/${DEVICE_ID}/live`), snap=>{
    const live = snap.val() || {};
    const sample = makeSample(live);
    renderLive(sample, live);
    if(hasTelemetry(sample)){
      appendSample(sample);
    }
  }, error=>{
    console.error('[advanced] live read failed', error);
    if(els.advancedLiveBadge){
      els.advancedLiveBadge.textContent = 'ERROR';
      els.advancedLiveBadge.className = 'status-pill offline';
    }
  });
}

function hasTelemetry(sample){
  return [
    sample.voltage,
    sample.current,
    sample.activePower,
    sample.apparentPower,
    sample.reactivePower,
    sample.powerFactor,
    sample.frequency
  ].some(value=>value !== null);
}

function makeSample(live){
  const device = live?.device || {};
  const session = live?.session || {};
  const system = live?.system || {};

  const voltage = numberValue(device.voltage);
  const current = numberValue(device.current);
  const activePower = numberValue(device.power);
  const liveApparent = numberValue(device.apparent ?? device.apparentPower);
  const calculatedApparent = voltage !== null && current !== null ? voltage * current : null;
  const apparentPower = liveApparent ?? calculatedApparent;
  const reactivePower = apparentPower !== null && activePower !== null
    ? Math.sqrt(Math.max(0, (apparentPower * apparentPower) - (activePower * activePower)))
    : null;
  const livePowerFactor = numberValue(device.powerFactor ?? device.pf);
  const calculatedPowerFactor = apparentPower !== null && apparentPower > 0 && activePower !== null
    ? activePower / apparentPower
    : null;
  const powerFactor = livePowerFactor ?? calculatedPowerFactor;

  return {
    time: new Date(),
    label: new Date().toLocaleTimeString('id-ID', { hour12: false }),
    voltage,
    current,
    activePower,
    apparentPower,
    reactivePower,
    powerFactor,
    frequency: numberValue(device.frequency),
    loadDetected: device.loadDetected === true,
    energyWh: numberValue(session.energyWh),
    energyKwh: numberValue(session.energy ?? session.energyKwh),
    cost: numberValue(session.cost),
    systemMode: system.systemMode ?? null,
    sessionState: system.sessionState ?? null
  };
}

function renderLive(sample){
  if(els.advancedLiveBadge){
    els.advancedLiveBadge.textContent = 'LIVE';
    els.advancedLiveBadge.className = 'status-pill online';
  }

  setText('pfValue', formatDecimal(sample.powerFactor, 2));
  setText('frequencyValue', `${formatDecimal(sample.frequency, 2)} Hz`);
  setText('apparentPowerValue', `${formatDecimal(sample.apparentPower, 1)} VA`);
  setText('reactivePowerValue', `${formatDecimal(sample.reactivePower, 1)} VAR`);

  setText('activePowerRef', formatUnit(sample.activePower, 1, 'W'));
  setText('apparentPowerRef', formatUnit(sample.apparentPower, 1, 'VA'));
  setText('reactivePowerRef', formatUnit(sample.reactivePower, 1, 'VAR'));
  setText('powerFactorRef', formatDecimal(sample.powerFactor, 2));
  setText('sessionEnergyWhRef', formatUnit(sample.energyWh, 6, 'Wh'));
  setText('sessionEnergyKwhRef', formatUnit(sample.energyKwh, 8, 'kWh'));
  setText('sessionCostRef', formatCost(sample.cost, state.config.currency ?? 'IDR', null, ADV_EMPTY));
  renderConfigRefs();
  renderPowerFactorStatus(sample);
}

function renderConfigRefs(){
  const tariff = numberValue(state.config.tariff);
  setText('tariffRef', tariff === null
    ? ADV_EMPTY
    : formatCost(tariff, state.config.currency ?? 'IDR', null, ADV_EMPTY));

  const overloadThreshold = numberValue(state.config.overloadThreshold);
  setText('overloadThresholdValue', formatUnit(overloadThreshold, 1, 'W'));
}

function renderPowerFactorStatus(sample){
  if(!els.pfStatus) return;

  let label = 'No Device';
  let className = 'advanced-status-dot no-device';
  if(sample.powerFactor === null && hasTelemetry(sample)){
    label = 'Waiting';
    className = 'advanced-status-dot';
  }else if(sample.powerFactor !== null && sample.powerFactor >= 0.9){
    label = 'Ideal';
    className = 'advanced-status-dot good';
  }else if(sample.powerFactor !== null && sample.powerFactor >= 0.7){
    label = 'Normal';
    className = 'advanced-status-dot ok';
  }else if(sample.powerFactor !== null){
    label = 'Low PF';
    className = 'advanced-status-dot warning';
  }

  els.pfStatus.textContent = label;
  els.pfStatus.className = className;
}

function appendSample(sample){
  state.samples.push(sample);
  state.samples = state.samples.slice(-MAX_SAMPLES);
  state.logRows.unshift(sample);
  state.logRows = state.logRows.slice(0, MAX_LOG_ROWS);

  updateCharts();
  renderLogTable();
}

function setupChartsWhenReady(){
  if(window.Chart){
    setupCharts();
    return;
  }
  window.setTimeout(setupChartsWhenReady, 80);
}

function setupCharts(){
  if(state.charts.pf || !window.Chart) return;

  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { labels: { color: getChartTextColor() } }
    },
    scales: {
      x: { ticks: { color: getChartTextColor(), maxRotation: 0 }, grid: { color: getChartGridColor() } },
      y: { ticks: { color: getChartTextColor() }, grid: { color: getChartGridColor() }, beginAtZero: true }
    }
  };

  state.charts.pf = new Chart(els.pfChart, {
    type: 'line',
    data: { labels: [], datasets: [{ label: 'Power Factor', data: [], borderColor: '#ffab00', backgroundColor: 'rgba(255,171,0,0.12)', tension: 0.25, fill: true }] },
    options: { ...baseOptions, scales: { ...baseOptions.scales, y: { ...baseOptions.scales.y, suggestedMax: 1 } } }
  });

  state.charts.frequency = new Chart(els.frequencyChart, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Frequency Hz', data: [], borderColor: '#00e5ff', backgroundColor: 'rgba(0,229,255,0.12)', tension: 0.25, fill: true },
        { label: '50 Hz reference', data: [], borderColor: 'rgba(255,255,255,0.35)', borderDash: [6, 4], pointRadius: 0, tension: 0 }
      ]
    },
    options: { ...baseOptions, scales: { ...baseOptions.scales, y: { ...baseOptions.scales.y, beginAtZero: false, suggestedMin: 49, suggestedMax: 51 } } }
  });

  state.charts.power = new Chart(els.powerAdvancedChart, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Active Power (W)', data: [], borderColor: '#ffab00', backgroundColor: 'rgba(255,171,0,0.08)', tension: 0.25 },
        { label: 'Apparent Power (VA)', data: [], borderColor: '#00e5ff', backgroundColor: 'rgba(0,229,255,0.08)', tension: 0.25 },
        { label: 'Reactive Power (VAR)', data: [], borderColor: '#00e676', backgroundColor: 'rgba(0,230,118,0.08)', tension: 0.25 }
      ]
    },
    options: baseOptions
  });

  updateCharts();
}

function updateCharts(){
  if(!state.charts.pf) return;

  const labels = state.samples.map(sample=>sample.label);
  state.charts.pf.data.labels = labels;
  state.charts.pf.data.datasets[0].data = state.samples.map(sample=>sample.powerFactor);
  state.charts.pf.update('none');

  state.charts.frequency.data.labels = labels;
  state.charts.frequency.data.datasets[0].data = state.samples.map(sample=>sample.frequency);
  state.charts.frequency.data.datasets[1].data = state.samples.map(()=>50);
  state.charts.frequency.update('none');

  state.charts.power.data.labels = labels;
  state.charts.power.data.datasets[0].data = state.samples.map(sample=>sample.activePower);
  state.charts.power.data.datasets[1].data = state.samples.map(sample=>sample.apparentPower);
  state.charts.power.data.datasets[2].data = state.samples.map(sample=>sample.reactivePower);
  state.charts.power.update('none');
}

function renderLogTable(){
  if(!els.advancedLogBody) return;

  if(state.logRows.length === 0){
    els.advancedLogBody.innerHTML = '<tr><td colspan="8" class="advanced-log-empty">Waiting for live data...</td></tr>';
    return;
  }

  els.advancedLogBody.innerHTML = state.logRows.map(sample=>`
    <tr>
      <td>${sample.label}</td>
      <td>${formatDecimal(sample.voltage, 1)}</td>
      <td>${formatDecimal(sample.current, 3)}</td>
      <td>${formatDecimal(sample.activePower, 1)}</td>
      <td>${formatDecimal(sample.apparentPower, 1)}</td>
      <td>${formatDecimal(sample.reactivePower, 1)}</td>
      <td>${formatDecimal(sample.powerFactor, 2)}</td>
      <td>${formatDecimal(sample.frequency, 2)}</td>
    </tr>
  `).join('');
}

function clearAdvancedLog(){
  state.samples = [];
  state.logRows = [];
  updateCharts();
  renderLogTable();
  showToast('Advanced log cleared');
}

function exportAdvancedLogCsv(){
  const rows = [
    ['time','voltage','current','activePower','apparentPower','reactivePower','powerFactor','frequency'],
    ...state.logRows.slice().reverse().map(sample=>[
      sample.time.toISOString(),
      sample.voltage,
      sample.current,
      sample.activePower,
      sample.apparentPower,
      sample.reactivePower,
      sample.powerFactor,
      sample.frequency
    ])
  ];

  const csv = rows.map(row=>row.map(csvEscape).join(',')).join('\n');
  downloadText(`voltix-advanced-log-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
}

function formatDecimal(value, decimals){
  const number = numberValue(value);
  return number === null ? ADV_EMPTY : number.toFixed(decimals);
}

function formatUnit(value, decimals, unit){
  const number = numberValue(value);
  return number === null ? ADV_EMPTY : `${number.toFixed(decimals)} ${unit}`;
}

function setText(id, value){
  if(els[id]) els[id].textContent = value;
}

function getChartTextColor(){
  return getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#90aeb0';
}

function getChartGridColor(){
  return getComputedStyle(document.documentElement).getPropertyValue('--chart-grid').trim() || 'rgba(255,255,255,0.08)';
}

window.addEventListener('load', ()=>init());
