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
constexpr unsigned long BUTTON_DISPLAY_INTERVAL_MS = 200UL;
constexpr unsigned long BUTTON_FEEDBACK_MS = 1200UL;
constexpr size_t MAX_LINE_CHARS = 21;
constexpr size_t BUTTON_LABEL_CHARS = 22;

Adafruit_SSD1306 oled(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
bool oledReady = false;
unsigned long lastDisplayMs = 0;
bool buttonHoldVisible = false;
unsigned long buttonHoldDurationMs = 0;
unsigned long lastButtonHoldDisplayMs = 0;
uint8_t buttonHoldProgressPercent = 0;
char buttonHoldReleaseAction[BUTTON_LABEL_CHARS] = "";
bool buttonFeedbackVisible = false;
unsigned long buttonFeedbackUntilMs = 0;
char buttonFeedbackMessage[BUTTON_LABEL_CHARS] = "";

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

void copyDisplayText(const char* input, char* output, size_t outputSize) {
  if (outputSize == 0) {
    return;
  }

  snprintf(output, outputSize, "%s", input != nullptr ? input : "");
}

bool screenAllowsButtonOverlay() {
  return !sessionRecoveryIsActive() && sessionData.state != SessionState::OVERLOAD;
}

void formatProgressBar(uint8_t percent, char* output, size_t outputSize) {
  const uint8_t safePercent = percent > 100 ? 100 : percent;
  const uint8_t filled = (safePercent * 10U + 50U) / 100U;
  size_t pos = 0;

  if (outputSize == 0) {
    return;
  }

  output[pos++] = '[';
  for (uint8_t i = 0; i < 10 && pos + 2 < outputSize; i++) {
    output[pos++] = i < filled ? '#' : '-';
  }
  if (pos + 1 < outputSize) {
    output[pos++] = ']';
  }
  output[pos] = '\0';
}

void renderButtonHold() {
  char line[32];
  char progress[16];

  startScreen();
  drawLine(0, "BUTTON HOLD");
  snprintf(line, sizeof(line), "Time: %lu.%lus", buttonHoldDurationMs / 1000UL, (buttonHoldDurationMs % 1000UL) / 100UL);
  drawLine(1, line);
  drawLine(2, buttonHoldReleaseAction);
  formatProgressBar(buttonHoldProgressPercent, progress, sizeof(progress));
  drawLine(4, progress);
  finishScreen();
}

void renderButtonFeedback() {
  startScreen();
  drawLine(1, buttonFeedbackMessage);
  finishScreen();
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

  if (sessionData.state == SessionState::OVERLOAD) {
    renderOverload();
    return;
  }

  if (buttonHoldVisible && screenAllowsButtonOverlay()) {
    renderButtonHold();
    return;
  }

  if (buttonFeedbackVisible) {
    if (millis() < buttonFeedbackUntilMs && screenAllowsButtonOverlay()) {
      renderButtonFeedback();
      return;
    }
    buttonFeedbackVisible = false;
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
  const unsigned long intervalMs = buttonHoldVisible ? BUTTON_DISPLAY_INTERVAL_MS : DISPLAY_INTERVAL_MS;
  if (now - lastDisplayMs < intervalMs) {
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

void displayShowButtonHold(unsigned long heldMs, const char* releaseAction, uint8_t progressPercent) {
  if (!oledReady) {
    return;
  }

  const unsigned long now = millis();
  buttonHoldVisible = true;
  buttonFeedbackVisible = false;
  buttonHoldDurationMs = heldMs;
  buttonHoldProgressPercent = progressPercent > 100 ? 100 : progressPercent;
  copyDisplayText(releaseAction, buttonHoldReleaseAction, sizeof(buttonHoldReleaseAction));

  if (now - lastButtonHoldDisplayMs < BUTTON_DISPLAY_INTERVAL_MS) {
    return;
  }

  lastButtonHoldDisplayMs = now;
  lastDisplayMs = now;
  renderScreen();
}

void displayClearButtonHold() {
  buttonHoldVisible = false;
  lastButtonHoldDisplayMs = 0;
  if (!oledReady) {
    return;
  }

  lastDisplayMs = millis();
  renderScreen();
}

void displayShowButtonFeedback(const char* message) {
  if (!oledReady) {
    return;
  }

  buttonHoldVisible = false;
  buttonFeedbackVisible = true;
  buttonFeedbackUntilMs = millis() + BUTTON_FEEDBACK_MS;
  copyDisplayText(message, buttonFeedbackMessage, sizeof(buttonFeedbackMessage));
  lastDisplayMs = millis();
  renderScreen();
}
