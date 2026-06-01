import { db, DEVICE_ID } from './firebase-config.js';
import { ref, set } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js';
import { auth } from './firebase-config.js';

export async function sendStart(deviceName, config){
  const user = auth.currentUser;
  if(!user) throw new Error('Not authenticated');

  const cmd = {
    id: 'cmd_start_' + Date.now(),
    type: 'START',
    uid: user.uid,
    sessionId: 'sess_web_' + Date.now(),
    deviceName: deviceName || 'Unnamed Load',
    tariff: (config && config.tariff) || 1444.7,
    overloadThreshold: (config && config.overloadThreshold) || 2000,
    createdAt: Date.now()
  };

  await set(ref(db, `/devices/${DEVICE_ID}/commands/current`), cmd);
  return cmd;
}

export async function sendStop(liveSessionId){
  const user = auth.currentUser;
  if(!user) throw new Error('Not authenticated');

  const cmd = {
    id: 'cmd_stop_' + Date.now(),
    type: 'STOP',
    uid: user.uid,
    sessionId: liveSessionId || null,
    reason: 'USER_STOP',
    createdAt: Date.now()
  };

  await set(ref(db, `/devices/${DEVICE_ID}/commands/current`), cmd);
  return cmd;
}
