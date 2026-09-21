/**
 * Hermetic activity driver — run a REAL runner activity end to end with no
 * network, no credentials, and no live Temporal worker, and read back every
 * status it persisted.
 *
 * Why this exists: the runner's activities (`ExecuteCursor`, `ExecuteDeepAgent`)
 * are the wire contract the control plane's workflow keys on — the phases they
 * persist, the copy they write, whether they RETURN a slim status or THROW
 * `CancelledFailure`. Refactoring them safely needs goldens recorded through the
 * activity whole, not through its modules one at a time. The native harness's
 * earlier activity tests ran their activity hermetically by mocking three
 * modules at the boundary with a hand-written `Context` stand-in and a scripted
 * graph object; this module is that convention made reusable, harness-agnostic,
 * and driven by the framework's own activity environment. Both harnesses now
 * run on it (`execute-cursor/__test-utils__/hermetic-cursor.ts`,
 * `execute-deep-agent/__test-utils__/hermetic-deep-agent.ts`), and the earlier
 * native tests were re-homed onto the native driver (#1096), their assertions
 * carried into `execute-deep-agent/__tests__/hermetic/`.
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
 * the streaming scheduler's cadence (`Date.now()` against its last send) never
 * elapse and silently skip the mid-stream persist path production always runs;
 * a ticking clock runs the same path and lands on the same instants every run.
 * Timers stay real so the periodic heartbeat and the stall watchdog behave.
 *
 * The live posture (#1097's live-run gate): a `CURSOR_API_KEY`-gated live
 * instrument keeps all three substitutions above — the real `Context`, the
 * record behind the client, the temp environment — and drops only the
 * harness's SDK double, so the REAL activity runs against the REAL vendor SDK
 * with everything the activity persists still readable from the record.
 * Two things differ from a hermetic run and both are the caller's explicit
 * choice: no `ScriptedClock` is installed (the real SDK is not ticked, and a
 * frozen clock would skip the persist cadence production runs), and the
 * environment may name an `eventRecordingDir` so the run leaves a recording.
 * The harness's driver names the entry (`beginLiveCursorScenario`).
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
import { decideCapturedFileChanges, type FileReviewVerdicts } from "./file-review-projection.js";
import { mockStigmerClient } from "./mock-client.js";

// ---------------------------------------------------------------------------
// The execution record: what the control plane would hold for one execution
// ---------------------------------------------------------------------------

/**
 * The four resources the activity's blueprint chain reads
 * (`execution.spec.sessionId -> session.spec.agentInstanceId ->
 * agentInstance.spec.agentId -> agent`) plus the status the server would hold.
 * A record for the built-in assistant (the session names no instance) has
 * no instance and no agent: the chain must stop at the session, so the
 * client REFUSES those two reads instead of answering an empty message.
 */
export interface ExecutionRecordInput {
  readonly execution: AgentExecution;
  readonly session: Session;
  readonly agentInstance: AgentInstance | undefined;
  readonly agent: Agent | undefined;
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
  readonly agentInstance: AgentInstance | undefined;
  readonly agent: Agent | undefined;
  private readonly controlSignal: (status: AgentExecutionStatus) => ExecutionControlSignal;
  /** Every `updateStatus` payload, in order, snapshotted at write time. */
  readonly persisted: AgentExecutionStatus[] = [];
  /** Fired after every full-status `applyStatusUpdate`; {@link whenToolCallsSettled} subscribes here. */
  private readonly persistListeners = new Set<() => void>();
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

  /**
   * Resolves once every one of `ids` is a SETTLED row (not RUNNING) in a status
   * the activity has persisted — root messages and every sub-agent's alike.
   * Resolves at once for an empty list or when they already are.
   *
   * This is the barrier a real model gives the runtime for free and a
   * scripted one does not: a model that takes 300 ms to answer never starts
   * its next turn before the loop has folded and persisted the tool results
   * it is answering, while `ScriptedModel` answers instantly and LangGraph's
   * producer can run a whole turn ahead of the consumer while the consumer
   * awaits one mid-stream persist (on a git workspace that persist shells out
   * for `file_change_progress`). The stamps the consumer writes at apply time
   * then land on either side of the scripted clock's next tick depending on
   * I/O timing — a golden that flips between `:01` and `:02` on the day. The
   * driver awaits this before it ticks (`hermetic-deep-agent.ts`), so every
   * stamp of turn N precedes turn N+1's instant, run after run.
   *
   * Why "settled" and not "seen": the row's `completedAt` is stamped when the
   * tool's end event is applied, and the producer calls the next model turn
   * right after emitting that event, so a barrier on the row merely existing
   * would still race the completion stamp. The persist that carries the
   * settled row always exists: a tool's finish forces one (the builder's
   * force flag), and a turn followed by another turn always has a tool call.
   *
   * Bounded by real time (timers are real under the scripted clock): a
   * scenario that breaks the fact above — a persist that never carries the
   * row — fails naming the ids still open, never hangs.
   */
  whenToolCallsSettled(ids: readonly string[], timeoutMs = 10_000): Promise<void> {
    const unsettled = (): string[] => {
      const settled = this.settledToolCallIds();
      return ids.filter((id) => !settled.has(id));
    };
    if (unsettled().length === 0) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.persistListeners.delete(check);
        reject(
          new Error(
            `ExecutionRecord: tool call(s) ${unsettled().join(", ")} never settled in a persisted status ` +
              `within ${timeoutMs} ms (${this.persisted.length} persists seen). A model turn was asked to ` +
              `wait for the results it answers; the loop never persisted them — a scenario or runtime bug.`,
          ),
        );
      }, timeoutMs);
      const check = (): void => {
        if (unsettled().length > 0) return;
        clearTimeout(timer);
        this.persistListeners.delete(check);
        resolve();
      };
      this.persistListeners.add(check);
    });
  }

  /** The ids of every row not RUNNING in the held status, across the root and every sub-agent transcript. */
  private settledToolCallIds(): Set<string> {
    const out = new Set<string>();
    const status = this.execution.status;
    if (!status) return out;
    const transcripts = [status.messages, ...status.subAgentExecutions.map((s) => s.messages)];
    for (const messages of transcripts) {
      for (const message of messages) {
        for (const tc of message.toolCalls) {
          if (tc.status !== ToolCallStatus.TOOL_CALL_RUNNING) out.add(tc.id);
        }
      }
    }
    return out;
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
   * What the server's `SubmitFileDecision` and its projection do between
   * invocations: every change of every AWAITING_REVIEW set the runner captured
   * gets a per-file verdict, and `status.file_change_sets` is re-folded from
   * the ledger (`file-review-projection.ts` mirrors the server's fold). The
   * runner authors the ledger; the server owns the sets — so this is the ONE
   * place a test writes them. Returns how many decisions were written.
   */
  decideCapturedFileChanges(verdicts: FileReviewVerdicts, decidedAt: string): number {
    if (!this.execution.status) throw new Error("ExecutionRecord: no status to decide file changes on (test bug)");
    return decideCapturedFileChanges(this.execution.status, verdicts, decidedAt);
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
    for (const listener of [...this.persistListeners]) listener();
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
      getAgentInstance: vi.fn(async () => {
        if (this.agentInstance === undefined) {
          throw new Error("the built-in assistant's record has no agent instance to read");
        }
        return this.agentInstance;
      }),
      getAgent: vi.fn(async () => {
        if (this.agent === undefined) {
          throw new Error("the built-in assistant's record has no agent to read");
        }
        return this.agent;
      }),
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
 *  - `CURSOR_EVENT_RECORD_DIR` cleared: never write recordings from a test —
 *    unless the caller names an `eventRecordingDir`, the live instruments'
 *    opt-in (below), in which case this environment SETS it. Either way the
 *    variable has one owner here, and dispose restores it.
 */
const PINNED_ENV = {
  ARTIFACT_STORAGE_TYPE: "local",
  STIGMER_RUNNER_HITL_SECRET: "hermetic-fixture-secret-do-not-use-in-production",
} as const;

const CLEARED_ENV = ["STIGMER_PROXY_ENDPOINT", "STIGMER_CLOUD_API_URL"] as const;

/** The one name the Cursor recorder is switched on by (`turn-settle.ts` reads it). */
const CURSOR_EVENT_RECORD_DIR = "CURSOR_EVENT_RECORD_DIR";

export interface HermeticEnvironmentOptions {
  /**
   * Where the Cursor event recorder writes this run's raw SDK recording
   * (`<dir>/<executionId>.cursor-events.jsonl`). Named ONLY by a live
   * instrument, whose point is a recording of the real SDK; a hermetic
   * scenario leaves it unset and the variable is cleared for the run.
   */
  readonly eventRecordingDir?: string;
}

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
export function createHermeticEnvironment(options: HermeticEnvironmentOptions = {}): HermeticEnvironment {
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
  set(CURSOR_EVENT_RECORD_DIR, options.eventRecordingDir);

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
 * A deterministic, TICKING clock: `Date` AND `performance` are faked and
 * advance together; timers stay real (the periodic heartbeat, the stall
 * watchdog, `withTimeout` all need them). The harness double calls
 * {@link ScriptedClock.tick} once per script step, so every clock-based
 * decision on the activity path — status timestamps, the builder's row
 * instants, cache TTLs (`Date`); the streaming scheduler's persist cadence
 * (`performance.now()`) — sees the same instants run after run and runs the
 * same branches production runs.
 *
 * Why both (since #1096): until then only `Date` was faked, so the
 * scheduler paced persists on REAL elapsed time and `fileChangeProgress`,
 * which rides persists, could gain or lose a capture under load — a golden
 * flake seen twice while the native adapter moved onto the runtime. One clock,
 * two faces: `tick` advances through
 * the fake clock's own `tick` (`vi.advanceTimersByTime`), which moves both
 * `Date` and `performance.now()`; `vi.setSystemTime` would move `Date` alone
 * (fake-timers keeps `performance` monotonic across a system-time jump), so
 * only {@link reset} uses it — rewinding `Date` to the epoch for a second
 * scenario while `performance` stays monotonic, which is harmless because
 * every turn constructs its scheduler fresh and measures from its own start.
 *
 * Faking `performance` replaces the whole global (`now`, a `timeOrigin` at
 * the epoch, every other method a no-op); nothing on the activity path reads
 * more than `now`, and a module importing from `node:perf_hooks` would bypass
 * the fake (none under `src/` does).
 */
export class ScriptedClock {
  /** A fixed epoch: 2026-01-01T00:00:00.000Z. Chosen for readability in goldens. */
  static readonly EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
  /** One second per step — well under any stall or cache horizon. */
  static readonly STEP_MS = 1_000;

  private nowMs = ScriptedClock.EPOCH_MS;

  install(): void {
    vi.useFakeTimers({ toFake: ["Date", "performance"], now: this.nowMs });
  }

  tick(ms: number = ScriptedClock.STEP_MS): void {
    this.nowMs += ms;
    // Through the fake clock's own tick, so `performance.now()` advances with
    // `Date`; with no timers faked there is nothing for it to fire.
    vi.advanceTimersByTime(ms);
  }

  /** Back to the epoch — for a second scenario in the same file. `Date` rewinds; `performance` stays monotonic (see the header). */
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
