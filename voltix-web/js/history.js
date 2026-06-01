import { db, DEVICE_ID } from './firebase-config.js';
import { ref, get, set } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js';
import { requireAuth } from './auth.js';
import {
  computeEnergyInsights,
  energyKwhValue,
  energyWhValue,
  formatCost,
  formatEnergyKwh,
  formatEnergyWh,
  formatPower,
  formatSessionName,
  isOverloadSession,
  normalizeCompletedSessions,
  renderInsightElements
} from './insights.js';

const els = {};
const MIN_UNIX_MS = 946684800000;

function $(id){ return document.getElementById(id); }

async function init(){
  const user = await requireAuth();
  bindEls();
  els.refreshBtn.addEventListener('click', ()=>loadHistory(user));
  loadHistory(user);
}

function bindEls(){
  [
    'refreshBtn','totalSessions','totalEnergyKwh','totalEnergyWh','totalCost',
    'highestPeakPower','highestPeakPowerDevice','mostEnergyDevice','mostEnergyValue',
    'overloadCount','peakWarning','overloadWarning',
    'historyStatus','historyError','emptyState','historyList'
  ].forEach(id=>els[id] = $(id));
}

async function loadHistory(user){
  setLoading(true);
  clearError();

  try{
    const configRef = ref(db, `/devices/${DEVICE_ID}/config`);
    await importCompletedSessionsToUserHistory(user.uid);

    const userHistoryRef = ref(db, `/users/${user.uid}/history`);
    const [historySnap, configSnap] = await Promise.all([
      get(userHistoryRef),
      get(configRef).catch(error=>{
        console.warn('[history] config unavailable for insight warnings', error);
        return null;
      })
    ]);
    const sessions = normalizeCompletedSessions(historySnap.val());
    console.log('[history] user history loaded', sessions.length);
    renderSummary(sessions, configSnap?.val() || {});
    renderHistory(sessions);
    els.historyStatus.textContent = sessions.length ? `${sessions.length} sessions` : 'No sessions';
  }catch(error){
    console.error('[history] failed to load sessions', error);
    showError(`Failed to load history: ${error.message}`);
    renderSummary([], {});
    renderHistory([]);
    els.historyStatus.textContent = 'Error';
  }finally{
    setLoading(false);
  }
}

async function importCompletedSessionsToUserHistory(uid){
  const completedPath = `/devices/${DEVICE_ID}/completedSessions`;
  const userHistoryPath = `/users/${uid}/history`;
  const [completedSnap, userHistorySnap] = await Promise.all([
    get(ref(db, completedPath)),
    get(ref(db, userHistoryPath))
  ]);

  const completedSessions = completedSnap.val() || {};
  const existingHistory = userHistorySnap.val() || {};
  const entries = Object.entries(completedSessions);
  console.log('[history] importing completed sessions', entries.length);

  for(const [key, session] of entries){
    const sessionId = session?.sessionId ?? key;
    if(!isValidFirebaseKey(sessionId)){
      console.warn('[history] skipped invalid sessionId', sessionId);
      continue;
    }

    if(existingHistory[sessionId] !== undefined){
      continue;
    }

    const copiedSession = {
      ...(session ?? {}),
      sessionId,
      ownerUid: uid,
      copiedAt: Date.now(),
      sourcePath: `${completedPath}/${sessionId}`,
      syncStatus: 'SYNCED'
    };

    await set(ref(db, `${userHistoryPath}/${sessionId}`), copiedSession);
    existingHistory[sessionId] = copiedSession;
    console.log('[history] copied session', sessionId);
  }
}

function isValidFirebaseKey(value){
  if(value === null || value === undefined) return false;
  return !/[.#$\[\]\/]/.test(String(value));
}

function renderSummary(sessions, config){
  renderInsightElements(els, computeEnergyInsights(sessions, config));
}

function renderHistory(sessions){
  els.historyList.innerHTML = '';
  els.emptyState.hidden = sessions.length !== 0;

  const fragment = document.createDocumentFragment();
  sessions.forEach(session=>fragment.appendChild(createHistoryItem(session)));
  els.historyList.appendChild(fragment);
}

function createHistoryItem(session){
  const item = document.createElement('article');
  item.className = 'history-item';

  const title = document.createElement('div');
  title.className = 'history-title';

  const titleMain = document.createElement('div');
  titleMain.className = 'history-title-main';

  const name = document.createElement('strong');
  name.textContent = formatSessionName(session.name ?? session.deviceName);
  titleMain.appendChild(name);

  if(isOverloadSession(session)){
    const badge = document.createElement('span');
    badge.className = 'overload-badge';
    badge.textContent = 'OVERLOAD';
    titleMain.appendChild(badge);
  }

  const meta = document.createElement('span');
  meta.textContent = formatSessionDateTime(session);

  title.append(titleMain, meta);
  item.appendChild(title);

  const fields = [
    { label: 'Duration', value: formatDuration(session.duration, session.durationSec) },
    { label: 'Energy kWh', value: formatEnergyKwh(energyKwhValue(session)) },
    { label: 'Energy Wh', value: formatEnergyWh(energyWhValue(session)) },
    { label: 'Cost', value: formatCost(session.cost, session.costText) },
    { label: 'Average power', value: formatPower(session.averagePower ?? session.power) },
    { label: 'Peak power', value: formatPower(session.peakPower ?? session.power) },
    { label: 'End reason', value: formatEndReason(session.endReason), danger: isOverloadSession(session) },
    { label: 'Mode', value: formatMode(session.startMode, session.endMode) },
    { label: 'Sync status', value: formatSyncStatus(session.syncStatus) }
  ];

  const grid = document.createElement('div');
  grid.className = 'history-fields';
  fields.forEach(field=>{
    const row = document.createElement('div');
    row.className = 'history-field';

    const labelEl = document.createElement('span');
    labelEl.textContent = field.label;

    const valueEl = document.createElement('b');
    valueEl.textContent = field.value;
    if(field.danger){
      valueEl.className = 'overload-text';
    }

    row.append(labelEl, valueEl);
    grid.appendChild(row);
  });

  item.appendChild(grid);
  return item;
}

function setLoading(isLoading){
  els.refreshBtn.disabled = isLoading;
  els.refreshBtn.textContent = isLoading ? 'Refreshing...' : 'Refresh';
  if(isLoading){
    els.historyStatus.textContent = 'Loading...';
  }
}

function showError(message){
  els.historyError.hidden = false;
  els.historyError.textContent = message;
}

function clearError(){
  els.historyError.hidden = true;
  els.historyError.textContent = '';
}

function formatDuration(duration, durationSec){
  if(duration !== null && duration !== undefined && duration !== '') return String(duration);
  if(durationSec === null || durationSec === undefined) return '-';
  const number = Number(durationSec);
  if(Number.isNaN(number)) return '-';
  return `${Math.trunc(number)} s`;
}

function formatEndReason(reason){
  if(reason === null || reason === undefined || reason === '') return '-';
  return String(reason).replaceAll('_', ' ');
}

function formatSyncStatus(status){
  if(status === null || status === undefined || status === '') return '-';
  const normalized = String(status).trim().toUpperCase();
  const labels = {
    PENDING: 'Menunggu sinkronisasi',
    QUEUED: 'Terkirim ke Firebase',
    SYNCED: 'Tersinkron'
  };
  return labels[normalized] ?? String(status);
}

function formatMode(startMode, endMode){
  const start = startMode ?? '-';
  const end = endMode ?? '-';
  if(start === '-' && end === '-') return '-';
  return `${start} to ${end}`;
}

function formatSessionDateTime(session){
  const date = cleanDatePart(session.date);
  const time = cleanDatePart(session.time);

  if(date !== null && time !== null) return `${date} ${time}`;
  if(date !== null) return date;
  const timestampText = formatTimestamp(session.timestamp);
  if(timestampText !== '-') return timestampText;
  return time ?? '-';
}

function cleanDatePart(value){
  if(value === null || value === undefined) return null;
  const text = String(value).trim();
  if(text === '' || text === '-') return null;
  return text;
}

function formatTimestamp(timestamp){
  if(timestamp === null || timestamp === undefined) return '-';
  const value = Number(timestamp);
  if(Number.isNaN(value) || value < MIN_UNIX_MS) return '-';

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
    }).format(new Date(value));
  }catch(error){
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('id-ID');
  }
}

window.addEventListener('load', ()=>init());
