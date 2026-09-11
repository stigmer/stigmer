/**
 * The Cursor slice of the hermetic activity driver: build the fixture record,
 * the scripted SDK and the `Config`, run the REAL `ExecuteCursor` activity under
 * `MockActivityEnvironment`, and hand back what it persisted.
 *
 * Layering (the `approval-contract/` + `gateway-substrate.ts` split): everything
 * harness-agnostic lives in `src/__test-utils__/hermetic-activity.ts` (the
 * activity environment, the execution record behind the client, the temp
 * `~/.stigmer`, the ticking clock, the shutdown signal). This module adds only
 * what is Cursor's: the `@cursor/sdk` double, the model catalog and pricing
 * registry the harness reads at setup, the Cursor `Config` slice, and the
 * per-scenario reset of the harness's module-level caches.
 *
 * What the two `vi.mock` calls a scenario file must carry look like — they are
 * hoisted by vitest and so cannot live here:
 *
 * ```ts
 * vi.mock("@cursor/sdk", async () =>
 *   (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSdkModule());
 * vi.mock("../../../../client/stigmer-client.js", async () =>
 *   (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule());
 * ```
 *
 * Network: the registry document and the `fetch` stub that serves it are
 * the runtime's fixtures (`src/__test-utils__/model-registry-fixture.ts`);
 * the record's four resources come from `execution-record-fixture.ts` with
 * this harness's ids and model laid over the defaults.
 *
 * The fixture model is `composer-2.5`, pinned (not Auto) on purpose: Auto short-
 * circuits `resolveServiceTierParams` before the catalog, and a pinned model runs
 * the catalog path, the variant-param pinning, and the `run.wait()` model echo
 * check — more of the production path under the golden.
 *
 * Where a scenario reaches the knobs that drive the terminal table, each on
 * the object that models the thing deciding it: the execution's cost budget
 * and the control plane's STOP answer on the record (`CursorRecordOptions`);
 * a control-plane fault on the client (`clientOverrides`); the runner's stall
 * and lock windows on the scenario's `Config` (`config`); an SDK failure on
 * the SDK double (`ScriptedSdkOptions`); an SDK-side cancel or a mid-stream
 * wedge as an `effect` step on the run. Nothing here is a switch in production
 * code — every knob is a value the production path already reads.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { create } from "@bufbuild/protobuf";
import type { ModelListItem } from "@cursor/sdk";
import {
  LocalPathSourceSchema,
  WorkspaceEntrySchema,
  WorkspaceSourceSchema,
  type WorkspaceEntry,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import type { StigmerClient } from "../../../client/stigmer-client.js";
import type { Config } from "../../../config.js";
import type { ExecuteActivityInput } from "../../../shared/activity-input.js";
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
import { FIXTURE_MODEL } from "../../../__test-utils__/model-registry-fixture.js";
import { _resetAgentSessionCacheForTests } from "../agent-session-cache.js";
import { _resetPricingCache } from "../model-pricing-data.js";
import { resetCatalogCacheForTests } from "../service-tier.js";
import { _resetRegistryCache } from "../../../shared/model-registry.js";
import { ScriptedCursorSdk, bindScriptedSdk, type ScriptedSdkOptions } from "./scripted-sdk.js";

// ---------------------------------------------------------------------------
// Fixture ids — fixed so goldens are readable and byte-stable
// ---------------------------------------------------------------------------

export const FIXTURE = {
  org: "hermetic-org",
  executionId: "aex_hermetic_0001",
  sessionId: "ses_hermetic_0001",
  agentInstanceId: "ain_hermetic_0001",
  agentId: "agt_hermetic_0001",
  agentName: "hermetic-agent",
  /** The pinned model; in the registry fixture AND the SDK catalog below. */
  model: FIXTURE_MODEL,
  cursorApiKey: "hermetic-cursor-api-key",
} as const;

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/** The record's knobs; the ids and the default model are this harness's fixture. */
export type CursorRecordOptions = Omit<ExecutionRecordOptions, "ids">;

/** The four resources of one execution, wired by id into a chain, under the Cursor fixture ids. */
export function cursorExecutionRecord(options: CursorRecordOptions): ExecutionRecord {
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
// The SDK catalog
// ---------------------------------------------------------------------------

/** The SDK catalog entry for the fixture model: both pinnable params declared. */
export const SDK_CATALOG: readonly ModelListItem[] = [
  {
    id: FIXTURE.model,
    displayName: "Composer 2.5",
    parameters: [
      { id: "fast", values: [{ value: "true" }, { value: "false" }] },
      { id: "thinking", values: [{ value: "true" }, { value: "false" }] },
    ],
  },
];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** The OSS/local runner posture: direct Cursor API key, no proxy, local mode. */
export function hermeticCursorConfig(env: HermeticEnvironment): Config {
  return {
    taskQueue: "hermetic-test-queue",
    temporalAddress: "localhost:7233",
    temporalNamespace: "default",
    stigmerBackendEndpoint: "http://localhost:7234",
    mcpBridgeEndpoint: null,
    stigmerToken: null,
    cursorApiKey: FIXTURE.cursorApiKey,
    workspaceRootDir: env.workspaceRootDir,
    mode: "local",
    proxyEndpoint: null,
    maxConcurrentActivities: 1,
    idleTimeoutSeconds: null,
    cloudModeEnabled: false,
    checkpointerType: "memory",
    checkpointerProxyEndpoint: null,
    artifactProxyEndpoint: null,
    primaryModel: FIXTURE.model,
    cursorStreamStallTimeoutMs: 180_000,
    agentResolveTimeoutMs: 120_000,
    workspaceLockTimeoutMs: 900_000,
  };
}

// ---------------------------------------------------------------------------
// The side effects the real SDK performs, for `effect` steps
// ---------------------------------------------------------------------------

/**
 * The primary workspace directory a session with NO workspace entries runs in
 * (`session-root.ts`: `<workspaceRootDir>/sessions/<sessionId>`).
 */
export function sessionWorkspaceDir(env: HermeticEnvironment): string {
  return join(env.workspaceRootDir, "sessions", FIXTURE.sessionId);
}

/**
 * Run the workspace's installed preToolUse hook exactly as the Cursor SDK does:
 * read `<workspaceRoot>/.cursor/hooks.json`, take the `preToolUse` command the
 * gate installed (an absolute path to the runner's own stable bash script under
 * `~/.stigmer/hitl-gate/<key>/`), and run it with the hook input on stdin. The
 * script resolves the CURRENT turn's state file and denial ledger from the
 * active-turn pointer, walks its parent PIDs to confirm this process is the
 * runner, and prints `{"permission":"allow"|"deny"}`. A deny appends to the
 * ledger the activity's stream loop reads.
 *
 * This is the out-of-process half of deny-and-retry, driven by the real script
 * against the real gate the activity installed — not a simulation of either.
 */
export function runWorkspaceHook(
  workspaceRoot: string,
  hookInput: object,
): { readonly permission: "allow" | "deny" | "?"; readonly raw: string } {
  const hooksJsonPath = join(workspaceRoot, ".cursor", "hooks.json");
  const parsed = JSON.parse(readFileSync(hooksJsonPath, "utf-8")) as {
    hooks?: { preToolUse?: Array<{ command: string }> };
  };
  const command = parsed.hooks?.preToolUse?.[0]?.command;
  if (!command) {
    throw new Error(`runWorkspaceHook: no preToolUse hook installed in ${hooksJsonPath}`);
  }
  const raw = execFileSync("bash", [command], { input: JSON.stringify(hookInput) }).toString();
  const permission = raw.includes('"permission":"deny"')
    ? "deny"
    : raw.includes('"permission":"allow"')
      ? "allow"
      : "?";
  return { permission, raw };
}

/**
 * A git work tree with one committed file, for the file-review capture
 * scenario. Author, committer and both dates are pinned so the commit AND tree
 * object ids are byte-stable — a file-review golden may carry them.
 */
export function initGitWorkspace(root: string, files: Record<string, string>): void {
  mkdirSync(root, { recursive: true });
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "hermetic",
    GIT_AUTHOR_EMAIL: "hermetic@stigmer.test",
    GIT_COMMITTER_NAME: "hermetic",
    GIT_COMMITTER_EMAIL: "hermetic@stigmer.test",
    GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
  };
  const git = (args: string[]): void => {
    execFileSync("git", args, { cwd: root, env: gitEnv, stdio: "ignore" });
  };
  git(["init", "-q", "-b", "main"]);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf-8");
  }
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "initial"]);
}

/** A session workspace entry mounting an absolute local path (local mode only). */
export function localPathEntry(name: string, path: string): WorkspaceEntry {
  return create(WorkspaceEntrySchema, {
    name,
    source: create(WorkspaceSourceSchema, {
      source: { case: "localPath", value: create(LocalPathSourceSchema, { path }) },
    }),
  });
}

// ---------------------------------------------------------------------------
// Running a scenario
// ---------------------------------------------------------------------------

/**
 * Drop every module-level cache the harness keeps across invocations. Called
 * at the START of a scenario, never between its invocations: a deny-and-retry
 * scenario relies on the parked agent surviving from turn 1 into turn 2 exactly
 * as it does in a live worker.
 */
export function resetCursorModuleState(): void {
  _resetAgentSessionCacheForTests();
  resetCatalogCacheForTests();
  _resetPricingCache();
  _resetRegistryCache();
}

export interface CursorScenario {
  readonly env: HermeticEnvironment;
  readonly clock: ScriptedClock;
  readonly record: ExecutionRecord;
  readonly sdk: ScriptedCursorSdk;
  /** The runner this scenario runs on: the OSS posture plus the scenario's knobs. */
  readonly config: Config;
}

export interface CursorScenarioOptions {
  readonly env: HermeticEnvironment;
  readonly clock: ScriptedClock;
  readonly record: ExecutionRecord;
  readonly sdk: ScriptedSdkOptions;
  /**
   * Control-plane facets the scenario opts INTO, or faults it injects, over
   * the record's everyday answers (`ExecutionRecord.client`): a rejecting
   * `getAgent` is how a blueprint-resolution failure is staged.
   */
  readonly clientOverrides?: Partial<StigmerClient>;
  /**
   * Runner knobs over {@link hermeticCursorConfig}: a scenario that needs the
   * stall watchdog or the workspace-lock wait to expire states the window
   * here. A property of the runner the scenario runs on, not of one turn, so
   * it lives on the scenario and every turn of it sees the same `Config`.
   */
  readonly config?: Partial<Config>;
}

/** Bind the record and the SDK for a scenario; resets the harness caches first. */
export function beginCursorScenario(options: CursorScenarioOptions): CursorScenario {
  resetCursorModuleState();
  const sdk = new ScriptedCursorSdk(options.sdk);
  bindScriptedSdk(sdk);
  bindHermeticClient(options.record.client(options.clientOverrides));
  return {
    env: options.env,
    clock: options.clock,
    record: options.record,
    sdk,
    config: { ...hermeticCursorConfig(options.env), ...options.config },
  };
}

export interface CursorTurnOptions {
  /** Empty for a first invocation; the agent id for a HITL reinvocation. */
  readonly threadId?: string;
  /** The HITL cycle index (0 on the first turn); mints the change-set id. */
  readonly turnSeq?: number;
  readonly onControls?: (controls: InvocationControls) => void;
}

/**
 * Run ONE `ExecuteCursor` invocation for the scenario: the real Cursor
 * adapter under the real turn runtime, as the composition roots wire them.
 * Built per invocation (the registry constructs its client, which is the one
 * bound at `beginCursorScenario`; the adapter boots on the scenario's config).
 */
export async function runCursorTurn(
  scenario: CursorScenario,
  options: CursorTurnOptions = {},
): Promise<ActivityInvocation> {
  // Imported lazily so the scenario file's `vi.mock` declarations are in
  // force before the adapter module (and, through it, `@cursor/sdk` and the
  // client) is loaded.
  const { createCursorAdapter } = await import("../adapter.js");
  const { createHarnessActivities } = await import("../../../harness/registry.js");
  const adapter = createCursorAdapter();
  await adapter.boot(scenario.config);
  const activities = createHarnessActivities([{ harness: "cursor", adapter }], scenario.config);
  // The typed wire shape the control plane's workflow sends (activity-input.ts).
  const input: ExecuteActivityInput = {
    execution_id: scenario.record.executionId,
    thread_id: options.threadId ?? "",
    turn_seq: options.turnSeq ?? 0,
  };
  return runActivityHermetically(activities.ExecuteCursor!, [input], {
    taskQueue: "hermetic-test-queue",
    onControls: options.onControls,
  });
}
