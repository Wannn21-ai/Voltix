import { db, DEVICE_ID } from './firebase-config.js';
import { get, ref, remove, set } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js';
import { logout, requireAuth } from './auth.js';
import {
  csvEscape,
  downloadText,
  formatCost,
  formatDateTime,
  formatDuration,
  formatEnergyKwh,
  formatEnergyWh,
  formatPower,
  formatSessionName,
  isOverloadSession,
  isRecoveredSession,
  isValidFirebaseKey,
  normalizeSessionMap,
  numberValue,
  qs,
  renderShell,
  safeText,
  sessionEnergyKwh,
  sessionEnergyWh,
  sessionTimestamp,
  showToast
} from './utils.js';
import { computeEnergyInsights, renderInsightElements } from './insights.js';

const els = {};
const state = {
  user: null,
  config: {},
  sessions: [],
  visibleSessions: []
};

async function init(){
  state.user = await requireAuth();
  renderShell('history', 'History', {
    user: state.user,
    onLogout: async ()=>{
      await logout();
      window.location.href = 'login.html';
    }
  });
  bindEls();

  els.refreshBtn.addEventListener('click', loadHistory);
  els.historySearch.addEventListener('input', renderFilteredHistory);
  els.historyFilter.addEventListener('change', renderFilteredHistory);
  els.historySort.addEventListener('change', renderFilteredHistory);
  els.exportCsvBtn.addEventListener('click', exportCsv);
  els.deleteAllHistoryBtn.addEventListener('click', deleteAllUserHistory);

  await loadHistory();
}

function bindEls(){
  [
    'refreshBtn','exportCsvBtn','deleteAllHistoryBtn','historySearch','historyFilter','historySort',
    'totalSessions','totalEnergyKwh','totalEnergyWh','totalCost','highestPeakPower',
    'highestPeakPowerDevice','mostEnergyDevice','mostEnergyValue','overloadCount',
    'peakWarning','overloadWarning','historyStatus','historyError','emptyState','historyList'
  ].forEach(id=>{ els[id] = qs(id); });
}

async function loadHistory(){
  setLoading(true);
  clearError();

  try{
    const configRef = ref(db, `/devices/${DEVICE_ID}/config`);
    await importCompletedSessionsToUserHistory(state.user.uid);

    const [historySnap, configSnap] = await Promise.all([
      get(ref(db, `/users/${state.user.uid}/history`)),
      get(configRef).catch(error=>{
        console.warn('[history] config unavailable for insight warnings', error);
        return null;
      })
    ]);

    state.config = configSnap?.val() || {};
    state.sessions = normalizeSessionMap(historySnap.val());
    renderSummary(state.sessions);
    renderFilteredHistory();
  }catch(error){
    console.error('[history] failed to load sessions', error);
    showError(`Failed to load history: ${error.message}`);
    state.sessions = [];
    renderSummary([]);
    renderFilteredHistory();
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

function renderSummary(sessions){
  const insights = computeEnergyInsights(sessions, state.config || {});
  renderInsightElements(els, insights, state.config.currency ?? 'IDR');
}

function renderFilteredHistory(){
  const query = els.historySearch.value.trim().toLowerCase();
  const filter = els.historyFilter.value;
  const sort = els.historySort.value;

  let sessions = [...state.sessions];
  if(query){
    sessions = sessions.filter(session=>[
      session.sessionId,
      session.deviceName,
      session.name,
      session.endReason,
      session.syncStatus
    ].some(value=>String(value ?? '').toLowerCase().includes(query)));
  }

  if(filter === 'overload'){
    sessions = sessions.filter(isOverloadSession);
  }else if(filter === 'recovered'){
    sessions = sessions.filter(isRecoveredSession);
  }else if(filter === 'pending'){
    sessions = sessions.filter(session=>String(session.syncStatus ?? '').toUpperCase() !== 'SYNCED');
  }

  sessions.sort(sorter(sort));
  state.visibleSessions = sessions;
  renderHistory(sessions);
  els.historyStatus.textContent = `${sessions.length} shown / ${state.sessions.length} total`;
}

function sorter(mode){
  return (a, b)=>{
    if(mode === 'oldest') return (sessionTimestamp(a) ?? 0) - (sessionTimestamp(b) ?? 0);
    if(mode === 'energy') return (sessionEnergyKwh(b) ?? 0) - (sessionEnergyKwh(a) ?? 0);
    if(mode === 'cost') return (numberValue(b.cost) ?? 0) - (numberValue(a.cost) ?? 0);
    if(mode === 'peak') return (numberValue(b.peakPower ?? b.power) ?? 0) - (numberValue(a.peakPower ?? a.power) ?? 0);
    return (sessionTimestamp(b) ?? 0) - (sessionTimestamp(a) ?? 0);
  };
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

  const main = document.createElement('div');
  main.className = 'history-title-main';

  const name = document.createElement('strong');
  name.textContent = formatSessionName(session.deviceName ?? session.name);
  main.appendChild(name);

  if(isOverloadSession(session)){
    main.appendChild(createBadge('OVERLOAD', 'danger'));
  }else if(String(session.endReason ?? '').trim().toUpperCase() === 'USER_STOP'){
    main.appendChild(createBadge('USER STOP', 'neutral'));
  }
  if(isRecoveredSession(session)){
    main.appendChild(createBadge('RECOVERED', 'warning'));
  }

  const meta = document.createElement('span');
  meta.textContent = formatDateTime(sessionTimestamp(session), session.date, session.time);
  title.append(main, meta);
  item.appendChild(title);

  const fields = [
    { label: 'Duration', value: formatDuration(session.duration ?? session.durationSec ?? session.elapsedSec) },
    { label: 'Energy kWh', value: formatEnergyKwh(sessionEnergyKwh(session), 8) },
    { label: 'Energy Wh', value: formatEnergyWh(sessionEnergyWh(session), 6) },
    { label: 'Cost', value: formatCost(session.cost, session.currency ?? state.config.currency ?? 'IDR', session.costText) },
    { label: 'Average power', value: formatPower(session.averagePower ?? session.power) },
    { label: 'Peak power', value: formatPower(session.peakPower ?? session.power) },
    { label: 'End reason', value: formatReason(session.endReason), danger: isOverloadSession(session) },
    { label: 'Mode', value: formatMode(session.startMode, session.endMode) },
    { label: 'Sync status', value: formatSyncStatus(session.syncStatus) },
    { label: 'Session ID', value: safeText(session.sessionId) }
  ];

  const grid = document.createElement('div');
  grid.className = 'history-fields';
  fields.forEach(field=>{
    const row = document.createElement('div');
    row.className = 'history-field';

    const label = document.createElement('span');
    label.textContent = field.label;

    const value = document.createElement('b');
    value.textContent = field.value;
    if(field.danger) value.className = 'overload-text';

    row.append(label, value);
    grid.appendChild(row);
  });
  item.appendChild(grid);

  return item;
}

function createBadge(text, type){
  const badge = document.createElement('span');
  badge.className = `badge ${type}`;
  badge.textContent = text;
  return badge;
}

function exportCsv(){
  const rows = [
    ['sessionId','deviceName','dateTime','duration','energyKwh','energyWh','cost','currency','averagePower','peakPower','endReason','syncStatus','recovered']
  ];

  state.visibleSessions.forEach(session=>{
    rows.push([
      session.sessionId,
      session.deviceName ?? session.name,
      formatDateTime(sessionTimestamp(session), session.date, session.time),
      formatDuration(session.durationSec ?? session.elapsedSec, session.duration),
      sessionEnergyKwh(session),
      sessionEnergyWh(session),
      numberValue(session.cost),
      session.currency ?? state.config.currency ?? 'IDR',
      numberValue(session.averagePower ?? session.power),
      numberValue(session.peakPower ?? session.power),
      session.endReason,
      session.syncStatus,
      isRecoveredSession(session)
    ]);
  });

  const csv = rows.map(row=>row.map(csvEscape).join(',')).join('\n');
  downloadText(`voltix-history-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
}

async function deleteAllUserHistory(){
  const answer = window.prompt('Type DELETE to clear only your user history. Device completedSessions will remain untouched.');
  if(answer !== 'DELETE') return;

  setLoading(true);
  try{
    await remove(ref(db, `/users/${state.user.uid}/history`));
    state.sessions = [];
    renderSummary([]);
    renderFilteredHistory();
    showToast('User history cleared');
  }catch(error){
    console.error('[history] delete failed', error);
    showError(`Delete failed: ${error.message}`);
  }finally{
    setLoading(false);
  }
}

function setLoading(isLoading){
  els.refreshBtn.disabled = isLoading;
  els.refreshBtn.textContent = isLoading ? 'Refreshing...' : 'Refresh';
  if(isLoading) els.historyStatus.textContent = 'Loading...';
}

function showError(message){
  els.historyError.hidden = false;
  els.historyError.textContent = message;
}

function clearError(){
  els.historyError.hidden = true;
  els.historyError.textContent = '';
}

function formatReason(reason){
  return safeText(reason).replaceAll('_', ' ');
}

function formatMode(startMode, endMode){
  const start = safeText(startMode);
  const end = safeText(endMode);
  if(start === '-' && end === '-') return '-';
  return `${start} to ${end}`;
}

function formatSyncStatus(status){
  const normalized = String(status ?? '').trim().toUpperCase();
  const labels = {
    PENDING: 'Pending sync',
    QUEUED: 'Queued',
    SYNCED: 'Synced'
  };
  return labels[normalized] ?? safeText(status);
}

window.addEventListener('load', ()=>init());
