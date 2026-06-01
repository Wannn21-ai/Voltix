#pragma once

#include "types.h"

void sessionBegin();
void sessionStart(const char* deviceName);
void sessionSetRemoteContext(const char* uid, const char* sessionId);
void sessionStop(EndReason reason);
void sessionUpdate();
bool sessionIsActive();
