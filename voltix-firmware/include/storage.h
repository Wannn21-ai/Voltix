#pragma once

#include <Arduino.h>
#include "state.h"

bool storageBegin();
void storageUpdate();
bool storageAppendCompletedSession(const CompletedSessionSnapshot& snapshot);
bool storageReadHistoryJson(String& out);
int storageCountHistory();
bool storageClearHistory();
bool storageMarkSessionQueued(const char* sessionId);
int storageCountPendingHistory();
bool storageSyncPendingHistoryToFirebase();
