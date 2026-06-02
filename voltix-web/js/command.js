import { auth, db, DEVICE_ID } from './firebase-config.js';
import { get, ref, set } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js';

export async function sendStart(deviceName, config = {}){
  const user = auth.currentUser;
  if(!user) throw new Error('Not authenticated');

  const now = Date.now();
  const uniqueDeviceName = await makeUniqueDeviceName(deviceName || 'Unnamed Load', user.uid);
  const cmd = {
    id: `cmd_start_${now}`,
    type: 'START',
    uid: user.uid,
    sessionId: `sess_web_${now}`,
    deviceName: uniqueDeviceName,
    tariff: config.tariff ?? 1444.7,
    overloadThreshold: config.overloadThreshold ?? 2000,
    loadPowerThreshold: config.loadPowerThreshold ?? 1,
    loadCurrentThreshold: config.loadCurrentThreshold ?? 0.02,
    createdAt: now
  };

  await set(ref(db, `/devices/${DEVICE_ID}/commands/current`), cmd);
  return cmd;
}

async function makeUniqueDeviceName(rawName, uid){
  const baseName = String(rawName ?? '').trim() || 'Unnamed Load';
  const [completedSnap, userHistorySnap] = await Promise.all([
    get(ref(db, `/devices/${DEVICE_ID}/completedSessions`)),
    get(ref(db, `/users/${uid}/history`))
  ]);

  const names = new Set();
  const sessions = mergeSessionMaps(completedSnap.val(), userHistorySnap.val());
  sessions.forEach(session=>{
    const name = String(session?.deviceName ?? session?.name ?? '').trim();
    if(name) names.add(name.toLowerCase());
  });

  const baseKey = baseName.toLowerCase();
  if(!names.has(baseKey)) return baseName;

  for(let suffix = 2; suffix < 10000; suffix++){
    const candidate = `${baseName} ${suffix}`;
    if(!names.has(candidate.toLowerCase())){
      return candidate;
    }
  }

  return `${baseName} ${Date.now()}`;
}

function mergeSessionMaps(...maps){
  const merged = new Map();
  maps.forEach(map=>{
    Object.entries(map || {}).forEach(([key, session])=>{
      const sessionId = session?.sessionId ?? key;
      if(!sessionId || merged.has(sessionId)) return;
      merged.set(sessionId, { ...(session ?? {}), sessionId });
    });
  });
  return [...merged.values()];
}

export async function sendStop(liveSessionId){
  const user = auth.currentUser;
  if(!user) throw new Error('Not authenticated');

  const now = Date.now();
  const cmd = {
    id: `cmd_stop_${now}`,
    type: 'STOP',
    uid: user.uid,
    sessionId: liveSessionId ?? null,
    reason: 'USER_STOP',
    createdAt: now
  };

  await set(ref(db, `/devices/${DEVICE_ID}/commands/current`), cmd);
  return cmd;
}
