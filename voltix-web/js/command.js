import { auth, db, DEVICE_ID } from './firebase-config.js';
import { ref, set } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js';

export async function sendStart(deviceName, config = {}){
  const user = auth.currentUser;
  if(!user) throw new Error('Not authenticated');

  const now = Date.now();
  const cmd = {
    id: `cmd_start_${now}`,
    type: 'START',
    uid: user.uid,
    sessionId: `sess_web_${now}`,
    deviceName: deviceName || 'Unnamed Load',
    tariff: config.tariff ?? 1444.7,
    overloadThreshold: config.overloadThreshold ?? 2000,
    loadPowerThreshold: config.loadPowerThreshold ?? 1,
    loadCurrentThreshold: config.loadCurrentThreshold ?? 0.02,
    createdAt: now
  };

  await set(ref(db, `/devices/${DEVICE_ID}/commands/current`), cmd);
  return cmd;
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
