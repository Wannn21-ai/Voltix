# Firebase Flow

Firebase Realtime Database adalah bridge antara web dashboard dan ESP32. Firebase dipakai untuk command, live telemetry, config, dan cloud sync. Firebase bukan durability gate untuk completed session; LittleFS tetap local source of truth.

## Main Paths

```text
/devices/{deviceId}/config
/devices/{deviceId}/live
/devices/{deviceId}/commands/current
/devices/{deviceId}/commands/lastAck
/devices/{deviceId}/completedSessions/{sessionId}
/users/{uid}/settings
/users/{uid}/history/{sessionId}
```

## Command Flow

1. Web dashboard menulis START/STOP/settings command ke `/devices/{deviceId}/commands/current`.
2. ESP32 membaca command.
3. ESP32 menjalankan aksi: relay, session, config, atau acknowledgement.
4. ESP32 menulis status command ke `/devices/{deviceId}/commands/lastAck`.
5. ESP32 menghapus/menandai command agar tidak diproses ulang.

Web menulis command, tetapi tidak menulis langsung ke device live state.

## Live Flow

ESP32 menulis live telemetry ke:

```text
/devices/{deviceId}/live/system
/devices/{deviceId}/live/device
/devices/{deviceId}/live/session
```

Web membaca path tersebut untuk menampilkan mode, relay state, sensor values, load detection, active session, elapsed time, energy, cost, dan overload status.

Web tidak boleh menulis ke `/devices/{deviceId}/live`; path live adalah output dari ESP32.

## Config Flow

- Web settings dapat mengubah tariff dan overload threshold melalui Firebase.
- ESP32 membaca `/devices/{deviceId}/config`.
- Captive portal juga dapat menyimpan basic local config untuk startup/offline use.
- Firmware memakai config terakhir yang tersedia saat offline.

## Completed Session Flow

```text
Session finished
  -> ESP32 saves final snapshot to LittleFS
  -> ESP32 writes to /devices/{deviceId}/completedSessions/{sessionId}
  -> Authenticated web imports it into /users/{uid}/history/{sessionId}
  -> Web history renders from /users/{uid}/history
```

Jika Firebase gagal, session tetap aman di LittleFS dan ditandai pending sync sampai koneksi kembali.

## Multi Account Rule

Satu ESP32 bisa dipakai banyak akun. Karena itu:

- ESP32 tidak boleh hardcode user UID.
- Web yang sedang login bertanggung jawab menyalin completed session ke `/users/{uid}/history/{sessionId}`.
- `sessionId` dipakai sebagai identity untuk mencegah duplicate history.
