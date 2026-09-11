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
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
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
