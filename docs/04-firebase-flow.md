# Firebase Flow

Voltix uses Firebase Realtime Database as the online sync layer between the ESP32 and the web dashboard.

Firebase is not the durability gate for completed sessions. Every finished session must be saved locally on the ESP32 first, then synced to Firebase when possible.

## Main Principle

The ESP32 owns device telemetry and the device completed-session queue.

The authenticated web dashboard owns user history under:

```text
/users/{currentUser.uid}/history/{sessionId}
```

This keeps one ESP32 usable by multiple accounts. The ESP32 may carry the `uid` received in a web command for traceability, but it must not hardcode a private UID in firmware.

## Session Stop Flow

```text
Session stop
  -> ESP32 saves final session to LittleFS
  -> ESP32 writes final session to /devices/{deviceId}/completedSessions/{sessionId}
  -> Web dashboard reads completedSessions while authenticated
  -> Web copies the session to /users/{currentUser.uid}/history/{sessionId}
  -> Web history dashboard renders from /users/{currentUser.uid}/history
```

If Firebase write fails, the session remains safe in LittleFS as pending sync.

## Live Monitoring Flow

The ESP32 publishes live values to:

```text
/devices/{deviceId}/live/system
/devices/{deviceId}/live/device
/devices/{deviceId}/live/session
```

The web dashboard reads these paths to show current system state, sensor readings, relay status, load detection, active session progress, and overload status.

## Command Flow

The authenticated web dashboard writes a command to:

```text
/devices/{deviceId}/commands/current
```

The ESP32 reads the command, processes it, then writes the acknowledgement to:

```text
/devices/{deviceId}/commands/lastAck
```

The command should include a unique `id`, command `type`, authenticated `uid`, `sessionId`, and `createdAt` timestamp.

## Development Rules Scope

The rules in `firebase/database.rules.json` are for development and testing. They keep the contract readable, enforce required fields, allow the ESP32 development path to write device data, and ensure authenticated users can only read and write their own `/users/{uid}` branch.

These rules are not final production security rules.
