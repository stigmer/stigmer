/**
 * The `@cursor/sdk` module a hermetic `ExecuteCursor` run imports — every
 * runtime surface the activity path touches, backed by scripted agents — and
 * the `@cursor/sdk/sqlite` module beside it, backed by a store that holds
 * nothing.
 *
 * The activity reaches the SDK at four runtime sites and nowhere else:
 *
 *  - `session-lifecycle.ts`: `Agent.create(options)`, `Agent.resume(id, options)`
 *    — the agent handle.
 *  - `session-store.ts`: `SqliteLocalAgentStore.open({ workspaceRef, stateRoot })`
 *    from `@cursor/sdk/sqlite` — the session's store the handle is created and
 *    resumed over (`local.store`).
 *  - `service-tier.ts`: `Cursor.models.list({ apiKey })` — the catalog the
 *    variant params (`fast`, `thinking`) are pinned from.
 *  - `index.ts` outer catch: `import("@cursor/sdk")` for `CursorSdkError`, the
 *    `instanceof` the error classifier keys on.
 *
 * Neither the SDK nor the client is injectable into the activity (the real
 * seam arrives with the harness contract; parent Q1/Q2), so — exactly as the
 * native activity tests already do for their boundary modules — the modules
 * are substituted with `vi.mock`. Three existing tests each mock ONE of these
 * surfaces (`session-lifecycle.test.ts`, `service-tier.test.ts`,
 * `sdk-warmup.test.ts`); a whole-activity run needs all of them at once, which
 * is what this module is.
 *
 * `vi.mock` is hoisted and must appear in the test file, once per module id
 * (a subpath is its own module id, so `@cursor/sdk/sqlite` needs its own
 * `vi.mock`); the factories `await import()` this module and return
 * {@link scriptedCursorSdkModule} and {@link scriptedCursorSqliteModule}. The
 * modules' statics read the {@link ScriptedCursorSdk} bound for the current
 * scenario ({@link bindScriptedSdk}), so one test file can run several
 * scenarios with different agents against the same mocked modules.
 *
 * Resolution rules a scenario declares, mirroring what the real SDK does:
 *  - `Agent.create` hands out the agent declared for the session it is asked
 *    for (`agentForWorkspaceRef`, when the scenario resolves agents per
 *    session — the harness contract kit runs several sessions concurrently on
 *    one adapter, and the order their creates arrive in is real I/O timing),
 *    else the NEXT unclaimed agent in `agents` (turn 1 of a fresh session; the
 *    fresh agent of a poisoned-handle recovery) — unless the scenario declared
 *    a `createFailure`, which the FIRST create throws instead (the SDK refusing
 *    to mint an agent: a 401 on the key, a validation error).
 *  - `Agent.resume(id)` hands back the agent with that id if the scenario
 *    declared it (in `agents` or `resumableAgents`, or handed out for a
 *    session), else throws — `resolveAgent` then falls back to `create`, which
 *    is the production shape of a lost handle.
 *  - `Cursor.models.list` answers the scenario's catalog.
 *  - `SqliteLocalAgentStore.open` hands out a {@link ScriptedLocalAgentStore}
 *    carrying the ref and root it was asked for, and records the open; its
 *    `dispose()` is recorded too, so a scenario can assert the adapter's
 *    session-store lifetime (`releaseSession`, `shutdown`).
 */

import type { AgentOptions, ModelListItem, SDKAgent } from "@cursor/sdk";
import type { SqliteLocalAgentStore, SqliteLocalAgentStoreOptions } from "@cursor/sdk/sqlite";
import type { ScriptedCursorAgent } from "./scripted-agent.js";

export interface ScriptedSdkOptions {
  /** Agents handed out by `Agent.create`, in order. Also resumable by id. */
  readonly agents: readonly ScriptedCursorAgent[];
  /**
   * The agent `Agent.create` hands out for the session the create names,
   * consulted before the ordered list. The SDK's create options carry the
   * session as the store's `workspaceRef` (`local.store`, opened by
   * `session-store.ts`: `stigmer-session:<sessionId>`), so the resolver is
   * keyed by that ref — a scenario computes the ref the same way the adapter
   * does (`resolveSessionStoreLocation`). `undefined` falls through to the
   * list. Consulted live on every create, so a scenario may mint the session's
   * agent only when it learns of the session.
   */
  readonly agentForWorkspaceRef?: (workspaceRef: string) => ScriptedCursorAgent | undefined;
  /**
   * Agents `Agent.resume` finds by id but `Agent.create` never hands out — a
   * previous turn's agent the session knows only by `harness_state_id`.
   */
  readonly resumableAgents?: readonly ScriptedCursorAgent[];
  /**
   * Thrown by the FIRST `Agent.create` instead of handing out an agent; later
   * creates hand out `agents` as usual. A {@link ScriptedCursorSdkError} here is
   * the SDK's own refusal (the activity's outer catch keys on `instanceof`);
   * a plain `Error` is anything else that can escape the SDK boundary.
   */
  readonly createFailure?: Error;
  /** What `Cursor.models.list` answers. */
  readonly catalog: readonly ModelListItem[];
}

/** One `Agent.create` / `Agent.resume` call as the activity made it. */
export interface RecordedResolution {
  readonly kind: "create" | "resume";
  readonly agentId: string | undefined;
  readonly options: Partial<AgentOptions> | undefined;
}

/**
 * The session a create names: the `workspaceRef` of the store it passes as
 * `local.store`. In a hermetic run that store is the one this module's sqlite
 * double opened; anything else (a test that mocks `@cursor/sdk` with its own
 * stub and passes no store) names no session and falls through to the list.
 */
function workspaceRefOf(options: AgentOptions): string | undefined {
  const store = options.local?.store;
  return store instanceof ScriptedLocalAgentStore ? store.workspaceRef : undefined;
}

/**
 * The `@cursor/sdk/sqlite` store the adapter opens per session, holding
 * nothing: the scripted agents carry their own state, so the store only has
 * to be the thing `Agent.create` / `Agent.resume` are handed and the thing
 * `releaseSession` / `shutdown` dispose. `open` and `dispose` are recorded on
 * the bound {@link ScriptedCursorSdk} for lifetime assertions.
 */
export class ScriptedLocalAgentStore {
  disposeCalls = 0;

  constructor(
    readonly workspaceRef: string,
    readonly stateRoot: string,
  ) {}

  static async open(options: SqliteLocalAgentStoreOptions): Promise<ScriptedLocalAgentStore> {
    const store = new ScriptedLocalAgentStore(options.workspaceRef, options.stateRoot ?? "");
    current().stores.push(store);
    return store;
  }

  async dispose(): Promise<void> {
    this.disposeCalls++;
  }
}

export class ScriptedCursorSdk {
  readonly resolutions: RecordedResolution[] = [];
  /** Every store `SqliteLocalAgentStore.open` handed out, in order. */
  readonly stores: ScriptedLocalAgentStore[] = [];
  private nextCreate = 0;
  private createFailurePending: boolean;
  private readonly byId = new Map<string, ScriptedCursorAgent>();

  constructor(private readonly options: ScriptedSdkOptions) {
    for (const a of [...options.agents, ...(options.resumableAgents ?? [])]) {
      this.byId.set(a.agentId, a);
    }
    this.createFailurePending = options.createFailure !== undefined;
  }

  create(options: AgentOptions): SDKAgent {
    if (this.createFailurePending && this.options.createFailure) {
      this.createFailurePending = false;
      this.resolutions.push({ kind: "create", agentId: undefined, options });
      throw this.options.createFailure;
    }
    const workspaceRef = workspaceRefOf(options);
    const forSession = workspaceRef !== undefined ? this.options.agentForWorkspaceRef?.(workspaceRef) : undefined;
    if (forSession) {
      this.byId.set(forSession.agentId, forSession);
      forSession.model = options.model;
      this.resolutions.push({ kind: "create", agentId: forSession.agentId, options });
      return forSession;
    }
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
    if (!agent) {
      throw new ScriptedCursorSdkError(`agent ${agentId} not found`, { code: "agent_not_found" });
    }
    if (options?.model) agent.model = options.model;
    return agent;
  }

  listModels(): readonly ModelListItem[] {
    return this.options.catalog;
  }
}

/** The construction options of the SDK's `CursorSdkError` (`errors.d.ts`), minus `cause`. */
export interface ScriptedCursorSdkErrorOptions {
  readonly isRetryable?: boolean;
  readonly code?: string;
  readonly status?: number;
  readonly endpoint?: string;
  readonly requestId?: string;
  readonly operation?: string;
}

/**
 * The `CursorSdkError` the mocked module exports. A real `Error` subclass with
 * the SDK class's public surface (`@cursor/sdk` `errors.d.ts`: `isRetryable`,
 * `code`, `status`, `endpoint`, `requestId`, `operation`, `toJSON()`), under
 * the SDK's class name so `err.constructor.name` and `instanceof` (against
 * THIS module's export, which is what the activity's dynamic import resolves
 * to) both hold. The activity's outer catch reads `code`, `status` and
 * `message` for the classifier and logs `toJSON()`; the double must carry the
 * whole surface or the catch arm itself throws instead of mapping the error.
 */
export class ScriptedCursorSdkError extends Error {
  readonly isRetryable: boolean;
  readonly code: string | undefined;
  readonly status: number | undefined;
  readonly endpoint: string | undefined;
  readonly requestId: string | undefined;
  readonly operation: string | undefined;
  constructor(message: string, opts: ScriptedCursorSdkErrorOptions = {}) {
    super(message);
    this.name = "CursorSdkError";
    this.isRetryable = opts.isRetryable ?? false;
    this.code = opts.code;
    this.status = opts.status;
    this.endpoint = opts.endpoint;
    this.requestId = opts.requestId;
    this.operation = opts.operation;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      isRetryable: this.isRetryable,
      code: this.code,
      status: this.status,
      endpoint: this.endpoint,
      requestId: this.requestId,
      operation: this.operation,
    };
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
    },
    Cursor: {
      models: {
        list: async (): Promise<readonly ModelListItem[]> => current().listModels(),
      },
    },
    CursorSdkError: ScriptedCursorSdkError,
  };
}

/**
 * The factory a test passes to `vi.mock("@cursor/sdk/sqlite", ...)`, beside
 * the one above:
 *
 * ```ts
 * vi.mock("@cursor/sdk/sqlite", async () =>
 *   (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSqliteModule(),
 * );
 * ```
 *
 * The one export the runner reads from that entry (`session-store.ts`). The
 * class is exported under the SDK's name so `session-store.ts`'s dynamic
 * import destructures it unchanged; its type is the SDK's, which is why
 * {@link ScriptedLocalAgentStore} carries `workspaceRef`, `stateRoot` and
 * `dispose()` — the members the runner touches — and nothing else.
 */
export function scriptedCursorSqliteModule(): Record<string, unknown> {
  return {
    SqliteLocalAgentStore: ScriptedLocalAgentStore satisfies {
      open(options: SqliteLocalAgentStoreOptions): Promise<Pick<SqliteLocalAgentStore, "workspaceRef" | "stateRoot" | "dispose">>;
    },
  };
}
