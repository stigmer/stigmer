# Remove GenerateSessionSubject from Python Agent-Runner

**Date**: May 9, 2026

## Summary

Removed `GenerateSessionSubject` from the Python agent-runner's Temporal activity registration. Session subject generation has been moved to a Java local activity in stigmer-service (stigmer-cloud), eliminating the cross-runtime dependency that caused silent failures for Cursor-harness sessions.

## Problem Statement

The Python agent-runner registered `GenerateSessionSubject` as a Temporal activity on the runner's base queue. Cursor-harness sessions dispatched this activity to a queue where no Python worker was polling, causing a silent 5-minute timeout. The session title stayed as "Auto-created session".

## Solution

The activity is now a Java local activity in stigmer-service that runs in-process with the Temporal workflow. The Python registration is no longer needed.

## Implementation Details

- Removed `generate_session_subject` import from `worker.py`
- Removed `generate_session_subject` from the `activities` list in `Worker` initialization
- Updated the activity-list log message to reflect the removal
- The file `generate_session_subject.py` is retained as dead code (cleanup is a separate task)

## Impact

- No behavioral change for the agent-runner — it never receives `GenerateSessionSubject` tasks anymore
- Reduces the agent-runner's activity surface (one fewer activity to register)

## Related Work

- Companion change in stigmer-cloud: new `GenerateSessionSubjectActivityImpl` Java local activity + `LlmCallService`

---

**Status**: Production Ready
