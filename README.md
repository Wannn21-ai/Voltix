# Voltix - IoT Per-Load Energy Monitoring System

Voltix membantu user mengukur konsumsi listrik per beban/perangkat, menghitung durasi pemakaian, energi terpakai, estimasi biaya, mendeteksi risiko overload, dan melihat hasilnya melalui web dashboard.

## Main Features

- ESP32-based energy monitoring
- PZEM004T voltage/current/power reading
- Relay control
- Web dashboard START/STOP
- Firebase Realtime Database communication
- Live monitoring
- Settings from web
- Completed session history
- Energy/cost insights
- Overload protection
- OLED monitoring display
- Captive portal WiFi setup
- Offline monitoring
- Auto reconnect
- Pending sync
- Power-loss/session recovery
- NTP date/time

## Project Structure

```text
voltix-firmware/  ESP32 PlatformIO Arduino firmware
voltix-web/       Static web dashboard
firebase/         Firebase RTDB schema, rules, and path docs
docs/             Project documentation
scripts/          Deployment/helper scripts
```

## Tech Stack

### Firmware

- ESP32
- Arduino framework
- PlatformIO
- PZEM004T
- SSD1306 OLED
- LittleFS
- Preferences
- Firebase REST

### Web

- HTML
- CSS
- JavaScript
- Firebase Web SDK
- Firebase Auth
- Firebase Realtime Database
- Vercel-ready static web

## Firebase Paths

```text
/devices/{deviceId}/config
/devices/{deviceId}/live
/devices/{deviceId}/commands/current
/devices/{deviceId}/commands/lastAck
/devices/{deviceId}/completedSessions/{sessionId}
/users/{uid}/settings
/users/{uid}/history/{sessionId}
```

## Version History

- `v0.1-mvp`: core firmware, Firebase, web dashboard, history, settings, overload.
- `v0.2-captive-portal`: WiFi setup portal and BOOT reset WiFi.
- `v0.3-power-loss-recovery`: checkpoint, session resume, offline/reconnect stabilization.

## Safe Setup Notes

- Do not commit `credentials.h`.
- Use `voltix-firmware/include/credentials.h.example` as the template.
- `credentials.h` is ignored by Git.
- Firebase secrets or service-account credentials must not be used in frontend code.
- The web app should use Firebase Web SDK config only; keep private server/admin credentials out of the repository.

## Quick Local Development

- Open `voltix-firmware` with PlatformIO.
- Open `voltix-web` with Live Server or a localhost static server.
- Do not open the web dashboard directly with `file://`; Firebase Auth and browser module behavior should be tested through `http://localhost/...`.
