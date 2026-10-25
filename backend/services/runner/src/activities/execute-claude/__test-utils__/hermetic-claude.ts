/**
 * The Claude slice of the hermetic activity driver: the fixture record, the
 * runner's `Config`, and the REAL `ExecuteClaude` activity, run the way the
 * composition roots run it — the real adapter in an agent host behind the
 * remote adapter (`__test-utils__/loopback-host.ts`), bound to its pinned
 * activity name by `createHarnessActivities` — over the real engine, which
 * talks to the wire-level mock through the real proxy (`claude-wire.ts`).
 *
 * What a scenario file must carry, hoisted by vitest so it cannot live here:
 *
 * ```ts
 * vi.mock("../../../../client/stigmer-client.js", async () =>
 *   (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule());
 * ```
 *
 * The posture is a cloud runner's, the one every hermetic Claude run takes:
 * the runner forwards its model calls to the platform (the mock stands for
 * it), so the agent host's model lane is the local proxy and the engine's
 * credential is its turn's key. The conversation is kept on disk
 * (`sqlite`, the local default), so a session's next invocation resumes from
 * the store as a runner on another machine would from the platform's.
 *
 * The thread id is `thread-{sessionId}` on every invocation, the first
 * included: Claude's state id is derived, as native's is
 * (`invoke-agent-execution.ts` runs `EnsureThread` once).
 */

import { rmSync } from "node:fs";
import { join } from "node:path";

import type { Config } from "../../../config.js";
import type { ExecuteActivityInput } from "../../../shared/activity-input.js";
import { _resetRegistryCache } from "../../../shared/model-registry.js";
import { _resetPricingCache } from "../../../shared/model-pricing-data.js";
import { getClaudeEngineDir } from "../../../shared/workspace/platform-dir.js";
import {
  ExecutionRecord,
  bindHermeticClient,
  runActivityHermetically,
  type ActivityInvocation,
  type HermeticEnvironment,
  type InvocationControls,
  type ScriptedClock,
} from "../../../__test-utils__/hermetic-activity.js";
import { DEFAULT_RECORD_IDS, executionRecordFixture, type ExecutionRecordOptions } from "../../../__test-utils__/execution-record-fixture.js";
import { FIXTURE_CLAUDE_MODEL } from "../../../__test-utils__/model-registry-fixture.js";
import type { AgentProxy } from "../../../agent-proxy/server.js";
import { stubRegistryFetch } from "../../../__test-utils__/model-registry-fixture.js";
import { anthropicText, startClaudeWire, type ClaudeWire, type WireScript } from "./claude-wire.js";

const SESSION_ID = "ses_claude_0001";

export const FIXTURE = {
  org: "hermetic-org",
  executionId: "aex_claude_0001",
  sessionId: SESSION_ID,
  agentId: "agt_claude_0001",
  agentName: "hermetic-claude-agent",
  agentVersionHash: DEFAULT_RECORD_IDS.agentVersionHash,
  model: FIXTURE_CLAUDE_MODEL,
  threadId: `thread-${SESSION_ID}`,
} as const;

/** The record's knobs, under the Claude fixture ids; `executionId` names a later message's own run. */
export type ClaudeRecordOptions = Omit<ExecutionRecordOptions, "ids"> & { readonly executionId?: string };

/** The three resources of one execution, wired by id. */
export function claudeExecutionRecord(options: ClaudeRecordOptions): ExecutionRecord {
  return executionRecordFixture({
    ...options,
    modelName: options.modelName ?? FIXTURE.model,
    ids: {
      org: FIXTURE.org,
      executionId: options.executionId ?? FIXTURE.executionId,
      sessionId: FIXTURE.sessionId,
      agentId: FIXTURE.agentId,
      agentName: FIXTURE.agentName,
      agentVersionHash: FIXTURE.agentVersionHash,
    },
  });
}

/** The cloud-runner posture of the header; the proxy endpoint is the platform's stand-in, replaced by the wire's own. */
export function hermeticClaudeConfig(env: HermeticEnvironment, overrides: Partial<Config> = {}): Config {
  return {
    taskQueue: "hermetic-test-queue",
    temporalAddress: "localhost:7233",
    temporalNamespace: "default",
    temporalConnection: {},
    stigmerBackendEndpoint: "http://localhost:7234",
    mcpBridgeEndpoint: null,
    mcpPublicEndpoint: null,
    // No runner credential, as on a trusted local runner: the proxy forwards
    // with its own (`claude-wire.ts`), and a held one would turn the platform's
    // own tools off for want of a run-scoped exchange the double never answers.
    stigmerTokenRef: { current: null },
    cursorApiKey: "",
    workspaceRootDir: env.workspaceRootDir,
    mode: "local",
    proxyEndpoint: "http://platform.invalid",
    maxConcurrentActivities: 1,
    idleTimeoutSeconds: null,
    cloudModeEnabled: false,
    checkpointerType: "sqlite",
    checkpointerProxyEndpoint: null,
    artifactProxyEndpoint: null,
    primaryModel: FIXTURE.model,
    cursorStreamStallTimeoutMs: 180_000,
    openOperationMaxMs: 3_600_000,
    livenessIntervalMs: 30_000,
    shellTimeoutMaxSeconds: 3_300,
    agentResolveTimeoutMs: 120_000,
    workspaceLockTimeoutMs: 900_000,
    drainGraceMs: 0,
    ...overrides,
  };
}

/** The primary workspace directory of a session with no workspace entries (`session-root.ts`). */
export function sessionWorkspaceDir(env: HermeticEnvironment): string {
  return join(env.workspaceRootDir, "sessions", FIXTURE.sessionId);
}

/** Start a session afresh: the module caches, the engine's saved conversation and the workspace dropped. */
export function resetClaudeScenarioState(env: HermeticEnvironment): void {
  _resetRegistryCache();
  _resetPricingCache();
  rmSync(getClaudeEngineDir(FIXTURE.sessionId), { recursive: true, force: true });
  rmSync(sessionWorkspaceDir(env), { recursive: true, force: true });
}

/** The `ExecuteClaude` activity behind `proxy`, booted on `config`. */
export async function claudeActivity(config: Config, proxy: AgentProxy): Promise<(arg0: ExecuteActivityInput | string, arg1?: string) => Promise<unknown>> {
  const { createClaudeAdapter } = await import("../adapter.js");
  const { createHarnessActivities } = await import("../../../harness/registry.js");
  const { loopbackHostedRow } = await import("../../../__test-utils__/loopback-host.js");
  const row = loopbackHostedRow({ harness: "claude", adapter: createClaudeAdapter() }, { proxy });
  await row.adapter.boot(config);
  const activities = await createHarnessActivities([row], config);
  return activities.ExecuteClaude!;
}

export interface ClaudeTurnOptions {
  readonly executionId?: string;
  readonly turnSeq?: number;
  readonly onControls?: (controls: InvocationControls) => void;
}

/** Run ONE `ExecuteClaude` invocation of `record`'s execution. */
export async function runClaudeInvocation(
  config: Config,
  proxy: AgentProxy,
  record: ExecutionRecord,
  options: ClaudeTurnOptions = {},
): Promise<ActivityInvocation> {
  const activity = await claudeActivity(config, proxy);
  const input: ExecuteActivityInput = {
    execution_id: options.executionId ?? record.executionId,
    thread_id: FIXTURE.threadId,
    turn_seq: options.turnSeq ?? 0,
  };
  return runActivityHermetically(activity, [input], {
    taskQueue: config.taskQueue,
    ...(options.onControls !== undefined ? { onControls: options.onControls } : {}),
  });
}

/**
 * One scenario file's stack: the wire (the mock behind the real proxy), the
 * registry stub and the scripted clock, started once in `beforeAll` and
 * closed in `afterAll`; each scenario then runs one invocation on a fresh
 * session with its own script.
 */
export interface ClaudeScenarioFile {
  readonly config: Config;
  readonly wire: () => ClaudeWire;
  readonly registryUrls: () => readonly string[];
  start(): Promise<void>;
  stop(): Promise<void>;
  /** A fresh session (`resetClaudeScenarioState`), `script` answering, `record` bound, then one invocation. */
  run(record: ExecutionRecord, script: WireScript, options?: ClaudeTurnOptions): Promise<ActivityInvocation>;
  /** The session's next invocation, its saved conversation kept. */
  resume(record: ExecutionRecord, script: WireScript, options?: ClaudeTurnOptions): Promise<ActivityInvocation>;
}

export function claudeScenarioFile(env: HermeticEnvironment, clock: ScriptedClock, overrides: Partial<Config> = {}): ClaudeScenarioFile {
  const config = hermeticClaudeConfig(env, overrides);
  let wire: ClaudeWire | undefined;
  let registry: ReturnType<typeof stubRegistryFetch> | undefined;
  const invoke = async (record: ExecutionRecord, script: WireScript, options: ClaudeTurnOptions): Promise<ActivityInvocation> => {
    wire!.script(script);
    bindHermeticClient(record.client());
    return runClaudeInvocation(config, wire!.proxy, record, options);
  };
  return {
    config,
    wire: () => wire!,
    registryUrls: () => registry?.urls ?? [],
    async start() {
      registry = stubRegistryFetch();
      wire = await startClaudeWire(config, () => anthropicText(""));
      clock.install();
    },
    async stop() {
      clock.uninstall();
      registry?.restore();
      await wire?.close();
      env.dispose();
    },
    async run(record, script, options = {}) {
      clock.reset();
      resetClaudeScenarioState(env);
      wire!.conversations.length = 0;
      return invoke(record, script, options);
    },
    async resume(record, script, options = {}) {
      return invoke(record, script, options);
    },
  };
}
