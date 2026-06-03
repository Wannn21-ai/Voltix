#include "display.h"
#include "config.h"
#include "network.h"
#include "session.h"
#include "state.h"

#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Arduino.h>
#include <Wire.h>

namespace {
constexpr int SCREEN_WIDTH = 128;
constexpr int SCREEN_HEIGHT = 64;
constexpr int OLED_RESET = -1;
constexpr uint8_t OLED_ADDRESS = 0x3C;
constexpr unsigned long DISPLAY_INTERVAL_MS = 500UL;
constexpr size_t MAX_LINE_CHARS = 21;

Adafruit_SSD1306 oled(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
bool oledReady = false;
unsigned long lastDisplayMs = 0;

void drawLine(uint8_t line, const char* text) {
  oled.setCursor(0, line * 10);
  oled.print(text);
}

void trimText(const char* input, char* output, size_t outputSize) {
  if (outputSize == 0) {
    return;
  }

  const char* source = (input != nullptr && input[0] != '\0') ? input : Config::DEFAULT_DEVICE_NAME;
  const size_t maxTextChars = min(outputSize - 1, MAX_LINE_CHARS);
  size_t i = 0;
  while (i < maxTextChars && source[i] != '\0') {
    output[i] = source[i];
    i++;
  }

  if (source[i] != '\0' && maxTextChars > 0) {
    output[maxTextChars - 1] = '~';
    output[maxTextChars] = '\0';
  } else {
    output[i] = '\0';
  }
}

void formatDuration(unsigned long totalSeconds, char* output, size_t outputSize) {
  const unsigned long hours = totalSeconds / 3600UL;
  const unsigned long minutes = (totalSeconds % 3600UL) / 60UL;
  const unsigned long seconds = totalSeconds % 60UL;

  if (hours > 99UL) {
    snprintf(output, outputSize, "%lu:%02lu:%02lu", hours, minutes, seconds);
  } else {
    snprintf(output, outputSize, "%02lu:%02lu:%02lu", hours, minutes, seconds);
  }
}

void startScreen() {
  oled.clearDisplay();
  oled.setTextSize(1);
  oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(0, 0);
}

void finishScreen() {
  oled.display();
}

void renderIdle() {
  startScreen();
  drawLine(0, "Voltix Ready");
  drawLine(2, Config::DEVICE_ID);
  finishScreen();
}

void renderWaitingLoad() {
  if (offlineModeIsActive()) {
    startScreen();
    drawLine(0, offlineModeIsManualLocked() ? "Offline Manual" : "Offline Auto");
    drawLine(1, "Relay: ON");
    drawLine(2, "Waiting Load");
    finishScreen();
    return;
  }

  char deviceName[24];
  trimText(sessionData.deviceName, deviceName, sizeof(deviceName));

  startScreen();
  drawLine(0, deviceName);
  drawLine(2, "Waiting Load");
  drawLine(4, "Connect device");
  finishScreen();
}

void renderOfflineNoLoad() {
  startScreen();
  drawLine(0, "No Load");
  drawLine(1, "Relay OFF");
  drawLine(2, "BOOT 1s Next");
  finishScreen();
}

void renderOfflineReady() {
  startScreen();
  if (offlineModeIsManualLocked()) {
    drawLine(0, "Offline Manual");
    drawLine(1, "Relay OFF");
    drawLine(2, "BOOT 1s Next");
  } else {
    drawLine(0, "Offline Auto");
    drawLine(1, "Reconnecting...");
    drawLine(2, "BOOT 1s Next");
  }
  finishScreen();
}

void renderTryingOnline() {
  startScreen();
  drawLine(0, "Trying Online");
  drawLine(1, "WiFi reconnect...");
  finishScreen();
}

void renderMonitoring() {
  char deviceName[24];
  char line[32];
  char duration[16];

  trimText(sessionData.deviceName, deviceName, sizeof(deviceName));
  formatDuration(sessionData.durationMs / 1000UL, duration, sizeof(duration));

  startScreen();
  drawLine(0, deviceName);
  snprintf(line, sizeof(line), "V:%.1f I:%.3fA", sensorData.voltage, sensorData.current);
  drawLine(1, line);
  snprintf(line, sizeof(line), "P:%.1fW", sensorData.power);
  drawLine(2, line);
  snprintf(line, sizeof(line), "E:%.6fkWh", sessionData.energyKwh);
  drawLine(3, line);
  snprintf(line, sizeof(line), "Rp:%.2f", sessionData.cost);
  drawLine(4, line);
  snprintf(line, sizeof(line), "T:%s", duration);
  drawLine(5, line);
  finishScreen();
}

void renderFinished() {
  char deviceName[24];
  char line[32];
  char duration[16];

  trimText(sessionData.deviceName, deviceName, sizeof(deviceName));
  formatDuration(sessionData.durationMs / 1000UL, duration, sizeof(duration));

  startScreen();
  drawLine(0, sessionData.endReason == EndReason::OVERLOAD ? "OVERLOAD" : "Finished");
  drawLine(1, deviceName);
  snprintf(line, sizeof(line), "E:%.6fkWh", sessionData.energyKwh);
  drawLine(2, line);
  snprintf(line, sizeof(line), "Rp:%.2f", sessionData.cost);
  drawLine(3, line);
  snprintf(line, sizeof(line), "T:%s", duration);
  drawLine(4, line);
  finishScreen();
}

void renderOverload() {
  char line[32];

  startScreen();
  drawLine(0, "OVERLOAD");
  drawLine(1, "Power too high");
  snprintf(line, sizeof(line), "P:%.1fW", sensorData.power);
  drawLine(3, line);
  snprintf(line, sizeof(line), "Limit:%.1fW", appConfig.overloadThresholdW);
  drawLine(4, line);
  finishScreen();
}

void renderSetupPortal() {
  startScreen();
  drawLine(0, "Voltix Setup");
  drawLine(1, "AP: Voltix-Setup");
  drawLine(2, "IP: 192.168.4.1");
  drawLine(3, "Open in browser");
  finishScreen();
}

void renderRecovery() {
  startScreen();
  drawLine(0, "Voltix Recovery");
  drawLine(1, "Checking session");
  drawLine(2, "Please wait");
  finishScreen();
}

void renderScreen() {
  if (!oledReady) {
    return;
  }

  if (sessionRecoveryIsActive()) {
    renderRecovery();
    return;
  }

  if (offlineModeShowTryingOnline()) {
    renderTryingOnline();
    return;
  }

  if (sessionData.state == SessionState::MONITORING) {
    renderMonitoring();
    return;
  }

  if (sessionData.state == SessionState::WAITING_LOAD) {
    renderWaitingLoad();
    return;
  }

  if (offlineModeShowNoLoadPrompt()) {
    renderOfflineNoLoad();
    return;
  }

  if (offlineModeIsActive() &&
      !offlineModeShowFinishedSummary() &&
      !sessionIsActive()) {
    renderOfflineReady();
    return;
  }

  if (networkIsPortalActive()) {
    renderSetupPortal();
    return;
  }

  switch (sessionData.state) {
    case SessionState::IDLE:
      renderIdle();
      break;
    case SessionState::WAITING_LOAD:
      renderWaitingLoad();
      break;
    case SessionState::MONITORING:
      renderMonitoring();
      break;
    case SessionState::OVERLOAD:
      renderOverload();
      break;
    case SessionState::FINISHING:
    case SessionState::FINISHED:
      renderFinished();
      break;
    default:
      renderIdle();
      break;
  }
}
}

void displayBegin() {
  oledReady = oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS);
  if (!oledReady) {
    Serial.println("[display] SSD1306 init failed");
    return;
  }

  oled.clearDisplay();
  oled.display();
  Serial.println("[display] SSD1306 initialized");
}

void displayUpdate() {
  const unsigned long now = millis();
  if (now - lastDisplayMs < DISPLAY_INTERVAL_MS) {
    return;
  }

  lastDisplayMs = now;
  renderScreen();
}

void displayShowBoot() {
  if (!oledReady) {
    Serial.println("[display] Boot screen skipped, OLED not ready");
    return;
  }

  startScreen();
  drawLine(0, "Voltix");
  drawLine(2, "Booting...");
  finishScreen();
}

void displayShowStatus() {
  renderScreen();
}
