#pragma once

enum class SystemMode {
  BOOT,
  ONLINE,
  OFFLINE,
  TRANSITION
};

enum class SessionState {
  IDLE,
  WAITING_LOAD,
  MONITORING,
  OVERLOAD,
  FINISHING,
  FINISHED
};

enum class EndReason {
  NONE,
  USER_STOP,
  LOAD_REMOVED,
  OVERLOAD,
  NO_LOAD_DETECTED,
  POWER_LOSS_RECOVERY
};

const char* systemModeToString(SystemMode mode);
const char* sessionStateToString(SessionState state);
const char* endReasonToString(EndReason reason);
