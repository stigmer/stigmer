/**
 * Test-only workflow for sdk-logger.e2e.test.ts: one `log.warn` from the
 * workflow body carrying a scalar and a nested field (a line our code
 * wrote), then one activity that fails on its only attempt (the SDK's own
 * `Activity failed` line).
 *
 * WORKFLOW-BUNDLE IMPORT DISCIPLINE applies (sandbox module).
 */
import { log, proxyActivities } from "@temporalio/workflow";

export const SDK_LOG_PROBE_WORKFLOW = "sdkLogProbe";
export const SDK_LOG_PROBE_ACTIVITY = "SdkLogProbeFailingActivity";
export const SDK_LOG_PROBE_WARNING = "sdk log probe: workflow warning";

const activities = proxyActivities<Record<string, () => Promise<void>>>({
  startToCloseTimeout: "10 seconds",
  retry: { maximumAttempts: 1 },
});

export async function sdkLogProbe(): Promise<void> {
  log.warn(SDK_LOG_PROBE_WARNING, {
    probeCount: 3,
    outcomes: { reaped: 2, kept: 1 },
  });
  await activities[SDK_LOG_PROBE_ACTIVITY]!();
}
