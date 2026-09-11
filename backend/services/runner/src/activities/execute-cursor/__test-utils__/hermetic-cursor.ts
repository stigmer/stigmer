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
 * Network: the activity's only HTTP fetch is the model registry
 * (`model-pricing-data.ts`, `shared/model-registry.ts`; both fail SOFT to
 * defaults with a 60s failure cache, which would make the goldens depend on
 * DEFAULT_PRICING and log warnings on every run). `fetch` is stubbed to answer
 * one registry document — and to THROW for any other URL, so a new network
 * dependency on the activity path fails the hermetic run instead of leaking.
 *
 * The fixture model is `composer-2.5`, pinned (not Auto) on purpose: Auto short-
 * circuits `resolveServiceTierParams` before the catalog, and a pinned model runs
 * the catalog path, the variant-param pinning, and the `run.wait()` model echo
 * check — more of the production path under the golden.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { create } from "@bufbuild/protobuf";
import type { ModelListItem } from "@cursor/sdk";
import { vi } from "vitest";
import {
  AgentExecutionSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentExecutionSpecSchema,
  ExecutionConfigSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { SessionSchema, type Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import {
  LocalPathSourceSchema,
  WorkspaceEntrySchema,
  WorkspaceSourceSchema,
  type WorkspaceEntry,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import { AgentSchema, type Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import {
  AgentInstanceSchema,
  type AgentInstance,
} from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { AgentInstanceSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
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
  /** The pinned model; in the registry stub AND the SDK catalog below. */
  model: "composer-2.5",
  cursorApiKey: "hermetic-cursor-api-key",
} as const;

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

export interface CursorRecordOptions {
  /** The user's message for this execution. */
  readonly message: string;
  /** The agent's instructions (system prompt body). */
  readonly instructions?: string;
  /** Session workspace entries (a `local_path` entry turns on capture mode). */
  readonly workspaceEntries?: WorkspaceEntry[];
  readonly modelName?: string;
  readonly autoApproveAll?: boolean;
}

/** The four resources of one execution, wired by id into a chain. */
export function cursorExecutionRecord(options: CursorRecordOptions): ExecutionRecord {
  const execution: AgentExecution = create(AgentExecutionSchema, {
    metadata: create(ApiResourceMetadataSchema, {
      id: FIXTURE.executionId,
      org: FIXTURE.org,
      name: FIXTURE.executionId,
    }),
    spec: create(AgentExecutionSpecSchema, {
      sessionId: FIXTURE.sessionId,
      message: options.message,
      autoApproveAll: options.autoApproveAll ?? false,
      executionConfig: create(ExecutionConfigSchema, {
        modelName: options.modelName ?? FIXTURE.model,
      }),
    }),
  });
  const session: Session = create(SessionSchema, {
    metadata: create(ApiResourceMetadataSchema, {
      id: FIXTURE.sessionId,
      org: FIXTURE.org,
      name: FIXTURE.sessionId,
    }),
    spec: create(SessionSpecSchema, {
      agentInstanceId: FIXTURE.agentInstanceId,
      workspaceEntries: options.workspaceEntries ?? [],
    }),
  });
  const agentInstance: AgentInstance = create(AgentInstanceSchema, {
    metadata: create(ApiResourceMetadataSchema, {
      id: FIXTURE.agentInstanceId,
      org: FIXTURE.org,
      name: FIXTURE.agentInstanceId,
    }),
    spec: create(AgentInstanceSpecSchema, { agentId: FIXTURE.agentId }),
  });
  const agent: Agent = create(AgentSchema, {
    metadata: create(ApiResourceMetadataSchema, {
      id: FIXTURE.agentId,
      org: FIXTURE.org,
      name: FIXTURE.agentName,
    }),
    spec: create(AgentSpecSchema, {
      description: "Hermetic fixture agent",
      instructions: options.instructions ?? "You are the hermetic fixture agent. Answer briefly.",
    }),
  });
  return new ExecutionRecord({ execution, session, agentInstance, agent });
}

// ---------------------------------------------------------------------------
// The registry document and the SDK catalog
// ---------------------------------------------------------------------------

/**
 * The model registry document both readers parse (`parsePricingTable` wants
 * `harness: "cursor"` + `pricing`; `parseRegistry` wants `id` + `provider` and
 * reads `capabilities.vision`). One entry, the fixture model, priced at round
 * numbers so the golden's `estimatedCostUsd` is legible.
 */
export const REGISTRY_DOCUMENT = {
  models: [
    {
      id: FIXTURE.model,
      displayName: "Composer 2.5 (hermetic fixture)",
      provider: "cursor",
      harness: "cursor",
      costTier: "standard",
      featured: true,
      capabilities: { vision: true },
      pricing: {
        inputPricePerMillion: 1.0,
        outputPricePerMillion: 4.0,
        cacheWritePricePerMillion: 1.0,
        cacheReadPricePerMillion: 0.1,
      },
      pricingVariants: {
        fast: {
          inputPricePerMillion: 3.0,
          outputPricePerMillion: 12.0,
          cacheWritePricePerMillion: 3.0,
          cacheReadPricePerMillion: 0.3,
        },
      },
    },
  ],
} as const;

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

/**
 * Stub `fetch` to answer the registry document and refuse everything else.
 * Returns the URLs fetched, for the "no other network" assertion.
 */
export function stubRegistryFetch(): { readonly urls: string[]; restore(): void } {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      urls.push(url);
      if (!url.includes("/model-registry")) {
        throw new Error(`hermetic run attempted a non-registry network call: ${url}`);
      }
      return { ok: true, status: 200, json: async () => REGISTRY_DOCUMENT } as unknown as Response;
    }),
  );
  return { urls, restore: () => vi.unstubAllGlobals() };
}

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
}

export interface CursorScenarioOptions {
  readonly env: HermeticEnvironment;
  readonly clock: ScriptedClock;
  readonly record: ExecutionRecord;
  readonly sdk: ScriptedSdkOptions;
}

/** Bind the record and the SDK for a scenario; resets the harness caches first. */
export function beginCursorScenario(options: CursorScenarioOptions): CursorScenario {
  resetCursorModuleState();
  const sdk = new ScriptedCursorSdk(options.sdk);
  bindScriptedSdk(sdk);
  bindHermeticClient(options.record.client());
  return { env: options.env, clock: options.clock, record: options.record, sdk };
}

export interface CursorTurnOptions {
  /** Empty for a first invocation; the agent id for a HITL reinvocation. */
  readonly threadId?: string;
  /** The HITL cycle index (0 on the first turn); mints the change-set id. */
  readonly turnSeq?: number;
  readonly onControls?: (controls: InvocationControls) => void;
}

/**
 * Run ONE `ExecuteCursor` invocation for the scenario. The activities are
 * constructed per invocation (the factory constructs its client, which is the
 * one bound at `beginCursorScenario`).
 */
export async function runCursorTurn(
  scenario: CursorScenario,
  options: CursorTurnOptions = {},
): Promise<ActivityInvocation> {
  // Imported lazily so the scenario file's `vi.mock` declarations are in
  // force before the activity module (and, through it, `@cursor/sdk` and the
  // client) is loaded.
  const { createCursorActivities } = await import("../index.js");
  const activities = createCursorActivities(hermeticCursorConfig(scenario.env));
  // The typed wire shape the control plane's workflow sends (activity-input.ts).
  const input: ExecuteActivityInput = {
    execution_id: scenario.record.executionId,
    thread_id: options.threadId ?? "",
    turn_seq: options.turnSeq ?? 0,
  };
  return runActivityHermetically(activities.ExecuteCursor, [input], {
    taskQueue: "hermetic-test-queue",
    onControls: options.onControls,
  });
}
