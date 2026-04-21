# Daytona Auto-Stop Re-enabled as Safety Net

**Date**: April 21, 2026

## Summary

Re-enabled Daytona's `autoStopInterval` at 120 minutes (2 hours) as a last-resort safety net behind the Python idle watchdog. Previously disabled (set to 0) due to a discovered behavior where Daytona kills sandboxes based on toolbox API interaction time, not running processes.

## Problem Statement

After Session 12 disabled `autoStopInterval` entirely (set to 0) to prevent Daytona from killing active runners, there was no fallback mechanism if the Python idle watchdog itself failed. A hung process or watchdog bug could leave a Daytona sandbox running indefinitely, leaking resources.

### Pain Points

- No backstop if the Python idle watchdog fails to fire
- Hung processes would leak Daytona sandbox resources indefinitely
- Only Daytona's auto-archive (5 min after stop) provides cleanup, but it requires the sandbox to be stopped first

## Solution

Set `autoStopIntervalMinutes` to 120 (2 hours) instead of 0 (disabled). At 2 hours, the risk of Daytona killing an actively working runner is negligible — the original 5-minute value was dangerous, but no legitimate agent execution should run 2 hours without any Daytona toolbox API interaction.

## Implementation Details

- `RunnerLauncherConfig.java`: default `autoStopIntervalMinutes` changed from `0` to `120`
- `application-runner-launcher.yaml`: env var default changed from `0` to `120`
- Javadoc and YAML comments updated to describe the new role as a safety net

## Benefits

- Layered safety net: Python watchdog (5 min) -> Daytona auto-stop (2h) -> Daytona auto-archive (5 min after stop)
- Hung processes are reclaimed within 2 hours instead of never
- Active runners remain safe (2h is far beyond any normal execution gap)

## Impact

- **Stigmer Service (Cloud)**: Launcher config default change only — no behavioral change for runners that shut down normally via the idle watchdog

## Related Work

- Session 12: Idle self-termination + sandbox cleanup (introduced the 0 value)
- Key Decision 58: Daytona auto-stop disabled (now partially reversed with safe 2h value)

---

**Status**: Production Ready
**Timeline**: Follow-up to Phase 1, Item 14
