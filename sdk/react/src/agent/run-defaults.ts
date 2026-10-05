/**
 * An agent's run defaults as a conversation surface reads them: the
 * engine the author chose (`AgentSpec.harness`) and the model, speed tier
 * and thinking they chose for it (`AgentSpec.run_config`).
 *
 * The server resolves a turn's settings from the message, then these
 * defaults, then the operator profile, and the defaults' choices count
 * only on a conversation that runs the engine the agent names: a model
 * name belongs to one engine. A surface that shows what a message will
 * run has to apply the same rule, so a composer can say "Agent default"
 * exactly where the server would use it and nowhere else. The bounds
 * (cost, tool rounds) are not read here: the server applies them on
 * every engine and no client control depends on them.
 *
 * Pinned by `__tests__/run-defaults.test.ts`.
 */

import type { AgentSpec } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { fromProtoHarness, type HarnessOption } from "../models/harness.js";
import { fromProtoServiceTier, type ServiceTierOption } from "../models/service-tier.js";
import { fromProtoThinkingMode, type ThinkingModeOption } from "../models/thinking-mode.js";

/** The choices an agent's run defaults make for a conversation on its engine. */
export interface AgentRunDefaults {
  /** The model the author chose, as the registry lists it on the agent's engine. */
  readonly modelName: string;
  /** The speed tier the author chose, when they chose one. */
  readonly serviceTier?: ServiceTierOption;
  /** The thinking mode the author chose, when they chose one. */
  readonly thinkingMode?: ThinkingModeOption;
}

/**
 * The engine the agent names, or `undefined` when it names none: a new
 * conversation on the agent starts on it unless the person picks another.
 */
export function agentHarnessOf(spec: AgentSpec | undefined): HarnessOption | undefined {
  const harness = spec?.harness ?? Harness.UNSPECIFIED;
  return harness === Harness.UNSPECIFIED ? undefined : fromProtoHarness(harness);
}

/**
 * The agent's model choices that apply to a conversation running
 * `harness`, or `undefined` when none do: the agent names no model, or
 * names an engine other than the one the conversation runs.
 *
 * @example
 * ```ts
 * const defaults = agentRunDefaultsFor(agent.spec, "native");
 * // { modelName: "claude-sonnet-4.6", thinkingMode: "enabled" }
 * ```
 */
export function agentRunDefaultsFor(
  spec: AgentSpec | undefined,
  harness: HarnessOption,
): AgentRunDefaults | undefined {
  const modelName = spec?.runConfig?.modelName.trim() ?? "";
  if (modelName === "" || agentHarnessOf(spec) !== harness) return undefined;
  const serviceTier = fromProtoServiceTier(spec?.runConfig?.serviceTier);
  const thinkingMode = fromProtoThinkingMode(spec?.runConfig?.thinkingMode);
  return {
    modelName,
    ...(serviceTier !== undefined ? { serviceTier } : {}),
    ...(thinkingMode !== undefined ? { thinkingMode } : {}),
  };
}
