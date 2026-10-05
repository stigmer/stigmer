/**
 * ResolveRunConfig — the one place a turn's settings are resolved. It writes
 * the settings the turn runs with (status.run_config) and how it resolves
 * approval gates (status.approval_mode), once, at create; every later
 * reader (the runner, history, billing, recover) reads that answer.
 *
 * Three layers, most specific first (RunConfig's contract in
 * agentexecution/v1/invocation.proto):
 *   1. the turn's own: spec.run_config, which on an edition lane is
 *      replaced by the surface's saved settings (a visitor's own are never
 *      read);
 *   2. the agent's defaults: AgentSpec.run_config of the version the turn
 *      runs (the stamp ResolveRunAgent wrote). Its choices count only when
 *      the conversation runs the engine the agent names (AgentSpec.harness);
 *      on the other engine it gives its bounds alone, because a model name
 *      belongs to an engine and the platform never refuses a model at run
 *      time (pin-validation.ts, oss#774);
 *   3. the lane's operator profile.
 *
 * The rule (resolveRunConfig, pure):
 *   - the model comes from the first layer that names one; none leaves the
 *     model to the engine (the native registry default, Cursor's Auto). The
 *     server never stamps a registry default: it would change what Auto
 *     runs;
 *   - tier and thinking each come from the first layer at or above the
 *     model's layer that sets them, so a less specific layer's choice never
 *     lands on a model it was not written for, and no triple runs that no
 *     layer wrote; with no model they come from the turn alone;
 *   - each bound is the smallest positive value any layer sets, so a
 *     profile is a ceiling the turn and the agent can lower but never raise.
 *
 * Lanes (placeLane): an edition lane answered by drivers.runLanes first
 * (extensions/run-lanes.ts); then the core's own, each keyed on a fact the
 * chain has already vouched for:
 *   - schedule: the reserved schedule label (guard-reserved-labels.ts lets
 *     only the platform write it). The schedule profile, UNATTENDED: nobody
 *     is present at a fire to approve;
 *   - workflow step: a vouched parent link (VouchWorkflowParent). No
 *     profile, INTERACTIVE: the parent workflow takes the approval request;
 *   - interactive: everything else. No profile, INTERACTIVE.
 *
 * The step runs right after AuthorizeRunAgent, so the agent read is the
 * one the caller may run, and before the validators and the pre-side-effect
 * gate slot, so the checks judge what will actually run on every lane and
 * a refusal reserves nothing. It refuses a surface's saved settings that
 * set a tier or thinking with no model of their own (savedChoiceRefusal):
 * saved settings name the model they are for, and only a live message may
 * set either alone. And it refuses an unattended turn that would
 * run Cursor with no model at any layer: the pin-presence rule
 * (temporal/schedule/model-pinning.ts) judged on what will run, closing an
 * agent whose engine is Cursor reached by a schedule that names no engine.
 * CreateSessionIfNeeded resolves again (reResolveRunConfig) when the
 * session it creates pins another version than the stamp did, and judges
 * the result by the same checks.
 *
 * Proven by __tests__/resolve-run-config.test.ts (the rule's table, the
 * lanes, the engine match) and the agent-execution conformance arms.
 */
import { clone, create } from "@bufbuild/protobuf";

import type { AgentSpec } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import {
  AgentExecutionStatusSchema,
  type AgentExecution,
  type AgentExecutionSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ApprovalMode,
  ServiceTier,
  ThinkingMode,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  RunConfigSchema,
  type RunConfig,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/invocation_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

import type { CallerIdentity } from "../../extensions/identity.js";
import type { RunLanes } from "../../extensions/run-lanes.js";
import {
  failedPreconditionError,
  invalidArgumentError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { Store } from "../../store/interface.js";
import { CURSOR_AUTO_PRICE_REASON } from "../../temporal/schedule/model-pinning.js";
import { readRunAgentSpec } from "../agent/run-defaults.js";
import {
  HARNESS_NAME_CURSOR,
  harnessName,
} from "../workflow/registry/pin-validation.js";
import { savedChoiceWithoutModelRefusal } from "../workflow/registry/run-config-checks.js";

import { SCHEDULE_ID_LABEL_KEY } from "./run-person.js";
import { storedSessionOf } from "./session-binding.js";
import { newSessionSpecOf, sessionIdOf } from "./target.js";

type CreateDesc = typeof AgentExecutionSchema;

/** The three layers, most specific first. */
export type RunConfigLayer = "turn" | "agent" | "profile";

/** The resolved settings, and the layer each choice came from (undefined: no layer set it). */
export interface RunConfigResolution {
  readonly config: RunConfig;
  readonly chosenBy: {
    readonly model?: RunConfigLayer;
    readonly serviceTier?: RunConfigLayer;
    readonly thinkingMode?: RunConfigLayer;
  };
}

/**
 * The rule (the module header): choices from the most specific layer that
 * makes one, tier and thinking never below the model's layer, bounds the
 * tightest any layer sets. Pure; zero and empty are "not set".
 */
export function resolveRunConfig(
  turn: RunConfig | undefined,
  agent: RunConfig | undefined,
  profile: RunConfig | undefined,
): RunConfigResolution {
  const layers: ReadonlyArray<readonly [RunConfigLayer, RunConfig | undefined]> = [
    ["turn", turn],
    ["agent", agent],
    ["profile", profile],
  ];
  const config = create(RunConfigSchema);

  const modelIndex = layers.findIndex(
    ([, layer]) => (layer?.modelName ?? "").trim() !== "",
  );
  // With no model, only the turn may set tier and thinking: they then
  // adjust whatever the engine runs, and the checks refuse what needs a
  // model.
  const choiceLayers = layers.slice(0, modelIndex === -1 ? 1 : modelIndex + 1);
  let model: RunConfigLayer | undefined;
  if (modelIndex !== -1) {
    const [name, layer] = layers[modelIndex]!;
    config.modelName = layer!.modelName.trim();
    model = name;
  }
  const tier = choiceLayers.find(
    ([, layer]) => (layer?.serviceTier ?? ServiceTier.UNSPECIFIED) !== ServiceTier.UNSPECIFIED,
  );
  if (tier !== undefined) {
    config.serviceTier = tier[1]!.serviceTier;
  }
  const thinking = choiceLayers.find(
    ([, layer]) => (layer?.thinkingMode ?? ThinkingMode.UNSPECIFIED) !== ThinkingMode.UNSPECIFIED,
  );
  if (thinking !== undefined) {
    config.thinkingMode = thinking[1]!.thinkingMode;
  }

  config.maxCostUsd = tightest(layers.map(([, layer]) => layer?.maxCostUsd ?? 0));
  config.maxToolRounds = tightest(layers.map(([, layer]) => layer?.maxToolRounds ?? 0));
  config.maxToolResultChars = tightest(
    layers.map(([, layer]) => layer?.maxToolResultChars ?? 0),
  );

  return {
    config,
    chosenBy: { model, serviceTier: tier?.[0], thinkingMode: thinking?.[0] },
  };
}

/** The smallest positive value, or 0 when no layer sets one. */
function tightest(values: ReadonlyArray<number>): number {
  const set = values.filter((value) => value > 0);
  return set.length === 0 ? 0 : Math.min(...set);
}

/**
 * The agent layer for a conversation on `harness` (a registry section
 * name): the agent's run defaults whole on the engine they name, their
 * bounds alone on the other. Undefined when the agent has none.
 */
export function agentLayerFor(
  spec: AgentSpec | undefined,
  harness: string,
): RunConfig | undefined {
  const defaults = spec?.runConfig;
  if (defaults === undefined) {
    return undefined;
  }
  if (harnessName(spec?.harness ?? Harness.UNSPECIFIED) === harness) {
    return defaults;
  }
  return create(RunConfigSchema, {
    maxCostUsd: defaults.maxCostUsd,
    maxToolRounds: defaults.maxToolRounds,
    maxToolResultChars: defaults.maxToolResultChars,
  });
}

/**
 * The registry section of the engine the conversation runs on: the stored
 * session's for a turn in an existing session; for a new conversation the
 * engine its session will take (session_spec.harness, else the agent's
 * engine, else native: ResolveSessionAgent's rule). A session id naming no
 * row is the loading steps' refusal and is judged on the default.
 */
export function conversationHarness(
  execution: AgentExecution,
  stored: Session | undefined,
  agentSpec: AgentSpec | undefined,
): string {
  if (sessionIdOf(execution.spec) !== "") {
    return harnessName(stored?.spec?.harness ?? Harness.UNSPECIFIED);
  }
  const requested = newSessionSpecOf(execution.spec)?.harness ?? Harness.UNSPECIFIED;
  if (requested !== Harness.UNSPECIFIED) {
    return harnessName(requested);
  }
  return harnessName(agentSpec?.harness ?? Harness.UNSPECIFIED);
}

/** The lane a turn came through, as the resolution reads it. */
export interface PlacedLane {
  /** The turn's own layer: the request's settings, or the surface's on an edition lane. */
  readonly turn: RunConfig | undefined;
  /** How a refusal names the turn's layer. */
  readonly turnName: string;
  readonly profile: RunConfig | undefined;
  readonly approvalMode: ApprovalMode;
  /** Whether the lane replaced the request's settings with its surface's. */
  readonly replacesRequest: boolean;
  /**
   * Whether the turn's layer is a surface's saved settings (a schedule's, a
   * workflow step's, an edition lane's) rather than a live message's: saved
   * settings name the model their tier or thinking is for.
   */
  readonly saved: boolean;
}

/** One turn's resolution and what it was resolved from: what the checks read. */
export interface RunConfigPlacement {
  readonly lane: PlacedLane;
  /** The registry section of the engine the conversation runs on. */
  readonly harness: string;
  readonly resolution: RunConfigResolution;
  /** The agent version the agent layer was read from. */
  readonly agentId: string;
  readonly agentVersionHash: string;
}

/** The chain key the checks and CreateSessionIfNeeded read the placement under. */
export const RUN_CONFIG_PLACEMENT_KEY = "agentexecution.create.runConfigPlacement";

/** How a refusal names a layer of `placement`. */
export function runConfigLayerName(
  placement: RunConfigPlacement,
  layer: RunConfigLayer | undefined,
): string {
  switch (layer) {
    case "turn":
      return placement.lane.turnName;
    case "agent":
      return "the agent's run defaults (spec.run_config)";
    case "profile":
      return "the lane's operator profile";
    case undefined:
      return "no layer";
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const unreachable: never = layer;
      return unreachable;
    }
  }
}

/** The placement ResolveRunConfig recorded, or undefined in a chain without it. */
export function runConfigPlacementOf(ctx: {
  get(key: string): unknown;
}): RunConfigPlacement | undefined {
  return ctx.get(RUN_CONFIG_PLACEMENT_KEY) as RunConfigPlacement | undefined;
}

/** What ResolveRunConfig reads besides the turn. */
export interface ResolveRunConfigDeps {
  readonly store: Store;
  /** The edition's lanes (drivers.runLanes); undefined in open source. */
  readonly runLanes: RunLanes | undefined;
  /** The schedule lane's operator profile (the fire-time bounds), if any. */
  readonly scheduleProfile: RunConfig | undefined;
}

export function newResolveRunConfigStep(
  deps: ResolveRunConfigDeps,
): PipelineStep<CreateDesc> {
  return {
    name: "ResolveRunConfig",
    async execute(ctx) {
      const execution = ctx.newState;
      const lane = await placeLane(deps, ctx.callerIdentity, execution);
      if (lane.replacesRequest && execution.spec !== undefined) {
        execution.spec.runConfig =
          lane.turn === undefined ? undefined : clone(RunConfigSchema, lane.turn);
      }
      const agentId = execution.status?.agentId ?? "";
      const agentVersionHash = execution.status?.agentVersionHash ?? "";
      const agentSpec = await readRunAgentSpec(deps.store, agentId, agentVersionHash);
      const placement = place(
        lane,
        conversationHarness(execution, storedSessionOf(ctx), agentSpec),
        agentSpec,
        agentId,
        agentVersionHash,
      );
      stampRunConfig(execution, placement);
      ctx.set(RUN_CONFIG_PLACEMENT_KEY, placement);
      const unnamed = savedChoiceRefusal(placement);
      if (unnamed !== "") {
        throw invalidArgumentError(unnamed);
      }
      const refusal = unattendedPinRefusal(placement);
      if (refusal !== "") {
        throw failedPreconditionError(refusal);
      }
    },
  };
}

/**
 * Resolves `placement`'s lane again over another agent version and engine:
 * CreateSessionIfNeeded's answer when the session it created pinned a
 * version the stamp did not (an author saved between the two resolutions).
 * Returns the new placement, already stamped and recorded; the caller runs
 * the checks on it.
 */
export async function reResolveRunConfig(
  ctx: { get(key: string): unknown; set(key: string, value: unknown): void },
  store: Store,
  execution: AgentExecution,
  session: Session,
): Promise<RunConfigPlacement | undefined> {
  const before = runConfigPlacementOf(ctx);
  if (before === undefined) {
    return undefined;
  }
  const agentId = session.status?.agentId ?? "";
  const agentVersionHash = session.status?.agentVersionHash ?? "";
  const harness = harnessName(session.spec?.harness ?? Harness.UNSPECIFIED);
  if (
    agentId === before.agentId &&
    agentVersionHash === before.agentVersionHash &&
    harness === before.harness
  ) {
    return undefined;
  }
  const agentSpec = await readRunAgentSpec(store, agentId, agentVersionHash);
  const placement = place(before.lane, harness, agentSpec, agentId, agentVersionHash);
  stampRunConfig(execution, placement);
  ctx.set(RUN_CONFIG_PLACEMENT_KEY, placement);
  return placement;
}

function place(
  lane: PlacedLane,
  harness: string,
  agentSpec: AgentSpec | undefined,
  agentId: string,
  agentVersionHash: string,
): RunConfigPlacement {
  return {
    lane,
    harness,
    resolution: resolveRunConfig(lane.turn, agentLayerFor(agentSpec, harness), lane.profile),
    agentId,
    agentVersionHash,
  };
}

/** Writes the resolved settings and the lane's approval mode: the one writer of the pair. */
function stampRunConfig(execution: AgentExecution, placement: RunConfigPlacement): void {
  execution.status ??= create(AgentExecutionStatusSchema);
  execution.status.runConfig = clone(RunConfigSchema, placement.resolution.config);
  execution.status.approvalMode = placement.lane.approvalMode;
}

/**
 * The refusal for a surface's saved settings that set a fast tier or
 * thinking with no model of their own, or "". Saved settings name the model
 * they are for (RunConfig's contract): a tier or thinking saved alone would
 * otherwise land on whatever model a less specific layer chose. The surfaces
 * refuse this at save (registry/run-config-checks.ts); this catches rows
 * saved before that rule, and a workflow step's settings composed at run
 * time. Only a live message may set either alone.
 */
export function savedChoiceRefusal(placement: RunConfigPlacement): string {
  if (!placement.lane.saved) {
    return "";
  }
  const reason = savedChoiceWithoutModelRefusal(
    { prefix: "", fieldPath: "run_config" },
    placement.lane.turn,
  );
  return reason === ""
    ? ""
    : `${placement.lane.turnName} sets a speed tier or thinking without a model: ${reason}. ` +
        "Saved settings name the model they are for.";
}

/**
 * The run-time pin-presence refusal, or "": an unattended turn that will
 * run Cursor with no model at any layer would run Auto, priced by the
 * provider account's own setting with nobody watching.
 */
export function unattendedPinRefusal(placement: RunConfigPlacement): string {
  if (
    placement.lane.approvalMode !== ApprovalMode.UNATTENDED ||
    placement.harness !== HARNESS_NAME_CURSOR ||
    placement.resolution.config.modelName !== ""
  ) {
    return "";
  }
  return (
    "an unattended run on the Cursor harness must name a model: set model_name in " +
    `${placement.lane.turnName} or in the agent's run defaults (spec.run_config) — ` +
    CURSOR_AUTO_PRICE_REASON
  );
}

/** The lane of the module header: an edition lane first, then the core's. */
async function placeLane(
  deps: ResolveRunConfigDeps,
  caller: CallerIdentity,
  execution: AgentExecution,
): Promise<PlacedLane> {
  const edition = await deps.runLanes?.laneOf(caller, execution);
  if (edition !== undefined) {
    return {
      turn: edition.settings,
      turnName: edition.settingsName,
      profile: edition.profile,
      // The status field is never UNSPECIFIED: a driver that answers it
      // gets the enum's own default.
      approvalMode:
        edition.approvalMode === ApprovalMode.UNATTENDED
          ? ApprovalMode.UNATTENDED
          : ApprovalMode.INTERACTIVE,
      replacesRequest: true,
      saved: true,
    };
  }
  const turn = execution.spec?.runConfig;
  if ((execution.metadata?.labels[SCHEDULE_ID_LABEL_KEY] ?? "") !== "") {
    return {
      turn,
      turnName: "the schedule's run_config",
      profile: deps.scheduleProfile,
      approvalMode: ApprovalMode.UNATTENDED,
      replacesRequest: false,
      saved: true,
    };
  }
  if (execution.spec?.parent !== undefined) {
    return {
      turn,
      turnName: "the workflow step's run_config",
      profile: undefined,
      approvalMode: ApprovalMode.INTERACTIVE,
      replacesRequest: false,
      saved: true,
    };
  }
  return {
    turn,
    turnName: "the request's run_config",
    profile: undefined,
    approvalMode: ApprovalMode.INTERACTIVE,
    replacesRequest: false,
    saved: false,
  };
}
