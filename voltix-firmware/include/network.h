#pragma once

#include <Arduino.h>

void networkBegin();
void networkUpdate();
bool networkIsConnected();
bool networkIsPortalActive();
bool loadSavedWiFiCredentials();
void saveWiFiCredentials(const String& ssid, const String& password);
void clearWiFiCredentials();
bool hasSavedWiFiCredentials();
void loadLocalConfig();
void saveLocalConfig();
