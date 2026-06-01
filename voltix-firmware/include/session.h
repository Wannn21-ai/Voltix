#pragma once

#include <Arduino.h>
#include "types.h"

void sessionBegin();
void sessionStart(const char* deviceName);
void sessionSetRemoteContext(const char* uid, const char* sessionId);
void sessionStop(EndReason reason);
void sessionUpdate();
bool sessionIsActive();
void sessionRecoveryBegin();
void sessionRecoveryUpdate();
bool sessionRecoveryIsActive();
const char* sessionRecoveryStatus();
bool sessionWriteCheckpoint();
bool sessionReadCheckpointJson(String& out);
bool sessionClearCheckpoint();
