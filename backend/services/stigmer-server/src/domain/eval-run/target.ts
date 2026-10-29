/**
 * An agent's default target in an eval run, the one rule create counts
 * tries by and the eval run's workflow plans them by (temporal/evals/
 * context.ts), so
 * the two always agree: with no target named, a try runs the agent as a
 * conversation runs it, on its engine (Stigmer when it names none), with its
 * model as the label; the try names no model (domain/eval-run/matrix.ts
 * runsAgentModel), so the agent's own tier and thinking apply.
 *
 * Proven through __tests__/steps.test.ts and
 * temporal/evals/__tests__/agent-subject-activities.test.ts.
 */
import type { AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import type { AgentTarget } from "./matrix.js";

/** The agent version's default target (the module header). */
export function agentTargetOf(spec: AgentSpec | undefined): AgentTarget {
  return {
    harness: spec === undefined || spec.harness === Harness.UNSPECIFIED ? Harness.STIGMER : spec.harness,
    modelName: spec?.runConfig?.modelName ?? "",
  };
}
