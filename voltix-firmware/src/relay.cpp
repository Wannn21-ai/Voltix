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

void relayBegin() {
  pinMode(Config::RELAY_PIN, OUTPUT);
  relaySet(false);
  Serial.println("[relay] Initialized, default OFF");
}

void relaySet(bool on) {
  relayOn = on;
  digitalWrite(Config::RELAY_PIN, relayLevelFor(on));
  Serial.print("[relay] ");
  Serial.println(on ? "ON" : "OFF");
}

bool relayIsOn() {
  return relayOn;
}
