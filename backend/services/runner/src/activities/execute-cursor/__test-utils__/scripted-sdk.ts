/**
 * The `@cursor/sdk` module a hermetic `ExecuteCursor` run imports — every
 * runtime surface the activity path touches, backed by scripted agents.
 *
 * The activity reaches the SDK at three runtime sites and nowhere else:
 *
 *  - `session-lifecycle.ts`: `Agent.create(options)`, `Agent.resume(id, options)`,
 *    `Agent.archive(id, ...)` — the agent handle.
 *  - `service-tier.ts`: `Cursor.models.list({ apiKey })` — the catalog the
 *    variant params (`fast`, `thinking`) are pinned from.
 *  - `index.ts` outer catch: `import("@cursor/sdk")` for `CursorSdkError`, the
 *    `instanceof` the error classifier keys on.
 *
 * Neither the SDK nor the client is injectable into the activity (the real
 * seam arrives with the harness contract; parent Q1/Q2), so — exactly as the
 * native activity tests already do for their boundary modules — the module is
 * substituted with `vi.mock`. Three existing tests each mock ONE of these
 * surfaces (`session-lifecycle.test.ts`, `service-tier.test.ts`,
 * `sdk-warmup.test.ts`); a whole-activity run needs all three at once, which is
 * what this module is.
 *
 * `vi.mock` is hoisted and must appear in the test file; the factory can
 * `await import()` this module and return {@link scriptedCursorSdkModule}. The
 * module's statics read the {@link ScriptedCursorSdk} bound for the current
 * scenario ({@link bindScriptedSdk}), so one test file can run several
 * scenarios with different agents against the same mocked module.
 *
 * Resolution rules a scenario declares, mirroring what the real SDK does:
 *  - `Agent.create` hands out the NEXT unclaimed agent in `agents` (turn 1 of a
 *    fresh session; the fresh agent of a poisoned-handle recovery).
 *  - `Agent.resume(id)` hands back the agent with that id if the scenario
 *    declared it resumable, else throws — `resolveAgent` then falls back to
 *    `create`, which is the production shape of a stale handle.
 *  - `Cursor.models.list` answers the scenario's catalog.
 */

import type { AgentOptions, ModelListItem, SDKAgent } from "@cursor/sdk";
import type { ScriptedCursorAgent } from "./scripted-agent.js";

export interface ScriptedSdkOptions {
  /** Agents handed out by `Agent.create`, in order. */
  readonly agents: readonly ScriptedCursorAgent[];
  /** Agent ids `Agent.resume` succeeds for (defaults to every declared agent). */
  readonly resumable?: readonly string[];
  /** What `Cursor.models.list` answers. */
  readonly catalog: readonly ModelListItem[];
}

/** One `Agent.create` / `Agent.resume` call as the activity made it. */
export interface RecordedResolution {
  readonly kind: "create" | "resume";
  readonly agentId: string | undefined;
  readonly options: Partial<AgentOptions> | undefined;
}

export class ScriptedCursorSdk {
  readonly resolutions: RecordedResolution[] = [];
  readonly archived: string[] = [];
  private nextCreate = 0;
  private readonly byId = new Map<string, ScriptedCursorAgent>();
  private readonly resumable: ReadonlySet<string>;

  constructor(private readonly options: ScriptedSdkOptions) {
    for (const a of options.agents) this.byId.set(a.agentId, a);
    this.resumable = new Set(options.resumable ?? options.agents.map((a) => a.agentId));
  }

  create(options: AgentOptions): SDKAgent {
    const agent = this.options.agents[this.nextCreate];
    if (!agent) {
      throw new Error(
        `ScriptedCursorSdk: Agent.create() #${this.nextCreate + 1} has no agent ` +
          `(the scenario declared ${this.options.agents.length})`,
      );
    }
    this.nextCreate++;
    agent.model = options.model;
    this.resolutions.push({ kind: "create", agentId: agent.agentId, options });
    return agent;
  }

  resume(agentId: string, options: Partial<AgentOptions> | undefined): SDKAgent {
    this.resolutions.push({ kind: "resume", agentId, options });
    const agent = this.byId.get(agentId);
    if (!agent || !this.resumable.has(agentId)) {
      throw new ScriptedCursorSdkError(`agent ${agentId} not found`, { code: "agent_not_found" });
    }
    if (options?.model) agent.model = options.model;
    return agent;
  }

  archive(agentId: string): void {
    this.archived.push(agentId);
  }

  listModels(): readonly ModelListItem[] {
    return this.options.catalog;
  }
}

/**
 * The `CursorSdkError` the mocked module exports. A real `Error` subclass with
 * the two fields the classifier reads (`isRetryable`, `code`), under the SDK's
 * class name so `err.constructor.name` and `instanceof` (against THIS module's
 * export, which is what the activity's dynamic import resolves to) both hold.
 */
export class ScriptedCursorSdkError extends Error {
  readonly isRetryable: boolean;
  readonly code: string | undefined;
  constructor(message: string, opts: { isRetryable?: boolean; code?: string } = {}) {
    super(message);
    this.name = "CursorSdkError";
    this.isRetryable = opts.isRetryable ?? false;
    this.code = opts.code;
  }
}

let bound: ScriptedCursorSdk | undefined;

/** Bind the SDK the mocked module serves for the current scenario. */
export function bindScriptedSdk(sdk: ScriptedCursorSdk): void {
  bound = sdk;
}

function current(): ScriptedCursorSdk {
  if (!bound) {
    throw new Error(
      "scripted-sdk: no ScriptedCursorSdk bound — call bindScriptedSdk(sdk) before running the activity",
    );
  }
  return bound;
}

/**
 * The factory a test passes to `vi.mock("@cursor/sdk", ...)`:
 *
 * ```ts
 * vi.mock("@cursor/sdk", async () =>
 *   (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSdkModule(),
 * );
 * ```
 *
 * Only the runtime surface the activity path uses is provided. Any other
 * import from the mocked module is `undefined` and fails loudly at the call
 * site — deliberately, so a new SDK dependency in production code is noticed
 * here rather than silently stubbed.
 */
export function scriptedCursorSdkModule(): Record<string, unknown> {
  return {
    Agent: {
      create: async (options: AgentOptions): Promise<SDKAgent> => current().create(options),
      resume: async (agentId: string, options?: Partial<AgentOptions>): Promise<SDKAgent> =>
        current().resume(agentId, options),
      archive: async (agentId: string): Promise<void> => current().archive(agentId),
    },
    Cursor: {
      models: {
        list: async (): Promise<readonly ModelListItem[]> => current().listModels(),
      },
    },
    CursorSdkError: ScriptedCursorSdkError,
  };
}
