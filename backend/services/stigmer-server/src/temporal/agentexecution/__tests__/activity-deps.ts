/**
 * The worker's sandbox deps for an activity test that ensures no sandbox:
 * no provisioner composed (the lane disabled), the trusted-local posture
 * and the OSS default routing, so EnsureSessionSandbox answers `skipped`
 * and every other activity is untouched by them.
 */
import {
  AgentExecutionTemporalConfig,
  DEFAULT_EXECUTION_TARGET_LOCAL,
  ROUTING_GLOBAL,
} from "../../../domain/run/temporal/config.js";
import type { AgentExecutionActivityDeps } from "../activities.js";
import { DEFAULT_ACTIVITY_TASK_QUEUE } from "../names.js";

export const WITHOUT_SANDBOX: Pick<AgentExecutionActivityDeps, "sandboxLane" | "personAccounts" | "temporalConfig"> = {
  sandboxLane: { enabled: false },
  personAccounts: undefined,
  temporalConfig: new AgentExecutionTemporalConfig(
    "agent_execution_stigmer",
    DEFAULT_ACTIVITY_TASK_QUEUE,
    ROUTING_GLOBAL,
    DEFAULT_EXECUTION_TARGET_LOCAL,
  ),
};
