#include "relay.h"
#include "config.h"

#include <Arduino.h>

static bool relayOn = false;

static int relayLevelFor(bool on) {
  if (Config::RELAY_ACTIVE_LOW) {
    return on ? LOW : HIGH;
  }
  return on ? HIGH : LOW;
}

void relayForceOffEarly() {
  pinMode(Config::RELAY_PIN, OUTPUT);
  digitalWrite(Config::RELAY_PIN, relayLevelFor(false));
  relayOn = false;
  Serial.println("[boot] Relay forced OFF early");
}

void relayBegin() {
  pinMode(Config::RELAY_PIN, OUTPUT);
  digitalWrite(Config::RELAY_PIN, relayLevelFor(false));
  relayOn = false;
  relaySet(false);
  Serial.println("[relay] Initialized, default OFF");
}

void relaySet(bool on) {
  if (relayOn == on) {
    return;
  }
  relayOn = on;
  digitalWrite(Config::RELAY_PIN, relayLevelFor(on));
  Serial.print("[relay] ");
  Serial.println(on ? "ON" : "OFF");
}

bool relayIsOn() {
  return relayOn;
}
