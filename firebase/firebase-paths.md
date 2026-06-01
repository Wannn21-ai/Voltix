# Firebase Paths

This document defines the Firebase Realtime Database contract for Voltix.

Development device id:

```text
esp32-voltix-001
```

## Device Paths

| Path | Owner | Purpose |
| --- | --- | --- |
| `/devices/{deviceId}/config` | Web / setup tooling | Device runtime configuration read by the ESP32. |
| `/devices/{deviceId}/live/system` | ESP32 | Online status, relay status, system mode, session state, and pending sync count. |
| `/devices/{deviceId}/live/device` | ESP32 | Latest electrical measurements and load flags. |
| `/devices/{deviceId}/live/session` | ESP32 | Current session summary while a session is active or ending. |
| `/devices/{deviceId}/commands/current` | Web | Latest command requested by the authenticated user. |
| `/devices/{deviceId}/commands/lastAck` | ESP32 | Last command acknowledgement from the device. |
| `/devices/{deviceId}/completedSessions/{sessionId}` | ESP32 | Final session queue written after local LittleFS save. |

## User Paths

| Path | Owner | Purpose |
| --- | --- | --- |
| `/users/{uid}/settings` | Authenticated web user | Per-user dashboard settings. |
| `/users/{uid}/history/{sessionId}` | Authenticated web user | User-owned history copied from the device completed session queue. |

## Command: START

```json
{
  "id": "cmd_xxx",
  "type": "START",
  "uid": "firebase-auth-uid",
  "sessionId": "sess_xxx",
  "deviceName": "Kipas",
  "tariff": 1444.7,
  "overloadThreshold": 2000,
  "createdAt": 1710000000000
}
```

## Command: STOP

```json
{
  "id": "cmd_xxx",
  "type": "STOP",
  "uid": "firebase-auth-uid",
  "sessionId": "sess_xxx",
  "reason": "USER_STOP",
  "createdAt": 1710000000000
}
```

## Command Ack

```json
{
  "id": "cmd_xxx",
  "type": "START",
  "status": "DONE",
  "message": "Command processed",
  "processedAt": 1710000000000
}
```

## Completed Session

Completed sessions are first saved by the ESP32 to LittleFS, then queued at:

```text
/devices/{deviceId}/completedSessions/{sessionId}
```

The web dashboard reads that queue while authenticated and copies the entry into:

```text
/users/{uid}/history/{sessionId}
```

The ESP32 must not hardcode a private user UID. The final user history UID follows the account currently logged in on the web dashboard.

```json
{
  "id": "sess_xxx",
  "sessionId": "sess_xxx",
  "deviceId": "esp32-voltix-001",
  "uid": "firebase-auth-uid",
  "name": "Kipas",
  "duration": "00:10:05",
  "durationSec": 605,
  "power": 35.5,
  "energy": 0.006,
  "cost": 8.67,
  "costText": "Rp 9",
  "voltage": 220.1,
  "current": 0.16,
  "frequency": 50.0,
  "powerFactor": 0.90,
  "tariff": 1444.7,
  "currency": "IDR",
  "overload": false,
  "overloadThreshold": 2000,
  "startMode": "ONLINE",
  "endMode": "ONLINE",
  "endReason": "USER_STOP",
  "date": "2026-05-30",
  "timestamp": 1710000000000,
  "syncStatus": "PENDING",
  "createdFrom": "ESP32"
}
```
