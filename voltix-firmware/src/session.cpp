#include "session.h"
#include "config.h"
#include "firebase_sync.h"
#include "network.h"
#include "relay.h"
#include "sensor.h"
#include "state.h"
#include "storage.h"
#include "time_sync.h"

#include <Arduino.h>
#include <Preferences.h>
#include <string.h>

namespace {
constexpr unsigned long RECOVERY_SETTLE_MS = 1200UL;
constexpr unsigned long OFFLINE_FINISHED_SUMMARY_MS = 4000UL;
constexpr const char* PREF_NAMESPACE = "voltix";
constexpr const char* PREF_OFFLINE_DEVICE_COUNTER = "offline_device_counter";
constexpr const char* OFFLINE_SESSION_TAG = "Sesi Offline";

enum class RecoveryState {
  IDLE,
  SETTLING,
  RESUMED,
  FINALIZED,
  FAILED
};

ActiveSessionCheckpoint recoveryCheckpoint;
RecoveryState recoveryState = RecoveryState::IDLE;
unsigned long recoveryStartedAtMs = 0;
unsigned long lastCheckpointWriteMs = 0;
unsigned long elapsedBeforeRecoveryMs = 0;
unsigned long resumeMillis = 0;
unsigned long loadValidationStartedAtMs = 0;
unsigned int loadValidationStableSamples = 0;
bool loadValidationWaitingLogged = false;
StartValidationResult startValidationResult = StartValidationResult::NONE;
char recoveryStatusText[48] = "idle";
bool offlineModeActive = false;
bool offlineNoLoadPrompt = false;
bool offlineReadyLogged = false;
unsigned long offlineFinishedAtMs = 0;
}

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

  if (resumeMillis > 0) {
    sessionData.durationMs = elapsedBeforeRecoveryMs + (now - resumeMillis);
  } else {
    sessionData.durationMs = now - sessionData.startedAtMs;
  }
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

static unsigned long loadOfflineDeviceCounter() {
  Preferences prefs;
  if (!prefs.begin(PREF_NAMESPACE, true)) {
    return 1UL;
  }

  const unsigned long counter = prefs.getULong(PREF_OFFLINE_DEVICE_COUNTER, 1UL);
  prefs.end();
  return counter == 0 ? 1UL : counter;
}

static bool saveOfflineDeviceCounter(unsigned long nextCounter) {
  Preferences prefs;
  if (!prefs.begin(PREF_NAMESPACE, false)) {
    Serial.println("[offline] Failed to open Preferences for offline device counter");
    return false;
  }

  prefs.putULong(PREF_OFFLINE_DEVICE_COUNTER, nextCounter);
  prefs.end();
  Serial.print("[offline] Offline device counter saved next=");
  Serial.println(nextCounter);
  return true;
}

static void assignOfflineDeviceNameIfNeeded() {
  if (!offlineModeActive || sessionData.deviceName[0] != '\0') {
    return;
  }

  const unsigned long counter = loadOfflineDeviceCounter();
  snprintf(sessionData.deviceName, sizeof(sessionData.deviceName), "Device %lu", counter);
  Serial.print("[offline] Assigned offline device name=");
  Serial.println(sessionData.deviceName);
  saveOfflineDeviceCounter(counter + 1UL);
}

static CompletedSessionSnapshot makeFinalSnapshot(EndReason reason) {
  CompletedSessionSnapshot snapshot;
  memset(&snapshot, 0, sizeof(snapshot));

  strlcpy(snapshot.id, sessionData.sessionId, sizeof(snapshot.id));
  strlcpy(snapshot.sessionId, sessionData.sessionId, sizeof(snapshot.sessionId));
  strlcpy(snapshot.uid, sessionData.uid, sizeof(snapshot.uid));
  strlcpy(snapshot.deviceName, sessionData.deviceName, sizeof(snapshot.deviceName));
  snapshot.offlineSession = sessionData.startMode == SystemMode::OFFLINE;
  snapshot.sessionTag = snapshot.offlineSession ? OFFLINE_SESSION_TAG : "";
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
  snapshot.recovered = false;
  snapshot.recoverySource = nullptr;
  return snapshot;
}

static bool shouldCheckpointState() {
  return sessionData.state == SessionState::MONITORING ||
         sessionData.state == SessionState::OVERLOAD;
}

static void fillCheckpointFromSession(ActiveSessionCheckpoint& checkpoint) {
  memset(&checkpoint, 0, sizeof(checkpoint));
  strlcpy(checkpoint.sessionId, sessionData.sessionId, sizeof(checkpoint.sessionId));
  strlcpy(checkpoint.uid, sessionData.uid, sizeof(checkpoint.uid));
  strlcpy(checkpoint.deviceName, sessionData.deviceName, sizeof(checkpoint.deviceName));
  checkpoint.active = shouldCheckpointState();
  checkpoint.sessionState = sessionData.state;
  checkpoint.startMillis = sessionData.startedAtMs;
  checkpoint.elapsedSec = sessionData.durationMs / 1000UL;
  checkpoint.energyWh = sessionData.energyWh;
  checkpoint.energyKwh = sessionData.energyKwh;
  checkpoint.cost = sessionData.cost;
  checkpoint.peakPower = sessionData.peakPowerW;
  checkpoint.averagePower = sessionData.averagePowerW;
  checkpoint.tariff = appConfig.tariffPerKwh;
  strlcpy(checkpoint.currency, appConfig.currency, sizeof(checkpoint.currency));
  checkpoint.overloadThreshold = appConfig.overloadThresholdW;
  checkpoint.startMode = sessionData.startMode;
  checkpoint.startUnixMs = getUnixMs() > sessionData.durationMs ? getUnixMs() - sessionData.durationMs : 0;
  checkpoint.lastCheckpointMs = millis();
  checkpoint.relayState = relayIsOn();
  strlcpy(checkpoint.createdFrom, "ESP32", sizeof(checkpoint.createdFrom));
}

static void restoreSessionFromCheckpoint(const ActiveSessionCheckpoint& checkpoint, SessionState state) {
  strlcpy(sessionData.sessionId, checkpoint.sessionId, sizeof(sessionData.sessionId));
  strlcpy(sessionData.uid, checkpoint.uid, sizeof(sessionData.uid));
  strlcpy(sessionData.deviceName, checkpoint.deviceName, sizeof(sessionData.deviceName));
  sessionData.state = state;
  sessionData.endReason = EndReason::NONE;
  sessionData.startedAtMs = checkpoint.startMillis > 0 ? checkpoint.startMillis : millis();
  sessionData.endedAtMs = 0;
  sessionData.lastUpdateMs = millis();
  elapsedBeforeRecoveryMs = checkpoint.elapsedSec * 1000UL;
  resumeMillis = millis();
  sessionData.durationMs = elapsedBeforeRecoveryMs;
  sessionData.startEnergyKwh = sensorData.energy;
  sessionData.energyWh = checkpoint.energyWh;
  sessionData.energyKwh = checkpoint.energyKwh > 0.0f ? checkpoint.energyKwh : checkpoint.energyWh / 1000.0f;
  sessionData.cost = checkpoint.cost;
  sessionData.averagePowerW = checkpoint.averagePower;
  sessionData.peakPowerW = checkpoint.peakPower;
  sessionData.pendingSync = false;
  sessionData.startMode = checkpoint.startMode;

  if (checkpoint.tariff > 0.0f) {
    appConfig.tariffPerKwh = checkpoint.tariff;
  }
  if (checkpoint.overloadThreshold > 0.0f) {
    appConfig.overloadThresholdW = checkpoint.overloadThreshold;
  }
  if (checkpoint.currency[0] != '\0') {
    strlcpy(appConfig.currency, checkpoint.currency, sizeof(appConfig.currency));
  }
}

static CompletedSessionSnapshot makeRecoveredSnapshot(const ActiveSessionCheckpoint& checkpoint, EndReason reason) {
  restoreSessionFromCheckpoint(checkpoint, SessionState::MONITORING);
  sessionData.endedAtMs = millis();
  sessionData.endReason = reason;
  sessionData.durationMs = checkpoint.elapsedSec * 1000UL;
  sessionData.cost = sessionData.energyKwh * appConfig.tariffPerKwh;

  CompletedSessionSnapshot snapshot = makeFinalSnapshot(reason);
  snapshot.durationSec = checkpoint.elapsedSec;
  snapshot.recovered = true;
  snapshot.recoverySource = "active_session_checkpoint";
  return snapshot;
}

static void finalizeRecoveredNoLoad() {
  const CompletedSessionSnapshot snapshot = makeRecoveredSnapshot(recoveryCheckpoint, EndReason::LOAD_REMOVED_AFTER_POWER_LOSS);
  sessionData.state = SessionState::FINISHING;
  relaySet(false);

  const bool saved = storageAppendCompletedSession(snapshot);
  bool queued = false;
  sessionData.pendingSync = saved;

  if (saved) {
    storageClearActiveSessionCheckpoint();
    if (networkIsConnected()) {
      queued = firebasePushCompletedSession(snapshot);
      if (queued) {
        storageMarkSessionQueued(snapshot.sessionId);
        sessionData.pendingSync = false;
      }
    } else {
      Serial.println("[recovery] WiFi offline, recovered session saved as pending sync");
    }
  }

  sessionData.state = SessionState::FINISHED;
  recoveryState = saved ? RecoveryState::FINALIZED : RecoveryState::FAILED;
  strlcpy(recoveryStatusText, saved ? "finalized_no_load" : "finalize_failed", sizeof(recoveryStatusText));
  Serial.println("[recovery] no load found, session finalized");
}

static bool isLoadAboveStartThreshold() {
  return sensorData.valid &&
         sensorData.current >= appConfig.loadCurrentThresholdA &&
         sensorData.power >= appConfig.loadPowerThresholdW;
}

static void resetLoadValidationState() {
  loadValidationStartedAtMs = 0;
  loadValidationStableSamples = 0;
  loadValidationWaitingLogged = false;
}

static unsigned long currentLoadValidationTimeoutMs() {
  return offlineModeActive ? Config::OFFLINE_LOAD_DETECT_TIMEOUT_MS : Config::LOAD_DETECT_TIMEOUT_MS;
}

static void verifyLoadAndStartMonitoring() {
  const unsigned long now = millis();
  assignOfflineDeviceNameIfNeeded();
  sessionData.state = SessionState::MONITORING;
  sessionData.endReason = EndReason::NONE;
  sessionData.startedAtMs = now;
  sessionData.endedAtMs = 0;
  sessionData.lastUpdateMs = now;
  sessionData.durationMs = 0;
  sessionData.startEnergyKwh = sensorData.energy;
  sessionData.energyWh = 0.0f;
  sessionData.energyKwh = 0.0f;
  sessionData.cost = 0.0f;
  sessionData.averagePowerW = 0.0f;
  sessionData.peakPowerW = sensorData.power > 0.0f ? sensorData.power : 0.0f;
  sessionData.pendingSync = false;
  resetLoadValidationState();
  startValidationResult = StartValidationResult::VERIFIED;
  Serial.println("[LoadCheck] Load verified");
  if (offlineModeActive) {
    offlineNoLoadPrompt = false;
    offlineReadyLogged = false;
    Serial.println("[offline] Load detected, offline monitoring started");
  }
  sessionWriteCheckpoint();
}

static void cancelLoadValidationNoHistory() {
  relaySet(false);
  sessionData.endReason = EndReason::NO_LOAD_DETECTED;
  sessionData.state = SessionState::IDLE;
  sessionData.startedAtMs = 0;
  sessionData.endedAtMs = 0;
  sessionData.lastUpdateMs = 0;
  sessionData.durationMs = 0;
  sessionData.startEnergyKwh = sensorData.energy;
  sessionData.energyWh = 0.0f;
  sessionData.energyKwh = 0.0f;
  sessionData.cost = 0.0f;
  sessionData.averagePowerW = 0.0f;
  sessionData.peakPowerW = 0.0f;
  sessionData.pendingSync = false;
  storageClearActiveSessionCheckpoint();
  resetLoadValidationState();
  startValidationResult = StartValidationResult::REJECTED_NO_LOAD;
  Serial.println("[LoadCheck] Cancelled: no load detected");
  if (offlineModeActive) {
    offlineNoLoadPrompt = true;
    offlineFinishedAtMs = 0;
    offlineReadyLogged = true;
    Serial.println("[offline] No load detected, relay OFF");
    Serial.println("[offline] No load detected, counter not incremented");
    Serial.println("[offline] Ready for next offline device");
  }
}

static void handleLoadValidation() {
  if (sessionData.state != SessionState::WAITING_LOAD) {
    return;
  }

  const unsigned long now = millis();
  if (loadValidationStartedAtMs == 0) {
    loadValidationStartedAtMs = now;
  }

  if (!loadValidationWaitingLogged) {
    Serial.println(offlineModeActive ? "[offline] Waiting load..." : "[LoadCheck] Waiting load");
    loadValidationWaitingLogged = true;
  }

  if (now - loadValidationStartedAtMs >= currentLoadValidationTimeoutMs()) {
    cancelLoadValidationNoHistory();
    return;
  }

  if (now - loadValidationStartedAtMs < Config::LOAD_SETTLE_MS) {
    return;
  }

  if (isLoadAboveStartThreshold()) {
    loadValidationStableSamples++;
  } else {
    loadValidationStableSamples = 0;
  }

  if (loadValidationStableSamples >= Config::LOAD_DETECT_STABLE_SAMPLES) {
    verifyLoadAndStartMonitoring();
  }
}

void sessionBegin() {
  sessionData.state = SessionState::IDLE;
  sessionData.endReason = EndReason::NONE;
  resetLoadValidationState();
  startValidationResult = StartValidationResult::NONE;
  Serial.println("[session] Ready");
}

bool sessionStart(const char* deviceName) {
  if (sessionIsActive()) {
    return false;
  }

  const char* name = deviceName == nullptr ? appConfig.deviceName : deviceName;
  const unsigned long now = millis();
  strlcpy(sessionData.deviceName, name, sizeof(sessionData.deviceName));
  sessionData.state = SessionState::WAITING_LOAD;
  sessionData.endReason = EndReason::NONE;
  sessionData.startedAtMs = 0;
  makeSessionId(sessionData.sessionId, sizeof(sessionData.sessionId), now);
  sessionData.uid[0] = '\0';
  sessionData.startMode = systemMode;
  sessionData.endedAtMs = 0;
  sessionData.lastUpdateMs = 0;
  sessionData.durationMs = 0;
  sessionData.startEnergyKwh = sensorData.energy;
  sessionData.energyWh = 0.0f;
  sessionData.energyKwh = 0.0f;
  sessionData.cost = 0.0f;
  sessionData.averagePowerW = 0.0f;
  sessionData.peakPowerW = 0.0f;
  sessionData.pendingSync = false;
  elapsedBeforeRecoveryMs = 0;
  resumeMillis = 0;
  loadValidationStartedAtMs = now;
  loadValidationStableSamples = 0;
  loadValidationWaitingLogged = false;
  startValidationResult = StartValidationResult::NONE;

  relaySet(true);
  Serial.println("[LoadCheck] Started");
  Serial.print("[session] Validating load for device ");
  Serial.println(sessionData.deviceName);
  return true;
}

void sessionSetRemoteContext(const char* uid, const char* sessionId) {
  if (uid != nullptr) {
    strlcpy(sessionData.uid, uid, sizeof(sessionData.uid));
  }
  if (sessionId != nullptr && sessionId[0] != '\0') {
    strlcpy(sessionData.sessionId, sessionId, sizeof(sessionData.sessionId));
  }
  if (shouldCheckpointState()) {
    sessionWriteCheckpoint();
  }
}

void sessionStop(EndReason reason) {
  if (!sessionIsActive()) {
    return;
  }

  if (sessionData.state == SessionState::WAITING_LOAD) {
    cancelLoadValidationNoHistory();
    return;
  }

  updateSessionTotals();
  sessionData.endedAtMs = millis();
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
    storageClearActiveSessionCheckpoint();
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
  elapsedBeforeRecoveryMs = 0;
  resumeMillis = 0;
  if (offlineModeActive) {
    offlineNoLoadPrompt = false;
    offlineFinishedAtMs = millis();
    offlineReadyLogged = false;
    if (reason == EndReason::LOAD_REMOVED && saved) {
      Serial.println("[offline] Load removed, session saved locally");
    }
  }
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
  if (sessionData.state == SessionState::WAITING_LOAD) {
    handleLoadValidation();
    return;
  }

  if (!sessionIsActive()) {
    return;
  }

  updateSessionTotals();

  const unsigned long now = millis();
  const unsigned long checkpointIntervalMs = max(1UL, appConfig.checkpointIntervalSec) * 1000UL;
  if (shouldCheckpointState() &&
      (lastCheckpointWriteMs == 0 || now - lastCheckpointWriteMs >= checkpointIntervalMs)) {
    sessionWriteCheckpoint();
  }

  if (sensorData.valid && sensorData.power >= appConfig.overloadThresholdW) {
    sessionData.state = SessionState::OVERLOAD;
    sessionStop(EndReason::OVERLOAD);
    return;
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

bool sessionConsumeStartValidationResult(StartValidationResult& result) {
  if (startValidationResult == StartValidationResult::NONE) {
    return false;
  }

  result = startValidationResult;
  startValidationResult = StartValidationResult::NONE;
  return true;
}

void sessionRecoveryBegin() {
  recoveryState = RecoveryState::IDLE;
  strlcpy(recoveryStatusText, "idle", sizeof(recoveryStatusText));

  if (!storageReadActiveSessionCheckpoint(recoveryCheckpoint) || !recoveryCheckpoint.active) {
    return;
  }

  Serial.println("[recovery] active session checkpoint found");
  recoveryState = RecoveryState::SETTLING;
  strlcpy(recoveryStatusText, "checking_session", sizeof(recoveryStatusText));
  recoveryStartedAtMs = millis();

  if (recoveryCheckpoint.relayState) {
    relaySet(true);
  }
}

void sessionRecoveryUpdate() {
  if (recoveryState != RecoveryState::SETTLING) {
    return;
  }

  if (millis() - recoveryStartedAtMs < RECOVERY_SETTLE_MS) {
    return;
  }

  sensorUpdate();
  if (sensorData.loadDetected) {
    restoreSessionFromCheckpoint(recoveryCheckpoint, SessionState::MONITORING);
    relaySet(true);
    sessionWriteCheckpoint();
    recoveryState = RecoveryState::RESUMED;
    strlcpy(recoveryStatusText, "resumed", sizeof(recoveryStatusText));
    Serial.println("[recovery] session resumed");
    return;
  }

  finalizeRecoveredNoLoad();
}

bool sessionRecoveryIsActive() {
  return recoveryState == RecoveryState::SETTLING;
}

const char* sessionRecoveryStatus() {
  return recoveryStatusText;
}

bool sessionWriteCheckpoint() {
  if (!shouldCheckpointState()) {
    return false;
  }

  updateSessionTotals();
  ActiveSessionCheckpoint checkpoint;
  fillCheckpointFromSession(checkpoint);
  const bool saved = storageWriteActiveSessionCheckpoint(checkpoint);
  if (saved) {
    lastCheckpointWriteMs = millis();
  }
  return saved;
}

bool sessionReadCheckpointJson(String& out) {
  return storageReadActiveSessionCheckpointJson(out);
}

bool sessionClearCheckpoint() {
  return storageClearActiveSessionCheckpoint();
}

bool offlineModeCanStartNextAttempt() {
  return offlineModeActive &&
         !relayIsOn() &&
         !sessionIsActive();
}

bool offlineModeStartNextAttempt(bool firstAttempt) {
  if (!offlineModeCanStartNextAttempt()) {
    return false;
  }

  systemMode = SystemMode::OFFLINE;
  offlineNoLoadPrompt = false;
  offlineFinishedAtMs = 0;
  offlineReadyLogged = false;

  const bool started = sessionStart("");
  if (!started) {
    return false;
  }

  if (firstAttempt) {
    Serial.println("[offline] First offline attempt relay ON");
  } else {
    Serial.println("[offline] BOOT 1s next device validation");
  }
  return true;
}

bool offlineModeEnter(OfflineEntryReason reason) {
  offlineModeActive = true;
  offlineNoLoadPrompt = false;
  offlineFinishedAtMs = 0;
  offlineReadyLogged = false;
  systemMode = SystemMode::OFFLINE;
  networkStopPortalForOffline();

  Serial.print("[offline] Enter offline mode reason=");
  Serial.println(offlineEntryReasonToString(reason));

  offlineModeStartNextAttempt(true);
  return true;
}

void offlineModeUpdate() {
  if (!offlineModeActive) {
    return;
  }

  systemMode = networkIsConnected() ? SystemMode::ONLINE : SystemMode::OFFLINE;

  if (sessionData.state == SessionState::FINISHED &&
      offlineFinishedAtMs > 0 &&
      millis() - offlineFinishedAtMs >= OFFLINE_FINISHED_SUMMARY_MS) {
    sessionData.state = SessionState::IDLE;
    offlineFinishedAtMs = 0;
  }

  if (!sessionIsActive() &&
      !relayIsOn() &&
      !offlineNoLoadPrompt &&
      offlineFinishedAtMs == 0 &&
      !offlineReadyLogged) {
    offlineReadyLogged = true;
    Serial.println("[offline] Ready for next offline device");
  }
}

bool offlineModeIsActive() {
  return offlineModeActive;
}

bool offlineModeShowNoLoadPrompt() {
  return offlineModeActive && offlineNoLoadPrompt;
}

bool offlineModeShowFinishedSummary() {
  return offlineModeActive &&
         sessionData.state == SessionState::FINISHED &&
         offlineFinishedAtMs > 0;
}
