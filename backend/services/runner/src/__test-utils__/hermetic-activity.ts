/**
 * Hermetic activity driver — run a REAL runner activity end to end with no
 * network, no credentials, and no live Temporal worker, and read back every
 * status it persisted.
 *
 * Why this exists: the runner's activities (`ExecuteCursor`, `ExecuteDeepAgent`)
 * are the wire contract the control plane's workflow keys on — the phases they
 * persist, the copy they write, whether they RETURN a slim status or THROW
 * `CancelledFailure`. Refactoring them safely needs goldens recorded through the
 * activity whole, not through its modules one at a time. The native harness
 * tests already run their activity hermetically by mocking three modules at the
 * boundary (`execute-deep-agent/__tests__/{index,hitl-*,sequential-gate-resume}.test.ts`);
 * this module is that convention made reusable, harness-agnostic, and driven by
 * the framework's own activity environment instead of a hand-written stand-in.
 *
 * What is generic here and what is not: everything an activity touches that is
 * NOT the vendor SDK — the Temporal `Context`, the control-plane client, the
 * runner-owned `~/.stigmer` tree, artifact storage, the model registry, the
 * clock, the worker-shutdown signal — is set up here. The vendor SDK double
 * belongs to the harness (`activities/execute-cursor/__test-utils__/scripted-*.ts`),
 * the same split as `approval-contract/` (runner-wide kit) + each harness's
 * `gateway-substrate.ts`.
 *
 * Three substitutions, and why each is shaped the way it is:
 *
 *  1. `Context.current()` — `MockActivityEnvironment` from `@temporalio/testing`,
 *     ONE PER INVOCATION. It gives the activity a real `Context` (real
 *     `cancellationSignal`, real `heartbeat()` surfaced as events, real
 *     `CancelledFailure` on throw). The native tests' stand-in mints a fresh
 *     `AbortController` on every `Context.current()` call and so cannot drive a
 *     pause; production hands each attempt one `Context`, and so does this. The
 *     environment's documented caveat — once cancelled it stays cancelled — is
 *     why it is per invocation and never shared.
 *
 *  2. `StigmerClient` — the test file mocks the module (`vi.mock` is hoisted and
 *     must live in the test file; see {@link hermeticStigmerClientModule}) and
 *     the constructor hands back whatever client {@link bindHermeticClient} bound
 *     for the current run. The client is `mockStigmerClient` over an
 *     {@link ExecutionRecord}: `updateStatus` writes back into the record the way
 *     the server would, so a REINVOCATION (`threadId` set) reads the transcript
 *     the first invocation persisted — the resume path runs on real data, not on
 *     a hand-built status.
 *
 *  3. The environment — a temp `HOME` (the runner-owned `~/.stigmer` tree,
 *     `platform-dir.ts` reads `process.env.HOME`), a temp workspace root, local
 *     artifact storage in a temp dir, and the HITL fingerprint secret pinned by
 *     env var (`fingerprint-secret.ts` falls back to `randomBytes` — the ONE
 *     source of randomness on the activity path — and memoizes on first call, so
 *     the pin must precede the first invocation in the process).
 *
 * Determinism: the clock is faked for `Date` ONLY (`vi.useFakeTimers({ toFake:
 * ["Date"] })`) and TICKS — the harness double advances it a fixed quantum per
 * script step through {@link ScriptedClock}. Frozen time would make
 * `delta-enricher.ts`'s persist debounce (`Date.now() - lastPersistTime`) never
 * elapse and silently skip the mid-stream persist path production always runs;
 * a ticking clock runs the same path and lands on the same instants every run.
 * Timers stay real so the periodic heartbeat and the stall watchdog behave.
 *
 * Not in scope: this module never edits a production module and never
 * normalizes output. If a golden is not byte-stable, the volatile source is
 * controlled at its origin or the surprise is escalated — never redacted here.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { MockActivityEnvironment } from "@temporalio/testing";
import { CancelledFailure } from "@temporalio/activity";
import { Code, ConnectError } from "@connectrpc/connect";
import { clone, create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
  type AgentExecutionStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ApprovalAction,
  ExecutionControlSignal,
  ExecutionPhase,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { UpdateStatusResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { SessionSchema, type Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import type { StigmerClient } from "../client/stigmer-client.js";
import {
  registerWorkerShutdownSignal,
  signalWorkerShutdown,
  unregisterWorkerShutdownSignal,
} from "../shared/worker-shutdown.js";
import { mockStigmerClient } from "./mock-client.js";

// ---------------------------------------------------------------------------
// The execution record: what the control plane would hold for one execution
// ---------------------------------------------------------------------------

/**
 * The four resources the activity's blueprint chain reads
 * (`execution.spec.sessionId -> session.spec.agentInstanceId ->
 * agentInstance.spec.agentId -> agent`) plus the status the server would hold.
 */
export interface ExecutionRecordInput {
  readonly execution: AgentExecution;
  readonly session: Session;
  readonly agentInstance: AgentInstance;
  readonly agent: Agent;
  /**
   * What `UpdateStatus` answers for each FULL status write — the platform's
   * STOP lever (`ExecutionControlSignal`), decided by the control plane per
   * write and read by the harness stream loop on its mid-stream persist.
   * Evaluated AFTER the write lands, on the snapshot just persisted, so a
   * policy can key on the transcript ("stop once the first assistant message
   * is in"). Defaults to UNSPECIFIED: keep going.
   */
  readonly controlSignal?: (status: AgentExecutionStatus) => ExecutionControlSignal;
}

/**
 * An in-memory stand-in for the server's execution row, with the TWO merge
 * rules and the ONE control lever the activity depends on, and no others:
 *
 *  - A status whose phase is UNSPECIFIED is a setup-progress report
 *    (`reportSetupProgress`): the server keeps `setup_progress` and leaves the
 *    phase and transcript alone. Modelled as: record the label, change nothing else.
 *  - Any other status replaces the held status wholesale (the runner is the
 *    writer of the transcript; the server's own field-ownership merge — approval
 *    fields it owns — is exercised by the test SETTING `approvalAction` on the
 *    record between invocations, exactly as `SubmitApproval` would).
 *  - Every `UpdateStatus` answers a control signal ({@link ExecutionRecordInput.controlSignal});
 *    the server's STOP is the one instruction that travels back to the runner
 *    on this channel, and it is a server decision, so it is modelled here and
 *    not by the test hand-writing the client.
 *
 * Every persisted status is also kept in order (`persisted`) so a test can
 * assert the phase sequence the activity wrote, independent of the final state.
 */
export class ExecutionRecord {
  readonly execution: AgentExecution;
  readonly session: Session;
  readonly agentInstance: AgentInstance;
  readonly agent: Agent;
  private readonly controlSignal: (status: AgentExecutionStatus) => ExecutionControlSignal;
  /** Every `updateStatus` payload, in order, snapshotted at write time. */
  readonly persisted: AgentExecutionStatus[] = [];
  /** Setup-progress labels reported before the stream started, in order. */
  readonly setupProgress: string[] = [];
  /**
   * Every `updateSession` payload, in order (the `harness_state_id` write-back),
   * snapshotted at write time: the activity re-binds the SAME session object on
   * a fresh-agent recovery, so a live reference would show the second id twice.
   */
  readonly sessionUpdates: Session[] = [];

  constructor(input: ExecutionRecordInput) {
    this.execution = clone(AgentExecutionSchema, input.execution);
    this.session = input.session;
    this.agentInstance = input.agentInstance;
    this.agent = input.agent;
    this.controlSignal = input.controlSignal ?? (() => ExecutionControlSignal.UNSPECIFIED);
  }

  get executionId(): string {
    return this.execution.metadata?.id ?? "";
  }

  /** The status the server would currently hold (what `getExecution` returns). */
  get status(): AgentExecutionStatus | undefined {
    return this.execution.status;
  }

  /** The last FULL status written (phase set), or undefined if none yet. */
  get lastFullStatus(): AgentExecutionStatus | undefined {
    for (let i = this.persisted.length - 1; i >= 0; i--) {
      const s = this.persisted[i];
      if (s.phase !== ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED) return s;
    }
    return undefined;
  }

  /**
   * The ORDERED, DISTINCT phases the activity persisted — the deterministic
   * shape of the persist cadence. The COUNT of persists depends on the
   * debounce timer and is deliberately not exposed as an assertion surface.
   */
  get persistedPhases(): ExecutionPhase[] {
    const out: ExecutionPhase[] = [];
    for (const s of this.persisted) {
      if (s.phase === ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED) continue;
      if (out[out.length - 1] !== s.phase) out.push(s.phase);
    }
    return out;
  }

  /** Every tool call on the held transcript (top-level messages), in order. */
  toolCalls(): ToolCall[] {
    return this.execution.status?.messages.flatMap((m) => m.toolCalls) ?? [];
  }

  /** The tool calls currently paused for a decision. */
  waitingToolCalls(): ToolCall[] {
    return this.toolCalls().filter((tc) => tc.status === ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
  }

  /**
   * What the server's `SubmitApproval` does to the row: record the decision on
   * the tool call the runner wrote. The runner owns `status`; the server owns
   * `approval_action` (field ownership, 005 mandate 2) — so this is the ONE
   * place a test writes it, and the status stays WAITING_APPROVAL until the
   * resumed turn runs the tool, exactly as in production.
   */
  decideWaitingToolCalls(action: ApprovalAction, decidedAt: string): number {
    const waiting = this.waitingToolCalls();
    for (const tc of waiting) {
      tc.approvalAction = action;
      tc.approvalDecidedAt = decidedAt;
    }
    return waiting.length;
  }

  /**
   * Apply one `UpdateStatus` write and answer the control signal the server
   * would. A setup-progress report never carries a signal (the runner ignores
   * the response there; the server has nothing to say about a label).
   */
  applyStatusUpdate(status: AgentExecutionStatus): ExecutionControlSignal {
    const snapshot = clone(AgentExecutionStatusSchema, status);
    this.persisted.push(snapshot);
    if (snapshot.phase === ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED) {
      if (snapshot.setupProgress?.currentPhase) {
        this.setupProgress.push(snapshot.setupProgress.currentPhase);
      }
      return ExecutionControlSignal.UNSPECIFIED;
    }
    this.execution.status = clone(AgentExecutionStatusSchema, snapshot);
    return this.controlSignal(snapshot);
  }

  /**
   * The control-plane client the activity sees: every read answers from this
   * record; every write lands in it. Reads the activity makes for optional
   * facets (execution context, channels, skills) answer the everyday shape —
   * NOT_FOUND for the execution context (an execution with no env vars), no
   * channels, no scoped token (the OSS/local posture) — so a scenario opts INTO
   * a facet by overriding.
   */
  client(overrides: Partial<StigmerClient> = {}): StigmerClient {
    return mockStigmerClient({
      getExecution: vi.fn(async () => clone(AgentExecutionSchema, this.execution)),
      getSession: vi.fn(async () => this.session),
      getAgentInstance: vi.fn(async () => this.agentInstance),
      getAgent: vi.fn(async () => this.agent),
      updateStatus: vi.fn(async (_id: string, status: AgentExecutionStatus) => {
        // The activity reads only `.signal`; UNSPECIFIED means "keep going".
        return create(UpdateStatusResponseSchema, { signal: this.applyStatusUpdate(status) });
      }),
      updateSession: vi.fn(async (session: Session) => {
        this.sessionUpdates.push(clone(SessionSchema, session));
        return session;
      }),
      getExecutionContextByExecutionId: vi.fn(async () => {
        throw new ConnectError("execution context not found", Code.NotFound);
      }),
      ...overrides,
    } as Partial<StigmerClient>);
  }
}

// ---------------------------------------------------------------------------
// The module-boundary seam for StigmerClient
// ---------------------------------------------------------------------------

let boundClient: StigmerClient | undefined;

/**
 * Bind the client the mocked `StigmerClient` constructor hands out for the
 * current run. Called by the harness driver immediately before invoking the
 * activity factory (`createCursorActivities(config)` constructs its client
 * inside the factory, so the bind must precede the factory call).
 */
export function bindHermeticClient(client: StigmerClient): void {
  boundClient = client;
}

/**
 * The factory a test passes to `vi.mock(".../client/stigmer-client.js", ...)`.
 * `vi.mock` is hoisted and must appear in the test file itself; the factory can
 * `await import()` this module. Usage:
 *
 * ```ts
 * vi.mock("../../../../client/stigmer-client.js", async () =>
 *   (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
 * );
 * ```
 */
export function hermeticStigmerClientModule(): { StigmerClient: new () => StigmerClient } {
  return {
    StigmerClient: class {
      constructor() {
        if (!boundClient) {
          throw new Error(
            "hermetic-activity: no StigmerClient bound — call bindHermeticClient(record.client()) " +
              "before constructing the activities",
          );
        }
        return boundClient;
      }
    } as unknown as new () => StigmerClient,
  };
}

// ---------------------------------------------------------------------------
// The environment: temp HOME, temp workspace root, local artifact storage
// ---------------------------------------------------------------------------

/**
 * The env-var pins a hermetic run needs, and the reason for each:
 *  - `HOME`: `platform-dir.ts` roots the runner-owned `~/.stigmer` tree (HITL
 *    gate dir, session dirs, denial ledger) on it.
 *  - `ARTIFACT_STORAGE_TYPE=local` + `LOCAL_ARTIFACT_PATH`: a writable local
 *    store so capture mode and tool-output offload run the production path
 *    (an absent store flips capture off — a different code path).
 *  - `STIGMER_RUNNER_HITL_SECRET`: the one randomness source on the activity
 *    path, pinned so grant tokens and fingerprints are byte-stable.
 *  - `CURSOR_EVENT_RECORD_DIR` cleared: never write recordings from a test.
 */
const PINNED_ENV = {
  ARTIFACT_STORAGE_TYPE: "local",
  STIGMER_RUNNER_HITL_SECRET: "hermetic-fixture-secret-do-not-use-in-production",
} as const;

const CLEARED_ENV = ["CURSOR_EVENT_RECORD_DIR", "STIGMER_PROXY_ENDPOINT", "STIGMER_CLOUD_API_URL"] as const;

export interface HermeticEnvironment {
  /** The temp `HOME` (the runner's `~/.stigmer` lands under it). */
  readonly home: string;
  /** The temp workspace root (`config.workspaceRootDir`). */
  readonly workspaceRootDir: string;
  /** The temp local artifact store (`LOCAL_ARTIFACT_PATH`). */
  readonly artifactPath: string;
  /** Restore every env var and remove the temp tree. Idempotent. */
  dispose(): void;
}

/**
 * Create the temp tree and pin the env vars. Call once per test FILE (in
 * `beforeAll`) — the fingerprint secret is memoized per process on first use,
 * and vitest isolates files in forks, so per-file is the natural unit.
 */
export function createHermeticEnvironment(): HermeticEnvironment {
  const root = mkdtempSync(join(tmpdir(), "stigmer-hermetic-"));
  const home = join(root, "home");
  const workspaceRootDir = join(root, "workspaces");
  const artifactPath = join(root, "artifacts");

  const saved = new Map<string, string | undefined>();
  const set = (key: string, value: string | undefined): void => {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  set("HOME", home);
  set("LOCAL_ARTIFACT_PATH", artifactPath);
  for (const [k, v] of Object.entries(PINNED_ENV)) set(k, v);
  for (const k of CLEARED_ENV) set(k, undefined);

  let disposed = false;
  return {
    home,
    workspaceRootDir,
    artifactPath,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

/**
 * A deterministic, TICKING `Date`. Only `Date` is faked; timers stay real (the
 * periodic heartbeat, the stall watchdog, `withTimeout` all need them). The
 * harness double calls {@link ScriptedClock.tick} once per script step, so
 * every `Date.now()`-based decision on the activity path (status timestamps,
 * the enricher's persist debounce, cache TTLs) sees the same instants run after
 * run and runs the same branches production runs.
 */
export class ScriptedClock {
  /** A fixed epoch: 2026-01-01T00:00:00.000Z. Chosen for readability in goldens. */
  static readonly EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
  /** One second per step — well under any stall or cache horizon. */
  static readonly STEP_MS = 1_000;

  private nowMs = ScriptedClock.EPOCH_MS;

  install(): void {
    vi.useFakeTimers({ toFake: ["Date"], now: this.nowMs });
  }

  tick(ms: number = ScriptedClock.STEP_MS): void {
    this.nowMs += ms;
    vi.setSystemTime(this.nowMs);
  }

  /** Back to the epoch — for a second scenario in the same file. */
  reset(): void {
    this.nowMs = ScriptedClock.EPOCH_MS;
    vi.setSystemTime(this.nowMs);
  }

  uninstall(): void {
    vi.useRealTimers();
  }
}

// ---------------------------------------------------------------------------
// Running one activity invocation
// ---------------------------------------------------------------------------

/** How an activity invocation ended: the return value or the error it threw. */
export type ActivityOutcome =
  | { readonly kind: "returned"; readonly value: unknown }
  | { readonly kind: "threw"; readonly error: unknown };

export interface ActivityInvocation {
  readonly outcome: ActivityOutcome;
  /** Heartbeat details the activity reported, in order. */
  readonly heartbeats: unknown[];
  /** The `taskQueue` the invocation ran on (the shutdown signal is keyed by it). */
  readonly taskQueue: string;
}

/**
 * Handles a scenario uses to interrupt the invocation FROM A SCRIPT STEP —
 * never from a timer. `cancel()` aborts the activity's `cancellationSignal`
 * (a user pause, as the workflow delivers it). `signalWorkerShutdown()` aborts
 * the queue's shutdown signal first, which the activity reads to tell a worker
 * drain from a user pause (`classifyTurnInterruption`).
 */
export interface InvocationControls {
  cancel(): void;
  signalWorkerShutdown(): void;
}

export interface RunActivityOptions {
  readonly taskQueue?: string;
  /**
   * Receives the invocation's controls before the activity starts, so a
   * scenario can hand them to the harness double's `effect` steps.
   */
  readonly onControls?: (controls: InvocationControls) => void;
}

/**
 * Run one activity function under a fresh `MockActivityEnvironment` and
 * capture how it ended. `CancelledFailure` is caught like any other throw and
 * reported as `{ kind: "threw" }` — the throw-vs-return table is the thing
 * under test, so the driver never interprets it.
 */
export async function runActivityHermetically<A extends unknown[]>(
  activity: (...args: A) => Promise<unknown>,
  args: A,
  options: RunActivityOptions = {},
): Promise<ActivityInvocation> {
  const taskQueue = options.taskQueue ?? "hermetic-test-queue";
  const env = new MockActivityEnvironment({ taskQueue });
  const heartbeats: unknown[] = [];
  env.on("heartbeat", (details: unknown) => heartbeats.push(details));

  // The worker-shutdown signal is process-global per queue; register for this
  // invocation and always unregister so no state leaks into the next one.
  registerWorkerShutdownSignal(taskQueue);
  options.onControls?.({
    cancel: () => env.cancel(),
    signalWorkerShutdown: () => signalWorkerShutdown(taskQueue),
  });

  try {
    const value = await env.run(activity, ...args);
    return { outcome: { kind: "returned", value }, heartbeats, taskQueue };
  } catch (error) {
    return { outcome: { kind: "threw", error }, heartbeats, taskQueue };
  } finally {
    unregisterWorkerShutdownSignal(taskQueue);
  }
}

/** True when the outcome is a thrown Temporal `CancelledFailure`. */
export function threwCancelledFailure(outcome: ActivityOutcome): outcome is { kind: "threw"; error: CancelledFailure } {
  return outcome.kind === "threw" && outcome.error instanceof CancelledFailure;
}
