/**
 * The native (deep-agent) slice of the hermetic activity driver: build the
 * fixture record, bind the scripted model and the `Config`, run the REAL
 * `ExecuteDeepAgent` activity under `MockActivityEnvironment` with the REAL
 * deepagents graph, and hand back what it persisted.
 *
 * Layering (the `approval-contract/` + `gateway-substrate.ts` split): everything
 * harness-agnostic lives in `src/__test-utils__/hermetic-activity.ts` (the
 * activity environment, the execution record behind the client, the temp
 * `~/.stigmer`, the ticking clock, the shutdown signal) and its fixtures
 * (`execution-record-fixture.ts`, `model-registry-fixture.ts`,
 * `git-workspace-fixture.ts`). This module adds only what is native's: the
 * scripted model as the one LLM (`scripted-model.ts`, reached through the
 * `shared/model-client.ts` double), the native `Config` slice with its
 * checkpointer, the per-scenario reset of module caches and of the session's
 * durable state, and the production wire shape of the activity input.
 *
 * What the two `vi.mock` calls a scenario file must carry look like — they are
 * hoisted by vitest and so cannot live here:
 *
 * ```ts
 * vi.mock("../../../../shared/model-client.js", async () =>
 *   (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule());
 * vi.mock("../../../../client/stigmer-client.js", async () =>
 *   (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule());
 * ```
 *
 * Two facts about this harness the driver encodes, both read from production:
 *
 *  - `thread_id` is `thread-{sessionId}` on EVERY invocation, the first
 *    included (`invoke-agent-execution.ts` runs `EnsureThread` once and passes
 *    the same id to `firstInvoke` and every `reinvoke`; `ensure-thread.ts`
 *    derives it from the session). Cursor's driver sends `""` on a first turn
 *    because Cursor's engine mints its own id; copying that here would key the
 *    sqlite checkpoint on `""` in turn 1 and look it up under `thread-…` in
 *    turn 2. A scenario overrides the default only to stage the empty-id edge.
 *  - The `memory` checkpointer is recreated empty per invocation
 *    (`checkpointer/factory.ts`), so a HITL reinvocation REPLAYS the graph; the
 *    `sqlite` checkpointer keys one file per session under `~/.stigmer`, so a
 *    reinvocation RESUMES from the interrupt — the durable posture with no
 *    network. A scenario picks one; the HITL arms record both.
 *
 * The ONE knowledge of production this driver holds is `activityFactory`: how
 * to obtain the `ExecuteDeepAgent` function from a `Config`. Since #1096 it
 * is the harness registry's: the native adapter booted and bound to its
 * byte-pinned activity name through `createHarnessActivities`, exactly the
 * way the composition roots bind it since #1096 through `harness-adapters.ts`
 * (and the way the Cursor driver binds its own, `hermetic-cursor.ts`). The
 * orchestrator this adapter replaced (`index.ts`, `setup.ts`) was deleted in
 * #1096; the goldens moved once, with the flip onto the runtime, each hunk
 * quoted with its reason in its test's header, and the switch of the roots
 * moved none.
 *
 * `boot` registers the deepagents harness profiles as production does
 * (found in #1096: the orchestrator-driven runs never did, so deepagents
 * auto-injected its ungated `general-purpose` sub-agent into every earlier
 * scenario; the scripted model never delegated to it).
 *
 * Determinism beyond the Cursor driver's (#1048): the clock ticks once per model turn (the scripted
 * model's `onTurn`), so status timestamps and the persist cadence land on the
 * same instants every run; a scenario's interruption (pause, worker shutdown)
 * is scheduled on a model turn through the same hook, never on a timer. And
 * a turn does not begin — the clock does not tick — until the loop has
 * persisted the previous turn's tool results settled
 * (`ExecutionRecord.whenToolCallsSettled`): the ground a real model's latency
 * gives for free, without which the producer runs ahead of a consumer that is
 * awaiting a slow persist and the stamps of one turn straddle the next tick.
 */

import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Config } from "../../../config.js";
import type { StigmerClient } from "../../../client/stigmer-client.js";
import type { ExecuteActivityInput } from "../../../shared/activity-input.js";
import { getCheckpointDbPath } from "../../../shared/workspace/platform-dir.js";
import { _resetRegistryCache } from "../../../shared/model-registry.js";
import { _resetPricingCache } from "../../../shared/model-pricing-data.js";
import {
  ExecutionRecord,
  ScriptedClock,
  bindHermeticClient,
  runActivityHermetically,
  type ActivityInvocation,
  type HermeticEnvironment,
  type InvocationControls,
} from "../../../__test-utils__/hermetic-activity.js";
import { executionRecordFixture, type ExecutionRecordOptions } from "../../../__test-utils__/execution-record-fixture.js";
import { FIXTURE_NATIVE_MODEL } from "../../../__test-utils__/model-registry-fixture.js";
import { ScriptedModel, type ScriptSelector, type ScriptedTurnInfo } from "./scripted-model.js";
import { bindScriptedModel } from "./scripted-model-module.js";

// ---------------------------------------------------------------------------
// Fixture ids — fixed so goldens are readable and byte-stable
// ---------------------------------------------------------------------------

const SESSION_ID = "ses_hermetic_0001";

export const FIXTURE = {
  org: "hermetic-org",
  executionId: "aex_hermetic_0001",
  sessionId: SESSION_ID,
  agentInstanceId: "ain_hermetic_0001",
  agentId: "agt_hermetic_0001",
  agentName: "hermetic-agent",
  /** The pinned model; in the registry document as the native entry. */
  model: FIXTURE_NATIVE_MODEL,
  /** The LangGraph thread id the control plane sends on every invocation (`ensure-thread.ts`). */
  threadId: `thread-${SESSION_ID}`,
} as const;

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/** The record's knobs; the ids and the default model are this harness's fixture. */
export type DeepAgentRecordOptions = Omit<ExecutionRecordOptions, "ids">;

/** The four resources of one execution, wired by id into a chain, under the native fixture ids. */
export function deepAgentExecutionRecord(options: DeepAgentRecordOptions): ExecutionRecord {
  return executionRecordFixture({
    ...options,
    modelName: options.modelName ?? FIXTURE.model,
    ids: {
      org: FIXTURE.org,
      executionId: FIXTURE.executionId,
      sessionId: FIXTURE.sessionId,
      agentInstanceId: FIXTURE.agentInstanceId,
      agentId: FIXTURE.agentId,
      agentName: FIXTURE.agentName,
    },
  });
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type HermeticCheckpointer = "memory" | "sqlite";

/** The OSS/local runner posture: no proxy, local mode, the scenario's checkpointer. */
export function hermeticDeepAgentConfig(env: HermeticEnvironment, checkpointerType: HermeticCheckpointer): Config {
  return {
    taskQueue: "hermetic-test-queue",
    temporalAddress: "localhost:7233",
    temporalNamespace: "default",
    stigmerBackendEndpoint: "http://localhost:7234",
    mcpBridgeEndpoint: null,
    stigmerTokenRef: { current: null },
    cursorApiKey: "",
    workspaceRootDir: env.workspaceRootDir,
    mode: "local",
    proxyEndpoint: null,
    maxConcurrentActivities: 1,
    idleTimeoutSeconds: null,
    cloudModeEnabled: false,
    checkpointerType,
    checkpointerProxyEndpoint: null,
    artifactProxyEndpoint: null,
    primaryModel: FIXTURE.model,
    cursorStreamStallTimeoutMs: 180_000,
    agentResolveTimeoutMs: 120_000,
    workspaceLockTimeoutMs: 900_000,
  };
}

/**
 * The primary workspace directory a session with NO workspace entries runs in
 * (`session-root.ts`: `<workspaceRootDir>/sessions/<sessionId>`). A scenario
 * seeds the files its script reads here.
 */
export function sessionWorkspaceDir(env: HermeticEnvironment): string {
  return join(env.workspaceRootDir, "sessions", FIXTURE.sessionId);
}

// ---------------------------------------------------------------------------
// Running a scenario
// ---------------------------------------------------------------------------

/** The `ExecuteDeepAgent` function as the runner serves it: the typed object OR the legacy positional pair. */
export type ExecuteDeepAgentFn = (arg0: ExecuteActivityInput | string, arg1?: string) => Promise<unknown>;

/** How the driver obtains the activity from a `Config` — the one seam the move onto the runtime flipped. */
export type ActivityFactory = (config: Config) => Promise<ExecuteDeepAgentFn>;

/**
 * The adapter through the registry: `createDeepAgentAdapter()` booted on the
 * scenario's config, bound to `ExecuteDeepAgent` by `createHarnessActivities`
 * over the turn runtime. Imported lazily so the scenario file's `vi.mock`
 * declarations are in force before the engine slice loads the model client
 * and before the registry loads the `StigmerClient` module.
 */
export const runtimeActivityFactory: ActivityFactory = async (config) => {
  const { createDeepAgentAdapter } = await import("../adapter.js");
  const { createHarnessActivities } = await import("../../../harness/registry.js");
  const adapter = createDeepAgentAdapter();
  await adapter.boot(config);
  const activities = await createHarnessActivities([{ harness: "deep-agent", adapter }], config);
  return activities.ExecuteDeepAgent!;
};

/**
 * Drop every module-level cache the harness keeps across invocations and
 * every durable trace the session left behind (its sqlite checkpoint, its
 * session workspace), so a scenario starts where a new session starts.
 * Called at the START of a scenario, never between its invocations: a HITL
 * scenario relies on the sqlite checkpoint surviving from turn 1 into turn 2
 * exactly as it does in a live runner.
 */
export function resetDeepAgentScenarioState(env: HermeticEnvironment): void {
  _resetRegistryCache();
  _resetPricingCache();
  rmSync(dirname(getCheckpointDbPath(FIXTURE.sessionId)), { recursive: true, force: true });
  rmSync(sessionWorkspaceDir(env), { recursive: true, force: true });
}

/** One scenario: the record, the one LLM, the runner it runs on, and the invocation in flight. */
export class DeepAgentScenario {
  /** The controls of the invocation in flight; set by {@link runDeepAgentTurn} before the activity starts. */
  controls: InvocationControls | undefined;
  readonly model: ScriptedModel;

  constructor(
    readonly env: HermeticEnvironment,
    readonly clock: ScriptedClock,
    readonly record: ExecutionRecord,
    /** The runner this scenario runs on: the OSS posture plus the scenario's knobs. */
    readonly config: Config,
    script: ScriptSelector,
    onTurn: DeepAgentScenarioOptions["onTurn"],
  ) {
    this.model = new ScriptedModel(script, [], {
      onTurn: async (info) => {
        // A real model answers long after the loop has folded and persisted
        // the tool results it is answering; a scripted one answers at once and
        // lets the producer run a turn ahead of the consumer. Wait for that
        // ground before ticking, so every stamp of the previous turn precedes
        // this turn's instant, whatever the persist's I/O took (the barrier's
        // own header on `ExecutionRecord` carries the whole reason).
        await this.record.whenToolCallsSettled(info.priorToolCallIds);
        this.clock.tick();
        if (onTurn && this.controls) await onTurn(info, this.controls);
      },
    });
  }
}

export interface DeepAgentScenarioOptions {
  readonly env: HermeticEnvironment;
  readonly clock: ScriptedClock;
  readonly record: ExecutionRecord;
  /** The per-role script the one LLM plays (`scripted-model.ts`). */
  readonly script: ScriptSelector;
  /** `memory` (replay on reinvocation; the OSS default) or `sqlite` (durable resume). Defaults to `memory`. */
  readonly checkpointer?: HermeticCheckpointer;
  /**
   * Runs on every model turn after the clock ticks, with the in-flight
   * invocation's controls: where a scenario stages a user pause or a worker
   * shutdown at a chosen role and round.
   */
  readonly onTurn?: (info: ScriptedTurnInfo, controls: InvocationControls) => void | Promise<void>;
  /**
   * Control-plane facets the scenario opts INTO, or faults it injects, over
   * the record's everyday answers (`ExecutionRecord.client`): a rejecting
   * `getAgent` is how a blueprint-resolution failure is staged.
   */
  readonly clientOverrides?: Partial<StigmerClient>;
  /** Runner knobs over {@link hermeticDeepAgentConfig}: the workspace-lock window, for one. */
  readonly config?: Partial<Config>;
}

/** Bind the record and the model for a scenario; resets the harness's module and session state first. */
export function beginDeepAgentScenario(options: DeepAgentScenarioOptions): DeepAgentScenario {
  resetDeepAgentScenarioState(options.env);
  const scenario = new DeepAgentScenario(
    options.env,
    options.clock,
    options.record,
    { ...hermeticDeepAgentConfig(options.env, options.checkpointer ?? "memory"), ...options.config },
    options.script,
    options.onTurn,
  );
  bindScriptedModel(scenario.model);
  bindHermeticClient(options.record.client(options.clientOverrides));
  return scenario;
}

export interface DeepAgentTurnOptions {
  /** The HITL cycle index (0 on the first turn); mints the change-set id. */
  readonly turnSeq?: number;
  /** Overrides the production thread id ({@link FIXTURE.threadId}) — only to stage the empty-id edge. */
  readonly threadId?: string;
  /** Drive the legacy positional `(executionId, threadId)` wire shape instead of the typed object. */
  readonly positional?: boolean;
  readonly activityFactory?: ActivityFactory;
  readonly onControls?: (controls: InvocationControls) => void;
}

/**
 * Run ONE `ExecuteDeepAgent` invocation for the scenario. Built per invocation
 * (the factory constructs its client, which is the one bound at
 * `beginDeepAgentScenario`).
 */
export async function runDeepAgentTurn(
  scenario: DeepAgentScenario,
  options: DeepAgentTurnOptions = {},
): Promise<ActivityInvocation> {
  const activity = await (options.activityFactory ?? runtimeActivityFactory)(scenario.config);
  const threadId = options.threadId ?? FIXTURE.threadId;
  const turnSeq = options.turnSeq ?? 0;
  const input: ExecuteActivityInput = {
    execution_id: scenario.record.executionId,
    thread_id: threadId,
    turn_seq: turnSeq,
  };
  const args: [ExecuteActivityInput | string, string?] = options.positional
    ? [scenario.record.executionId, threadId]
    : [input];
  return runActivityHermetically(activity, args, {
    taskQueue: scenario.config.taskQueue,
    onControls: (controls) => {
      scenario.controls = controls;
      options.onControls?.(controls);
    },
  });
}
