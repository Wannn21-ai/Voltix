#pragma once

#include <ArduinoJson.h>
#include "state.h"

void firebaseBegin();
void firebasePublishLive();
void firebaseReadConfig();
void firebasePollCommand();
void firebaseAckCommand();
bool firebasePushCompletedSession(const CompletedSessionSnapshot& snapshot);
bool firebasePushCompletedSession(JsonObject entry);
