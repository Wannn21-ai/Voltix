#include "network.h"
#include "config.h"
#include "credentials.h"
#include "relay.h"
#include "session.h"
#include "state.h"

#include <Arduino.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>

namespace {
constexpr const char* PREF_NAMESPACE = "voltix";
constexpr const char* PREF_KEY_WIFI_SSID = "wifi_ssid";
constexpr const char* PREF_KEY_WIFI_PASS = "wifi_pass";
constexpr const char* PREF_KEY_TARIFF = "tariff";
constexpr const char* PREF_KEY_OVERLOAD = "overloadThreshold";
constexpr const char* SETUP_AP_SSID = "Voltix-Setup";
constexpr const char* SETUP_AP_PASSWORD = "12345678";
constexpr unsigned long WIFI_CONNECT_TIMEOUT_MS = 15000UL;
constexpr unsigned long WIFI_RECONNECT_INTERVAL_MS = 10000UL;
constexpr unsigned long RESTART_DELAY_MS = 1200UL;
constexpr unsigned long BOOT_NEXT_ATTEMPT_MS = 1000UL;
constexpr unsigned long BOOT_CLEAR_WIFI_MS = 5000UL;
constexpr unsigned long BOOT_ENTER_OFFLINE_MS = 10000UL;
constexpr byte DNS_PORT = 53;

enum class WifiSource {
  NONE,
  SAVED,
  FALLBACK
};

static unsigned long lastReconnectAttemptMs = 0;
static unsigned long connectStartedAtMs = 0;
static unsigned long restartAtMs = 0;
static unsigned long bootButtonPressedAtMs = 0;
static unsigned long portalOfflineAtMs = 0;
static bool portalActive = false;
static bool wasConnecting = false;
static bool wasConnected = false;
static bool restartPending = false;
static bool portalOfflinePending = false;
static bool bootComplete = false;
static bool bootButtonArmed = false;
static bool initialNetworkSetup = true;
static String savedWifiSsid;
static String savedWifiPassword;
static String activeWifiSsid;
static String activeWifiPassword;
static WifiSource activeWifiSource = WifiSource::NONE;
static WebServer portalServer(80);
static DNSServer dnsServer;
static const IPAddress setupIp(192, 168, 4, 1);
static const IPAddress setupGateway(192, 168, 4, 1);
static const IPAddress setupSubnet(255, 255, 255, 0);

void startWiFiConnection(const String& ssid, const String& password, WifiSource source, bool background);

String htmlEscape(const String& value) {
  String escaped = value;
  escaped.replace("&", "&amp;");
  escaped.replace("\"", "&quot;");
  escaped.replace("<", "&lt;");
  escaped.replace(">", "&gt;");
  return escaped;
}

void scheduleRestart() {
  restartPending = true;
  restartAtMs = millis() + RESTART_DELAY_MS;
}

bool isSessionBusyForNetwork() {
  return sessionData.state == SessionState::MONITORING ||
         sessionData.state == SessionState::WAITING_LOAD ||
         sessionIsActive() ||
         relayIsOn() ||
         sessionRecoveryIsActive();
}

bool canStartCaptivePortal(const char* reason) {
  Serial.print("[portal] Request start captive portal: reason=");
  Serial.print(reason == nullptr ? "unknown" : reason);
  Serial.print(" sessionState=");
  Serial.print(sessionStateToString(sessionData.state));
  Serial.print(" active=");
  Serial.print(sessionIsActive() ? "yes" : "no");
  Serial.print(" relay=");
  Serial.println(relayIsOn() ? "on" : "off");

  if (isSessionBusyForNetwork()) {
    Serial.print("[portal] Captive portal suppressed: active session reason=");
    Serial.println(reason == nullptr ? "unknown" : reason);
    return false;
  }

  return true;
}

void sendSetupForm() {
  String page;
  page.reserve(1800);
  page += F("<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>");
  page += F("<title>Voltix Setup</title><style>");
  page += F("body{font-family:Arial,sans-serif;margin:0;background:#f6f7f9;color:#111}");
  page += F("main{max-width:420px;margin:32px auto;padding:20px;background:#fff;border:1px solid #ddd;border-radius:8px}");
  page += F("label{display:block;margin-top:14px;font-weight:600}input{box-sizing:border-box;width:100%;padding:10px;margin-top:6px;border:1px solid #bbb;border-radius:6px;font-size:16px}");
  page += F("button{width:100%;margin-top:18px;padding:12px;border:0;border-radius:6px;background:#111;color:#fff;font-size:16px}");
  page += F(".secondary{background:#444}a{display:block;margin-top:16px;color:#333;text-align:center}</style></head><body><main>");
  page += F("<h1>Voltix Setup</h1><form method='post' action='/save'>");
  page += F("<label>WiFi SSID<input name='ssid' required value='");
  page += htmlEscape(savedWifiSsid);
  page += F("'></label><label>WiFi Password<input name='password' type='password' value='");
  page += htmlEscape(savedWifiPassword);
  page += F("'></label><label>Tariff<input name='tariff' type='number' step='0.01' value='");
  page += String(appConfig.tariffPerKwh > 0.0f ? appConfig.tariffPerKwh : Config::DEFAULT_TARIFF, 2);
  page += F("'></label><label>Overload Threshold (W)<input name='overloadThreshold' type='number' step='0.1' value='");
  page += String(appConfig.overloadThresholdW > 0.0f ? appConfig.overloadThresholdW : Config::OVERLOAD_THRESHOLD_W, 1);
  page += F("'></label><button type='submit'>Save and Restart</button></form>");
  page += F("<form method='post' action='/offline'><button class='secondary' type='submit'>Lanjutkan Mode Offline</button></form>");
  page += F("<a href='/status'>Status</a><a href='/reset-wifi'>Reset WiFi</a></main></body></html>");
  portalServer.send(200, "text/html", page);
}

void sendStatus() {
  String status;
  status.reserve(180);
  status += F("{\"mode\":\"");
  status += portalActive ? F("setup_portal") : F("station");
  status += F("\",\"savedSsidExists\":\"");
  status += hasSavedWiFiCredentials() ? F("yes") : F("no");
  status += F("\",\"currentIp\":\"");
  status += portalActive ? WiFi.softAPIP().toString() : WiFi.localIP().toString();
  status += F("\",\"systemMode\":\"");
  status += systemModeToString(systemMode);
  status += F("\"}");
  portalServer.send(200, "application/json", status);
}

void handleSave() {
  if (!portalServer.hasArg("ssid")) {
    portalServer.send(400, "text/plain", "Missing WiFi SSID");
    return;
  }

  const String ssid = portalServer.arg("ssid");
  const String password = portalServer.hasArg("password") ? portalServer.arg("password") : "";
  const float tariff = portalServer.hasArg("tariff") ? portalServer.arg("tariff").toFloat() : appConfig.tariffPerKwh;
  const float overloadThreshold = portalServer.hasArg("overloadThreshold") ? portalServer.arg("overloadThreshold").toFloat() : appConfig.overloadThresholdW;

  if (ssid.length() == 0) {
    portalServer.send(400, "text/plain", "WiFi SSID cannot be empty");
    return;
  }

  saveWiFiCredentials(ssid, password);
  appConfig.tariffPerKwh = tariff > 0.0f ? tariff : Config::DEFAULT_TARIFF;
  appConfig.overloadThresholdW = overloadThreshold > 0.0f ? overloadThreshold : Config::OVERLOAD_THRESHOLD_W;
  saveLocalConfig();

  Serial.print("[portal] Saved WiFi SSID=");
  Serial.println(ssid);
  Serial.print("[portal] Saved local config tariff=");
  Serial.print(appConfig.tariffPerKwh, 2);
  Serial.print(" overload=");
  Serial.println(appConfig.overloadThresholdW, 1);
  Serial.println("[portal] Credentials saved, restarting");
  portalServer.send(200, "text/html", "<!doctype html><html><body><h1>Saved</h1><p>Voltix is restarting...</p></body></html>");
  scheduleRestart();
}

void handleResetWiFi() {
  clearWiFiCredentials();
  portalServer.send(200, "text/html", "<!doctype html><html><body><h1>WiFi reset</h1><p>Voltix is restarting...</p></body></html>");
  scheduleRestart();
}

void handleOffline() {
  portalServer.send(
    200,
    "text/html",
    "<!doctype html><html><body><h1>Voltix masuk Mode Offline</h1><p>Relay ON untuk deteksi beban pertama.</p></body></html>"
  );
  portalOfflinePending = true;
  portalOfflineAtMs = millis() + 100UL;
}

void redirectToSetup() {
  portalServer.sendHeader("Location", String("http://") + setupIp.toString() + "/", true);
  portalServer.send(302, "text/plain", "");
}

void startSetupPortal(const char* reason) {
  if (portalActive) {
    return;
  }
  if (!canStartCaptivePortal(reason)) {
    systemMode = SystemMode::OFFLINE;
    return;
  }

  Serial.println("[portal] Starting setup portal...");
  WiFi.disconnect(false, false);
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(setupIp, setupGateway, setupSubnet);
  WiFi.softAP(SETUP_AP_SSID, SETUP_AP_PASSWORD);

  dnsServer.start(DNS_PORT, "*", setupIp);
  portalServer.on("/", HTTP_GET, sendSetupForm);
  portalServer.on("/status", HTTP_GET, sendStatus);
  portalServer.on("/save", HTTP_POST, handleSave);
  portalServer.on("/reset-wifi", HTTP_GET, handleResetWiFi);
  portalServer.on("/offline", HTTP_GET, handleOffline);
  portalServer.on("/offline", HTTP_POST, handleOffline);
  portalServer.on("/generate_204", HTTP_GET, redirectToSetup);
  portalServer.on("/fwlink", HTTP_GET, redirectToSetup);
  portalServer.onNotFound(redirectToSetup);
  portalServer.begin();

  portalActive = true;
  wasConnecting = false;
  activeWifiSource = WifiSource::NONE;
  initialNetworkSetup = false;
  systemMode = SystemMode::SETUP;

  Serial.println("[network] Starting captive portal");
  Serial.print("[portal] AP started SSID=");
  Serial.print(SETUP_AP_SSID);
  Serial.print(" IP=");
  Serial.println(WiFi.softAPIP());
  Serial.println("[portal] WebServer ready");
}

void stopSetupPortalForActiveSession() {
  dnsServer.stop();
  portalServer.stop();
  portalActive = false;
  portalOfflinePending = false;
  initialNetworkSetup = false;
  wasConnecting = false;
  systemMode = SystemMode::OFFLINE;
  Serial.println("[portal] Captive portal suppressed: active session reason=portal already active");

  if (savedWifiSsid.length() > 0) {
    startWiFiConnection(savedWifiSsid, savedWifiPassword, WifiSource::SAVED, true);
  } else {
    WiFi.mode(WIFI_STA);
    lastReconnectAttemptMs = millis();
  }
}

void startWiFiConnection(const String& ssid, const String& password, WifiSource source, bool background) {
  activeWifiSsid = ssid;
  activeWifiPassword = password;
  activeWifiSource = source;
  WiFi.mode(WIFI_STA);
  WiFi.begin(activeWifiSsid.c_str(), activeWifiPassword.c_str());
  systemMode = background || isSessionBusyForNetwork() ? SystemMode::OFFLINE : SystemMode::TRANSITION;
  lastReconnectAttemptMs = millis();
  connectStartedAtMs = millis();
  wasConnecting = true;

  if (background) {
    Serial.println("[network] Background reconnect attempt...");
  } else if (source == WifiSource::SAVED) {
    Serial.println("[network] Trying saved WiFi...");
  } else if (source == WifiSource::FALLBACK) {
    Serial.println("[network] Trying credentials.h fallback WiFi...");
  }
}

bool credentialsFallbackAvailable() {
  return WIFI_SSID != nullptr && WIFI_SSID[0] != '\0';
}

void updateBootButton() {
  if (!bootComplete) {
    return;
  }

  const bool pressed = digitalRead(Config::BUTTON_PIN) == LOW;
  if (!pressed) {
    if (bootButtonPressedAtMs > 0 && bootButtonArmed) {
      const unsigned long heldMs = millis() - bootButtonPressedAtMs;
      if (heldMs >= BOOT_ENTER_OFFLINE_MS) {
        offlineModeEnter(OfflineEntryReason::BOOT_10S);
      } else if (heldMs >= BOOT_CLEAR_WIFI_MS) {
        Serial.println("[network] BOOT 5s release detected, clearing WiFi");
        clearWiFiCredentials();
        scheduleRestart();
      } else if (heldMs >= BOOT_NEXT_ATTEMPT_MS) {
        if (offlineModeCanStartNextAttempt()) {
          offlineModeStartNextAttempt(false);
        }
      }
    }
    bootButtonPressedAtMs = 0;
    bootButtonArmed = true;
    return;
  }

  if (!bootButtonArmed) {
    return;
  }

  if (bootButtonPressedAtMs == 0) {
    bootButtonPressedAtMs = millis();
    return;
  }
}
}

void networkBegin() {
  pinMode(Config::BUTTON_PIN, INPUT_PULLUP);
  bootButtonArmed = digitalRead(Config::BUTTON_PIN) == HIGH;
  Serial.println("[network] Normal reset, keeping saved WiFi");
  Serial.println("[network] Checking saved WiFi credentials...");

  if (loadSavedWiFiCredentials(savedWifiSsid, savedWifiPassword)) {
    startWiFiConnection(savedWifiSsid, savedWifiPassword, WifiSource::SAVED, isSessionBusyForNetwork());
    return;
  }

  Serial.println("[network] No saved WiFi, starting setup portal");
  startSetupPortal("boot no WiFi credentials");
}

void networkUpdate() {
  updateBootButton();

  if (restartPending && millis() >= restartAtMs) {
    ESP.restart();
  }

  if (portalActive) {
    if (isSessionBusyForNetwork()) {
      stopSetupPortalForActiveSession();
      return;
    }
    dnsServer.processNextRequest();
    portalServer.handleClient();
    if (portalOfflinePending && millis() >= portalOfflineAtMs) {
      portalOfflinePending = false;
      offlineModeEnter(OfflineEntryReason::CAPTIVE_PORTAL);
      return;
    }
    systemMode = SystemMode::SETUP;
    return;
  }

  const bool connected = networkIsConnected();
  if (connected != wasConnected) {
    wasConnected = connected;
    systemMode = connected ? SystemMode::ONLINE : SystemMode::OFFLINE;
    if (connected) {
      initialNetworkSetup = false;
      if (sessionData.state == SessionState::MONITORING || sessionData.state == SessionState::WAITING_LOAD) {
        Serial.println("[network] WiFi reconnected, continuing active session");
      } else if (activeWifiSource == WifiSource::SAVED) {
        Serial.println("[network] Saved WiFi connected");
      } else if (activeWifiSource == WifiSource::FALLBACK) {
        Serial.println("[network] Fallback WiFi connected");
      } else {
        Serial.println("[network] WiFi reconnected");
      }
      Serial.print("[network] IP=");
      Serial.println(WiFi.localIP());
      if (sessionData.state == SessionState::MONITORING) {
        Serial.println("[session] Continuing active session after reconnect");
      }
    } else {
      if (isSessionBusyForNetwork()) {
        Serial.println("[network] WiFi lost during active session, continuing OFFLINE");
        Serial.println("[portal] Captive portal suppressed: active session");
      } else {
        Serial.println("[network] WiFi lost, switching to OFFLINE");
      }
    }
  }

  if (!connected && wasConnecting && millis() - connectStartedAtMs >= WIFI_CONNECT_TIMEOUT_MS) {
    if (isSessionBusyForNetwork()) {
      Serial.println("[network] Background reconnect failed, will retry");
      wasConnecting = false;
      systemMode = SystemMode::OFFLINE;
      return;
    }

    if (activeWifiSource == WifiSource::SAVED) {
      Serial.println("[network] Saved WiFi failed");
    } else if (activeWifiSource == WifiSource::FALLBACK) {
      Serial.println("[network] Fallback WiFi failed");
    }

    if (!initialNetworkSetup) {
      Serial.println("[network] WiFi reconnect failed, will retry");
      wasConnecting = false;
      systemMode = SystemMode::OFFLINE;
      return;
    }

    initialNetworkSetup = false;
    startSetupPortal("WiFi failed");
    return;
  }

  if (!connected && !wasConnecting && millis() - lastReconnectAttemptMs >= WIFI_RECONNECT_INTERVAL_MS) {
    lastReconnectAttemptMs = millis();
    const bool background = isSessionBusyForNetwork();
    if (background) {
      Serial.println("[network] Background reconnect attempt...");
    } else {
      Serial.println("[network] Reconnecting WiFi...");
    }
    WiFi.disconnect(false, false);
    if (background && savedWifiSsid.length() > 0) {
      activeWifiSsid = savedWifiSsid;
      activeWifiPassword = savedWifiPassword;
      activeWifiSource = WifiSource::SAVED;
    }
    WiFi.begin(activeWifiSsid.c_str(), activeWifiPassword.c_str());
    connectStartedAtMs = millis();
    wasConnecting = true;
    systemMode = background ? SystemMode::OFFLINE : SystemMode::TRANSITION;
  }

  if (connected) {
    wasConnecting = false;
  }
}

bool networkIsConnected() {
  return !portalActive && WiFi.status() == WL_CONNECTED;
}

bool networkIsPortalActive() {
  return portalActive;
}

void networkStopPortalForOffline() {
  if (portalActive) {
    portalServer.stop();
    dnsServer.stop();
    portalActive = false;
    Serial.println("[portal] Captive portal stopped for offline mode");
  }

  WiFi.disconnect(false, false);
  wasConnecting = false;
  initialNetworkSetup = false;
  lastReconnectAttemptMs = millis();
  systemMode = SystemMode::OFFLINE;
}

void networkMarkBootComplete() {
  bootComplete = true;
}

bool loadSavedWiFiCredentials(String& ssid, String& pass) {
  Preferences prefs;
  if (!prefs.begin(PREF_NAMESPACE, true)) {
    Serial.println("[network] No saved WiFi credentials");
    return false;
  }

  ssid = prefs.getString(PREF_KEY_WIFI_SSID, "");
  pass = prefs.getString(PREF_KEY_WIFI_PASS, "");
  prefs.end();

  if (ssid.length() == 0) {
    Serial.println("[network] No saved WiFi credentials");
    return false;
  }

  Serial.print("[network] Saved WiFi found: ");
  Serial.println(ssid);
  return true;
}

void saveWiFiCredentials(const String& ssid, const String& password) {
  Preferences prefs;
  if (!prefs.begin(PREF_NAMESPACE, false)) {
    Serial.println("[network] Failed to open Preferences for WiFi save");
    return;
  }

  prefs.putString(PREF_KEY_WIFI_SSID, ssid);
  prefs.putString(PREF_KEY_WIFI_PASS, password);
  prefs.end();
  savedWifiSsid = ssid;
  savedWifiPassword = password;
}

void clearWiFiCredentials() {
  Preferences prefs;
  if (!prefs.begin(PREF_NAMESPACE, false)) {
    Serial.println("[network] Failed to open Preferences for WiFi clear");
    return;
  }

  prefs.remove(PREF_KEY_WIFI_SSID);
  prefs.remove(PREF_KEY_WIFI_PASS);
  prefs.end();
  savedWifiSsid = "";
  savedWifiPassword = "";
  Serial.println("[network] saved WiFi cleared");
}

bool hasSavedWiFiCredentials() {
  Preferences prefs;
  if (!prefs.begin(PREF_NAMESPACE, true)) {
    return false;
  }
  const bool hasSsid = prefs.getString(PREF_KEY_WIFI_SSID, "").length() > 0;
  prefs.end();
  return hasSsid;
}

void printSavedWiFiStatus() {
  String ssid;
  String pass;
  const bool hasSaved = loadSavedWiFiCredentials(ssid, pass);
  Serial.print("[network] Saved WiFi: ");
  Serial.println(hasSaved ? "yes" : "no");
  if (hasSaved) {
    Serial.print("[network] Saved SSID: ");
    Serial.println(ssid);
  }
  Serial.print("[network] Fallback credentials.h SSID: ");
  Serial.println(credentialsFallbackAvailable() ? WIFI_SSID : "no");
}

void loadLocalConfig() {
  Preferences prefs;
  if (!prefs.begin(PREF_NAMESPACE, true)) {
    return;
  }

  appConfig.tariffPerKwh = prefs.getFloat(PREF_KEY_TARIFF, appConfig.tariffPerKwh > 0.0f ? appConfig.tariffPerKwh : Config::DEFAULT_TARIFF);
  appConfig.overloadThresholdW = prefs.getFloat(PREF_KEY_OVERLOAD, appConfig.overloadThresholdW > 0.0f ? appConfig.overloadThresholdW : Config::OVERLOAD_THRESHOLD_W);
  prefs.end();
}

void saveLocalConfig() {
  Preferences prefs;
  if (!prefs.begin(PREF_NAMESPACE, false)) {
    Serial.println("[network] Failed to open Preferences for config save");
    return;
  }

  prefs.putFloat(PREF_KEY_TARIFF, appConfig.tariffPerKwh > 0.0f ? appConfig.tariffPerKwh : Config::DEFAULT_TARIFF);
  prefs.putFloat(PREF_KEY_OVERLOAD, appConfig.overloadThresholdW > 0.0f ? appConfig.overloadThresholdW : Config::OVERLOAD_THRESHOLD_W);
  prefs.end();
}
