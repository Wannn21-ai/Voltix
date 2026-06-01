// Firebase modular SDK (CDN)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js';

// Placeholder config values — replace in deployment with environment values
const firebaseConfig = {
  apiKey: "AIzaSyC85GXrLSOSmKzg3oSGpnhqTd7V9V0Crx0",
  authDomain: "voltix-energy-monitor.firebaseapp.com",
  databaseURL: "https://voltix-energy-monitor-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "voltix-energy-monitor",
  storageBucket: "voltix-energy-monitor.firebasestorage.app",
  messagingSenderId: "918129528377",
  appId: "1:918129528377:web:5b8c19b22f7190e55447e8"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export const DEVICE_ID = 'esp32-voltix-001';
