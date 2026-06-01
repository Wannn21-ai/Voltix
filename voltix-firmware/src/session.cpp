#include "session.h"
#include "firebase_sync.h"
#include "network.h"
#include "relay.h"
#include "state.h"
#include "storage.h"
#include "time_sync.h"

#include <Arduino.h>
#include <string.h>

static void updateSessionTotals() {
  const unsigned long now = millis();

  if (sessionData.startedAtMs == 0) {
    sessionData.lastUpdateMs = now;
    return;
  }

  if (sessionData.lastUpdateMs > 0 && now > sessionData.lastUpdateMs) {
    const unsigned long elapsedMs = now - sessionData.lastUpdateMs;
    if (sensorData.valid && sensorData.power > 0.0f) {
      sessionData.energyWh += sensorData.power * (static_cast<float>(elapsedMs) / 3600000.0f);
    }
  }

  sessionData.durationMs = now - sessionData.startedAtMs;
  sessionData.energyKwh = sessionData.energyWh / 1000.0f;
  if (sensorData.power > sessionData.peakPowerW) {
    sessionData.peakPowerW = sensorData.power;
  }

  sessionData.cost = sessionData.energyKwh * appConfig.tariffPerKwh;
  const float durationHours = static_cast<float>(sessionData.durationMs) / 3600000.0f;
  sessionData.averagePowerW = durationHours > 0.0f ? sessionData.energyWh / durationHours : 0.0f;
  sessionData.lastUpdateMs = now;
}

static void makeSessionId(char* out, size_t outSize, unsigned long startedAtMs) {
  const unsigned long seed = startedAtMs > 0 ? startedAtMs : millis();
  snprintf(out, outSize, "sess_%lu", seed);
}

static CompletedSessionSnapshot makeFinalSnapshot(EndReason reason) {
  CompletedSessionSnapshot snapshot;
  memset(&snapshot, 0, sizeof(snapshot));

  strlcpy(snapshot.id, sessionData.sessionId, sizeof(snapshot.id));
  strlcpy(snapshot.sessionId, sessionData.sessionId, sizeof(snapshot.sessionId));
  strlcpy(snapshot.uid, sessionData.uid, sizeof(snapshot.uid));
  strlcpy(snapshot.deviceName, sessionData.deviceName, sizeof(snapshot.deviceName));
  snapshot.startMillis = sessionData.startedAtMs;
  snapshot.stopMillis = sessionData.endedAtMs;
  snapshot.durationSec = sessionData.durationMs / 1000UL;
  snapshot.energyWh = sessionData.energyWh;
  snapshot.energyKwh = sessionData.energyKwh;
  snapshot.cost = sessionData.cost;
  snapshot.averagePower = sessionData.averagePowerW;
  snapshot.peakPower = sessionData.peakPowerW;
  snapshot.voltage = sensorData.voltage;
  snapshot.current = sensorData.current;
  snapshot.frequency = sensorData.frequency;
  snapshot.powerFactor = sensorData.powerFactor;
  snapshot.tariff = appConfig.tariffPerKwh;
  snapshot.currency = appConfig.currency;
  snapshot.endReason = reason;
  snapshot.startMode = sessionData.startMode;
  snapshot.endMode = systemMode;
  strlcpy(snapshot.date, getDateString().c_str(), sizeof(snapshot.date));
  strlcpy(snapshot.time, getTimeString().c_str(), sizeof(snapshot.time));
  snapshot.timestamp = getUnixMs();
  return snapshot;
}

void sessionBegin() {
  sessionData.state = SessionState::IDLE;
  sessionData.endReason = EndReason::NONE;
  Serial.println("[session] Ready");
}

void sessionStart(const char* deviceName) {
  if (sessionIsActive()) {
    return;
  }

  const char* name = deviceName == nullptr ? appConfig.deviceName : deviceName;
  strlcpy(sessionData.deviceName, name, sizeof(sessionData.deviceName));
  sessionData.state = SessionState::WAITING_LOAD;
  sessionData.endReason = EndReason::NONE;
  sessionData.startedAtMs = millis();
  makeSessionId(sessionData.sessionId, sizeof(sessionData.sessionId), sessionData.startedAtMs);
  sessionData.uid[0] = '\0';
  sessionData.startMode = systemMode;
  sessionData.endedAtMs = 0;
  sessionData.lastUpdateMs = sessionData.startedAtMs;
  sessionData.durationMs = 0;
  sessionData.startEnergyKwh = sensorData.energy;
  sessionData.energyWh = 0.0f;
  sessionData.energyKwh = 0.0f;
  sessionData.cost = 0.0f;
  sessionData.averagePowerW = 0.0f;
  sessionData.peakPowerW = 0.0f;
  sessionData.pendingSync = false;

  relaySet(true);
  Serial.print("[session] Started for device ");
  Serial.println(sessionData.deviceName);
}

void sessionSetRemoteContext(const char* uid, const char* sessionId) {
  if (uid != nullptr) {
    strlcpy(sessionData.uid, uid, sizeof(sessionData.uid));
  }
  if (sessionId != nullptr && sessionId[0] != '\0') {
    strlcpy(sessionData.sessionId, sessionId, sizeof(sessionData.sessionId));
  }
}

void sessionStop(EndReason reason) {
  if (!sessionIsActive()) {
    return;
  }

  updateSessionTotals();
  sessionData.endedAtMs = millis();
  sessionData.durationMs = sessionData.endedAtMs - sessionData.startedAtMs;
  sessionData.endReason = reason;
  sessionData.state = SessionState::FINISHING;
  const CompletedSessionSnapshot snapshot = makeFinalSnapshot(reason);
  relaySet(false);

  Serial.print("[session] Finishing, reason=");
  Serial.println(endReasonToString(reason));

  const bool saved = storageAppendCompletedSession(snapshot);
  bool queued = false;
  sessionData.pendingSync = saved;

  if (saved) {
    if (networkIsConnected()) {
      queued = firebasePushCompletedSession(snapshot);
      if (queued) {
        storageMarkSessionQueued(snapshot.sessionId);
        sessionData.pendingSync = false;
      }
    } else {
      Serial.println("[session] WiFi offline, final session saved as pending sync");
    }
  } else {
    Serial.println("[session] Local save failed, session remains unsynced");
  }

  Serial.print("[session] Final snapshot durationSec=");
  Serial.print(snapshot.durationSec);
  Serial.print(" energyWh=");
  Serial.print(snapshot.energyWh, 6);
  Serial.print(" energy_kWh=");
  Serial.print(snapshot.energyKwh, 8);
  Serial.print(" cost=");
  Serial.print(snapshot.cost, 4);
  Serial.print(" peakPower=");
  Serial.print(snapshot.peakPower, 2);
  Serial.print(" date=");
  Serial.print(snapshot.date);
  Serial.print(" time=");
  Serial.print(snapshot.time);
  Serial.print(" timestamp=");
  char timestampText[24];
  snprintf(timestampText, sizeof(timestampText), "%llu", snapshot.timestamp);
  Serial.println(timestampText);
  Serial.print("[session] Final time date=");
  Serial.print(snapshot.date);
  Serial.print(" time=");
  Serial.print(snapshot.time);
  Serial.print(" timestamp=");
  Serial.println(timestampText);

  sessionData.state = SessionState::FINISHED;
  Serial.print("[session] Finished name=");
  Serial.print(sessionData.deviceName);
  Serial.print(" durationSec=");
  Serial.print(sessionData.durationMs / 1000UL);
  Serial.print(" energy_kWh=");
  Serial.print(sessionData.energyKwh, 8);
  Serial.print(" cost=");
  Serial.print(sessionData.cost, 4);
  Serial.print(" ");
  Serial.print(appConfig.currency);
  Serial.print(" peakPower=");
  Serial.print(sessionData.peakPowerW, 2);
  Serial.print("W endReason=");
  Serial.print(endReasonToString(reason));
  Serial.print(" saved=");
  Serial.print(saved ? "OK" : "FAIL");
  Serial.print(" firebase=");
  Serial.println(queued ? "QUEUED" : "PENDING");
}

void sessionUpdate() {
  if (!sessionIsActive()) {
    return;
  }

  updateSessionTotals();

  if (sensorData.valid && sensorData.power >= appConfig.overloadThresholdW) {
    sessionData.state = SessionState::OVERLOAD;
    sessionStop(EndReason::OVERLOAD);
    return;
  }

  if (sessionData.state == SessionState::WAITING_LOAD && sensorData.loadDetected) {
    sessionData.state = SessionState::MONITORING;
    Serial.println("[session] Load detected, monitoring");
  }

  if (sessionData.state == SessionState::MONITORING && !sensorData.loadDetected) {
    sessionStop(EndReason::LOAD_REMOVED);
    return;
  }

}

bool sessionIsActive() {
  return sessionData.state == SessionState::WAITING_LOAD ||
         sessionData.state == SessionState::MONITORING ||
         sessionData.state == SessionState::OVERLOAD ||
         sessionData.state == SessionState::FINISHING;
}
