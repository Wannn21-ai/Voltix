#pragma once

#include <Arduino.h>
#include "types.h"

struct AppConfig {
  float tariffPerKwh;
  char currency[8];
  float overloadThresholdW;
  float overloadWarningPercent;
  float loadCurrentThresholdA;
  float loadPowerThresholdW;
  unsigned long loadRemovedDelaySec;
  unsigned long offlineTimeoutSec;
  unsigned long checkpointIntervalSec;
  char deviceName[32];
};

struct SensorData {
  float voltage;
  float current;
  float power;
  float energy;
  float frequency;
  float powerFactor;
  bool valid;
  bool loadDetected;
  unsigned long lastReadMs;
};

struct SessionData {
  SessionState state;
  EndReason endReason;
  char sessionId[24];
  char uid[64];
  char deviceName[32];
  SystemMode startMode;
  unsigned long startedAtMs;
  unsigned long endedAtMs;
  unsigned long lastUpdateMs;
  unsigned long durationMs;
  float startEnergyKwh;
  float energyWh;
  float energyKwh;
  float cost;
  float averagePowerW;
  float peakPowerW;
  bool pendingSync;
};

struct CompletedSessionSnapshot {
  char id[24];
  char sessionId[24];
  char uid[64];
  char deviceName[32];
  unsigned long startMillis;
  unsigned long stopMillis;
  unsigned long durationSec;
  float energyWh;
  float energyKwh;
  float cost;
  float averagePower;
  float peakPower;
  float voltage;
  float current;
  float frequency;
  float powerFactor;
  float tariff;
  const char* currency;
  EndReason endReason;
  SystemMode startMode;
  SystemMode endMode;
  char date[11];
  char time[9];
  uint64_t timestamp;
  bool recovered;
  const char* recoverySource;
};

struct ActiveSessionCheckpoint {
  char sessionId[24];
  char uid[64];
  char deviceName[32];
  bool active;
  SessionState sessionState;
  unsigned long startMillis;
  uint64_t startUnixMs;
  unsigned long elapsedSec;
  float energyWh;
  float energyKwh;
  float cost;
  float peakPower;
  float averagePower;
  float tariff;
  char currency[8];
  float overloadThreshold;
  SystemMode startMode;
  unsigned long lastCheckpointMs;
  bool relayState;
  char createdFrom[32];
};

extern AppConfig appConfig;
extern SensorData sensorData;
extern SessionData sessionData;
extern SystemMode systemMode;

void stateBegin();
