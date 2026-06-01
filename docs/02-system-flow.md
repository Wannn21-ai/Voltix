# System Flow

Alur final Voltix v0.3:

1. ESP32 boot.
2. Firmware memuat default config, config lokal, saved WiFi dari Preferences, dan storage LittleFS.
3. ESP32 mencoba konek WiFi. Jika tidak ada saved WiFi atau koneksi gagal saat idle, captive portal dapat dijalankan.
4. Jika online, ESP32 publish live data ke Firebase.
5. User menekan START dari web dashboard.
6. Web menulis command ke `/devices/{deviceId}/commands/current`.
7. ESP32 membaca command, memvalidasi, lalu menulis acknowledgement ke `commands/lastAck`.
8. Relay ON untuk memberi daya ke load.
9. PZEM004T membaca voltage, current, power, energy, frequency, dan power factor.
10. Jika load valid terdeteksi, session masuk ke `MONITORING`.
11. Firmware menghitung duration, energy, cost, averagePower, dan peakPower selama sesi.
12. Stop bisa terjadi dari web STOP, load removal, overload, atau recovery case setelah power loss.
13. Completed session selalu disimpan dulu ke LittleFS.
14. Jika online, firmware push session ke Firebase device queue.
15. Web dashboard membaca live data, settings, completed sessions, dan history untuk menampilkan session list serta insight energi/biaya.

## Stop And Sync Flow

```text
Session stop
  -> ESP32 snapshots final session
  -> ESP32 saves session to LittleFS
  -> ESP32 queues/syncs to Firebase when online
  -> Web imports device completed session into user history
  -> Web history renders from /users/{uid}/history/{sessionId}
```

## Recovery Flow

Selama `WAITING_LOAD` atau `MONITORING`, firmware menulis checkpoint ke:

```text
/active_session.json
```

Jika ESP32 restart saat sesi aktif:

1. Boot membaca checkpoint.
2. Relay tetap aman dan hanya dinyalakan saat recovery check dibutuhkan.
3. PZEM dibaca setelah settle singkat berbasis `millis()`.
4. Jika load masih ada, session di-resume.
5. Jika load sudah hilang, session difinalisasi sebagai recovery history.
