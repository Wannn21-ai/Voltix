#include "network.h"
#include "credentials.h"
#include "state.h"

#include <Arduino.h>
#include <WiFi.h>

static unsigned long lastReconnectAttemptMs = 0;
static bool wasConnected = false;

void networkBegin() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  systemMode = SystemMode::TRANSITION;
  lastReconnectAttemptMs = millis();
  Serial.print("[network] Connecting to WiFi SSID=");
  Serial.println(WIFI_SSID);
}

void networkUpdate() {
  const bool connected = networkIsConnected();
  if (connected != wasConnected) {
    wasConnected = connected;
    systemMode = connected ? SystemMode::ONLINE : SystemMode::OFFLINE;
    if (connected) {
      Serial.println("[network] WiFi reconnected");
      Serial.print("[network] IP=");
      Serial.println(WiFi.localIP());
      if (sessionData.state == SessionState::MONITORING) {
        Serial.println("[session] Continuing active session after reconnect");
      }
    } else {
      Serial.println("[network] WiFi lost, switching to OFFLINE");
    }
  }

  if (!connected && millis() - lastReconnectAttemptMs >= 10000UL) {
    lastReconnectAttemptMs = millis();
    Serial.println("[network] Reconnecting WiFi...");
    WiFi.disconnect(false, false);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }
}

bool networkIsConnected() {
  return WiFi.status() == WL_CONNECTED;
}
