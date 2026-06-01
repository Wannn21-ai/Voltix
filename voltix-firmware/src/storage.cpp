#include "storage.h"
#include "config.h"
#include "firebase_sync.h"
#include "network.h"
#include "state.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <LittleFS.h>

static constexpr const char* HISTORY_PATH = "/history.json";
static constexpr size_t HISTORY_DOC_CAPACITY = 16384;

static bool mounted = false;

static void formatDuration(unsigned long durationMs, char* out, size_t outSize) {
  const unsigned long totalSec = durationMs / 1000UL;
  const unsigned long hours = totalSec / 3600UL;
  const unsigned long minutes = (totalSec % 3600UL) / 60UL;
  const unsigned long seconds = totalSec % 60UL;
  snprintf(out, outSize, "%02lu:%02lu:%02lu", hours, minutes, seconds);
}

static void formatCostText(float cost, char* out, size_t outSize) {
  snprintf(out, outSize, "Rp %.0f", cost);
}

static bool loadHistory(DynamicJsonDocument& doc) {
  doc.clear();

  if (!LittleFS.exists(HISTORY_PATH)) {
    doc.to<JsonArray>();
    return true;
  }

  File file = LittleFS.open(HISTORY_PATH, "r");
  if (!file) {
    Serial.println("[storage] Failed to open /history.json for read");
    return false;
  }

  if (file.size() == 0) {
    file.close();
    doc.to<JsonArray>();
    return true;
  }

  const DeserializationError error = deserializeJson(doc, file);
  file.close();

  if (error) {
    Serial.print("[storage] Failed to parse /history.json: ");
    Serial.println(error.c_str());
    return false;
  }

  if (!doc.is<JsonArray>()) {
    Serial.println("[storage] /history.json is not a JSON array");
    return false;
  }

  return true;
}

static bool writeHistory(DynamicJsonDocument& doc) {
  File file = LittleFS.open(HISTORY_PATH, "w");
  if (!file) {
    Serial.println("[storage] Failed to open /history.json for write");
    return false;
  }

  const size_t written = serializeJson(doc, file);
  file.close();
  return written > 0;
}

bool storageBegin() {
  mounted = LittleFS.begin(true);
  Serial.print("[storage] LittleFS ");
  Serial.println(mounted ? "mounted" : "mount failed");
  return mounted;
}

void storageUpdate() {
}

bool storageAppendCompletedSession(const CompletedSessionSnapshot& snapshot) {
  if (!mounted) {
    Serial.println("[storage] Cannot save session, LittleFS is not mounted");
    return false;
  }

  DynamicJsonDocument doc(HISTORY_DOC_CAPACITY);
  if (!loadHistory(doc)) {
    return false;
  }

  JsonArray history = doc.as<JsonArray>();
  JsonObject entry = history.createNestedObject();
  if (entry.isNull()) {
    Serial.println("[storage] Failed to append history entry, document is full");
    return false;
  }

  char duration[16];
  char costText[24];
  char energyKwhText[24];
  char costValueText[24];
  formatDuration(snapshot.durationSec * 1000UL, duration, sizeof(duration));
  formatCostText(snapshot.cost, costText, sizeof(costText));
  snprintf(energyKwhText, sizeof(energyKwhText), "%.8f", snapshot.energyKwh);
  snprintf(costValueText, sizeof(costValueText), "%.4f", snapshot.cost);

  entry["id"] = snapshot.id;
  entry["sessionId"] = snapshot.sessionId;
  entry["deviceId"] = Config::DEVICE_ID;
  entry["uid"] = snapshot.uid;
  entry["name"] = snapshot.deviceName;
  entry["duration"] = duration;
  entry["durationSec"] = snapshot.durationSec;
  entry["power"] = snapshot.averagePower;
  entry["averagePower"] = snapshot.averagePower;
  entry["peakPower"] = snapshot.peakPower;
  entry["energyWh"] = snapshot.energyWh;
  entry["energy"] = serialized(energyKwhText);
  entry["cost"] = serialized(costValueText);
  entry["costText"] = costText;
  entry["voltage"] = snapshot.voltage;
  entry["current"] = snapshot.current;
  entry["frequency"] = snapshot.frequency;
  entry["powerFactor"] = snapshot.powerFactor;
  entry["tariff"] = snapshot.tariff;
  entry["currency"] = snapshot.currency;
  entry["overload"] = snapshot.endReason == EndReason::OVERLOAD;
  entry["overloadThreshold"] = appConfig.overloadThresholdW;
  entry["startMode"] = systemModeToString(snapshot.startMode);
  entry["endMode"] = systemModeToString(snapshot.endMode);
  entry["endReason"] = endReasonToString(snapshot.endReason);
  entry["date"] = snapshot.date;
  entry["time"] = snapshot.time;
  entry["timestamp"] = snapshot.timestamp;
  entry["syncStatus"] = "PENDING";
  entry["pendingSync"] = true;
  entry["createdFrom"] = "ESP32";

  const bool saved = writeHistory(doc);
  Serial.print("[storage] Append history ");
  Serial.print(saved ? "OK" : "FAIL");
  Serial.print(" count=");
  Serial.println(saved ? history.size() : 0);
  return saved;
}

bool storageReadHistoryJson(String& out) {
  out = "[]";
  if (!mounted) {
    Serial.println("[storage] Cannot read history, LittleFS is not mounted");
    return false;
  }

  if (!LittleFS.exists(HISTORY_PATH)) {
    return true;
  }

  File file = LittleFS.open(HISTORY_PATH, "r");
  if (!file) {
    Serial.println("[storage] Failed to open /history.json for read");
    return false;
  }

  out = file.readString();
  file.close();
  if (out.length() == 0) {
    out = "[]";
  }
  return true;
}

int storageCountHistory() {
  if (!mounted) {
    Serial.println("[storage] Cannot count history, LittleFS is not mounted");
    return -1;
  }

  DynamicJsonDocument doc(HISTORY_DOC_CAPACITY);
  if (!loadHistory(doc)) {
    return -1;
  }

  return doc.as<JsonArray>().size();
}

bool storageClearHistory() {
  if (!mounted) {
    Serial.println("[storage] Cannot clear history, LittleFS is not mounted");
    return false;
  }

  File file = LittleFS.open(HISTORY_PATH, "w");
  if (!file) {
    Serial.println("[storage] Failed to open /history.json for clear");
    return false;
  }

  const size_t written = file.print("[]");
  file.close();
  Serial.println(written > 0 ? "[storage] History cleared" : "[storage] Clear history failed");
  return written > 0;
}

bool storageMarkSessionQueued(const char* sessionId) {
  if (!mounted) {
    Serial.println("[storage] Cannot mark queued, LittleFS is not mounted");
    return false;
  }
  if (sessionId == nullptr || sessionId[0] == '\0') {
    Serial.println("[storage] Cannot mark queued, empty sessionId");
    return false;
  }

  DynamicJsonDocument doc(HISTORY_DOC_CAPACITY);
  if (!loadHistory(doc)) {
    return false;
  }

  JsonArray history = doc.as<JsonArray>();
  bool changed = false;
  for (JsonObject entry : history) {
    const char* entrySessionId = entry["sessionId"] | entry["id"] | "";
    if (strcmp(entrySessionId, sessionId) == 0) {
      entry["syncStatus"] = "QUEUED";
      entry["pendingSync"] = false;
      entry["syncedAt"] = millis();
      changed = true;
      break;
    }
  }

  if (!changed) {
    Serial.print("[storage] No local history entry for sessionId=");
    Serial.println(sessionId);
    return false;
  }

  const bool saved = writeHistory(doc);
  Serial.print("[storage] Mark queued ");
  Serial.print(sessionId);
  Serial.print(" ");
  Serial.println(saved ? "OK" : "FAIL");
  return saved;
}

int storageCountPendingHistory() {
  if (!mounted) {
    Serial.println("[storage] Cannot count pending history, LittleFS is not mounted");
    return -1;
  }

  DynamicJsonDocument doc(HISTORY_DOC_CAPACITY);
  if (!loadHistory(doc)) {
    return -1;
  }

  int count = 0;
  for (JsonObjectConst entry : doc.as<JsonArrayConst>()) {
    const char* syncStatus = entry["syncStatus"] | "PENDING";
    if (strcmp(syncStatus, "PENDING") == 0) {
      count++;
    }
  }
  return count;
}

bool storageSyncPendingHistoryToFirebase() {
  if (!mounted) {
    Serial.println("[storage] Cannot sync pending history, LittleFS is not mounted");
    return false;
  }

  DynamicJsonDocument doc(HISTORY_DOC_CAPACITY);
  if (!loadHistory(doc)) {
    return false;
  }

  JsonArray history = doc.as<JsonArray>();
  int pending = 0;
  int queued = 0;
  int failed = 0;

  for (JsonObject entry : history) {
    const char* syncStatus = entry["syncStatus"] | "PENDING";
    if (strcmp(syncStatus, "PENDING") == 0) {
      pending++;
    }
  }

  if (!networkIsConnected()) {
    Serial.print("[storage] Pending sync total=");
    Serial.print(pending);
    Serial.println(" queued=0 failed=0 save=SKIP WiFi offline");
    return pending == 0;
  }

  for (JsonObject entry : history) {
    const char* syncStatus = entry["syncStatus"] | "PENDING";
    if (strcmp(syncStatus, "PENDING") != 0) {
      continue;
    }

    const bool pushed = firebasePushCompletedSession(entry);
    if (pushed) {
      entry["syncStatus"] = "QUEUED";
      entry["pendingSync"] = false;
      entry["syncedAt"] = millis();
      queued++;
    } else {
      entry["syncStatus"] = "PENDING";
      entry["pendingSync"] = true;
      failed++;
    }
  }

  bool saved = true;
  if (queued > 0) {
    saved = writeHistory(doc);
  }

  Serial.print("[storage] Pending sync total=");
  Serial.print(pending);
  Serial.print(" queued=");
  Serial.print(queued);
  Serial.print(" failed=");
  Serial.print(failed);
  Serial.print(" save=");
  Serial.println(saved ? "OK" : "FAIL");

  return failed == 0 && saved;
}
