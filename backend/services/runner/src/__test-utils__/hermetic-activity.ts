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
import { clone, create, equals, toJson } from "@bufbuild/protobuf";
import {
  RunSchema,
  RunStatusSchema,
  type Run,
  type RunStatus,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  ApprovalAction,
  FileDecisionAction,
  RunControlSignal,
  RunPhase,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { RunSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/spec_pb";
import { UpdateStatusResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import { SessionSchema, type Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import {
  AppendSessionEventsResponseSchema,
  BindHarnessStateResponseSchema,
  SessionEventPreviewSchema,
  type SessionEventPreview,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { AgentVersionEntrySchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/version_pb";
import { ExecutionValuesSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/values_pb";
import type { StigmerClient } from "../client/stigmer-client.js";
import {
  registerWorkerShutdownSignal,
  signalWorkerShutdown,
  unregisterWorkerShutdownSignal,
} from "../shared/worker-shutdown.js";
import { answerEventsFor, stampedActionOf } from "./approval-log.js";
import { decideCapturedFileChanges, type FileReviewVerdicts } from "./file-review-projection.js";
import { mockStigmerClient } from "./mock-client.js";

// ---------------------------------------------------------------------------
// The execution record: what the control plane would hold for one execution
// ---------------------------------------------------------------------------

/**
 * The three resources the activity's blueprint reads (the execution, the
 * session its target names, and the agent its status stamps at
 * `agent_id` / `agent_version_hash`, read as that version) plus the status
 * the server would hold. A record for the built-in assistant (the stamp
 * names no agent) has no agent: the blueprint must stop at the session, so
 * the client REFUSES every agent read instead of answering an empty
 * message.
 */
export interface ExecutionRecordInput {
  readonly execution: Run;
  readonly session: Session;
  readonly agent: Agent | undefined;
  /**
   * What `UpdateStatus` answers for each FULL status write — the platform's
   * STOP lever (`RunControlSignal`), decided by the control plane per
   * write and read by the harness stream loop on its mid-stream persist.
   * Evaluated AFTER the write lands, on the snapshot just persisted, so a
   * policy can key on the transcript ("stop once the first assistant message
   * is in"). Defaults to UNSPECIFIED: keep going.
   */
  readonly controlSignal?: (status: RunStatus) => RunControlSignal;
  /** The skills the control plane holds, answered by slug; any other reference is NotFound. */
  readonly skills?: readonly Skill[];
  /**
   * The saved agents the record's agent lists as subagents, answered by
   * reference (slug and pinned version: each one's `status.version_hash`);
   * any other reference is NotFound.
   */
  readonly subagents?: readonly Agent[];
}

/**
 * An in-memory stand-in for the server's execution row, with the THREE merge
 * rules and the ONE control lever the activity depends on, and no others:
 *
 *  - A status whose phase is UNSPECIFIED is a setup-progress report
 *    (`reportSetupProgress`): the server keeps `setup_progress` and leaves the
 *    phase and transcript alone. Modelled as: record the label, change nothing else.
 *  - Any other status replaces the held status wholesale (the runner is the
 *    writer of the transcript; the server's own field-ownership merge — approval
 *    fields it owns — is exercised by the test answering on the record between
 *    invocations, the answer on the log and the stamp on the row, exactly as
 *    the server's answer core does: `decideWaitingToolCalls`).
 *  - The fields the server stamps at create and the runner never sends — the
 *    agent and version the turn runs, the declared preferences and recalled
 *    memories — survive every runner write, as they do in the server's
 *    field-by-field merge, so a reinvocation reads the same stamp.
 *  - Every `UpdateStatus` answers a control signal ({@link ExecutionRecordInput.controlSignal});
 *    the server's STOP is the one instruction that travels back to the runner
 *    on this channel, and it is a server decision, so it is modelled here and
 *    not by the test hand-writing the client.
 *
 * Every persisted status is also kept in order (`persisted`) so a test can
 * assert the phase sequence the activity wrote, independent of the final state.
 *
 * The session's event log is modelled too, with the server's append rules
 * that the runner's emitter depends on: an id the log holds with the same
 * event is accepted again without a second entry, the same id with another
 * event is ALREADY_EXISTS, and a run whose held phase is finished takes no
 * more events (FAILED_PRECONDITION), which is what proves every event of a
 * turn lands before its terminal status. `listRunSessionEvents` answers
 * from it, so a reinvocation reads back what the first wrote, and
 * `listSessionEvents` pages it newest first by type, the read a turn's start
 * makes for the undos still owed.
 *
 * File review is modelled the way the server's decision core does it:
 * {@link decideCapturedFileChanges} decides the captured files, folds them
 * onto `status.file_change_sets` and writes each decision into the log as
 * `stigmer.file_review.decided`; {@link startReconcileTurn} creates the
 * reconcile turn an Undo on a finished run starts, a second run of the same
 * session (`RunSpec.reconcile_file_review`, no message) that the client
 * answers by its id.
 */
/** The log's type name of each event the hermetic log can hold that a typed read asks for (`event.proto`'s `event_type`). */
const LOG_TYPES: Partial<Record<NonNullable<SessionEvent["event"]["case"]>, string>> = {
  userMessage: "user.message",
  userToolConfirmation: "user.tool_confirmation",
  stigmerPermissionGrant: "stigmer.permission.grant",
  stigmerFileReviewChanges: "stigmer.file_review.changes",
  stigmerFileReviewDecided: "stigmer.file_review.decided",
  stigmerFileReviewReconciled: "stigmer.file_review.reconciled",
};

/** The phases the server treats as finished: an append for such a run is refused. */
const TERMINAL_PHASES: ReadonlySet<RunPhase> = new Set([
  RunPhase.RUN_COMPLETED,
  RunPhase.RUN_FAILED,
  RunPhase.RUN_CANCELLED,
  RunPhase.RUN_TERMINATED,
]);

export class ExecutionRecord {
  readonly execution: Run;
  readonly session: Session;
  readonly agent: Agent | undefined;
  private readonly controlSignal: (status: RunStatus) => RunControlSignal;
  private readonly skills: readonly Skill[];
  private readonly subagents: readonly Agent[];
  /** Every `updateStatus` payload, in order, snapshotted at write time. */
  readonly persisted: RunStatus[] = [];
  /** Fired after every full-status `applyStatusUpdate`; {@link whenToolCallsSettled} subscribes here. */
  private readonly persistListeners = new Set<() => void>();
  /** Setup-progress labels reported before the stream started, in order. */
  readonly setupProgress: string[] = [];
  /** Every `bindHarnessState` call, in order (the `harness_state_id` write-back). */
  readonly harnessBinds: { readonly runId: string; readonly harnessStateId: string }[] = [];
  /** The session's event log as the runner appended it, in order (one entry per distinct id). */
  readonly sessionEvents: SessionEvent[] = [];
  /** Every preview the runner sent, in order. */
  readonly sessionPreviews: SessionEventPreview[] = [];
  /** Ids the runner sent again although the log held them: a resumed turn that forgot what it wrote. */
  readonly resentEventIds: string[] = [];
  /** Every append the log refused, by its reason: a runner defect the emitter would drop silently. */
  readonly refusedAppends: string[] = [];
  /** The reconcile turn {@link startReconcileTurn} created, once it has; its status is its own. */
  reconcileRun: Run | undefined;
  /** Every status the reconcile turn's runner wrote, in order. */
  readonly reconcilePersisted: RunStatus[] = [];

  constructor(input: ExecutionRecordInput) {
    this.execution = clone(RunSchema, input.execution);
    this.session = input.session;
    this.agent = input.agent;
    this.controlSignal = input.controlSignal ?? (() => RunControlSignal.UNSPECIFIED);
    this.skills = input.skills ?? [];
    this.subagents = input.subagents ?? [];
  }

  get executionId(): string {
    return this.execution.metadata?.id ?? "";
  }

  /** The status the server would currently hold (what `getExecution` returns). */
  get status(): RunStatus | undefined {
    return this.execution.status;
  }

  /** The last FULL status written (phase set), or undefined if none yet. */
  get lastFullStatus(): RunStatus | undefined {
    for (let i = this.persisted.length - 1; i >= 0; i--) {
      const s = this.persisted[i];
      if (s.phase !== RunPhase.RUN_PHASE_UNSPECIFIED) return s;
    }
    return undefined;
  }

  /**
   * The ORDERED, DISTINCT phases the activity persisted — the deterministic
   * shape of the persist cadence. The COUNT of persists depends on the
   * debounce timer and is deliberately not exposed as an assertion surface.
   */
  get persistedPhases(): RunPhase[] {
    const out: RunPhase[] = [];
    for (const s of this.persisted) {
      if (s.phase === RunPhase.RUN_PHASE_UNSPECIFIED) continue;
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

  /**
   * Resolves once every one of `ids` is a row, in any state, in a status the
   * activity has persisted. The barrier {@link whenToolCallsSettled} gives
   * a turn that answers results, for a turn that runs beside a call still
   * running (a sub-agent's first turn, inside its parent's call); bounded
   * the same way.
   */
  whenToolCallsSeen(ids: readonly string[], timeoutMs = 10_000): Promise<void> {
    const unseen = (): string[] => {
      const seen = new Set(this.toolCalls().map((tc) => tc.id));
      return ids.filter((id) => !seen.has(id));
    };
    if (unseen().length === 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.persistListeners.delete(check);
        reject(new Error(`ExecutionRecord: tool call(s) ${unseen().join(", ")} never appeared in a persisted status within ${timeoutMs} ms`));
      }, timeoutMs);
      const check = (): void => {
        if (unseen().length > 0) return;
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
    const transcripts = [status.messages, ...status.subAgentRuns.map((s) => s.messages)];
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
   * What the server's answer core does when a person answers the calls that
   * asked (`confirmToolUse`, `grantPermission`): append the answer to the
   * session's log and stamp the row in the same act (`approval-log.ts`). The
   * runner owns `status`; the server owns `approval_action` — so this is the
   * ONE place a test answers, and the status stays WAITING_APPROVAL until the
   * resumed turn runs the tool, exactly as in production. The resumed turn
   * reads the answer from the log (`harness/approval-answers.ts`). `onlyId`
   * answers one of several calls paused in the same round and leaves the
   * rest waiting, as a person answering them one at a time does; a deny may
   * carry `denyMessage`, the reason the model reads.
   */
  decideWaitingToolCalls(action: ApprovalAction, decidedAt: string, onlyId?: string, denyMessage = ""): number {
    const waiting = this.waitingToolCalls().filter((tc) => onlyId === undefined || tc.id === onlyId);
    for (const tc of waiting) {
      this.sessionEvents.push(
        ...answerEventsFor({ sessionId: this.session.metadata?.id ?? "", runId: this.executionId }, tc, action, denyMessage),
      );
      tc.approvalAction = stampedActionOf(action);
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
    const decisions = decideCapturedFileChanges(this.execution.status, verdicts, decidedAt);
    for (const decision of decisions) {
      const id = `sevt_fd_${this.sessionEvents.length}`;
      this.sessionEvents.push(
        create(SessionEventSchema, {
          sessionId: this.session.metadata?.id ?? "",
          runId: this.executionId,
          event: {
            case: "stigmerFileReviewDecided",
            value: {
              id,
              changeSetId: decision.changeSetId,
              scope: "file",
              fileChangeId: decision.fileChangeId,
              action: decision.action === FileDecisionAction.REJECT ? "undo" : "keep",
              expectedDigest: decision.expectedDigest,
              origin: "person",
            },
          },
        }),
      );
    }
    return decisions.length;
  }

  /**
   * The reconcile turn the decision core starts for an Undo on a finished
   * run: a second run of this session with `reconcile_file_review` set and no
   * message, created as the server's create path would (in progress, nothing
   * on its status). The client answers it by its id from then on. Returns its
   * id.
   */
  startReconcileTurn(runId = `${this.executionId}-reconcile`): string {
    const spec = clone(RunSpecSchema, this.execution.spec ?? create(RunSpecSchema));
    spec.message = "";
    spec.reconcileFileReview = true;
    this.reconcileRun = create(RunSchema, {
      metadata: { org: this.execution.metadata?.org ?? "", id: runId, name: runId },
      spec,
      status: { phase: RunPhase.RUN_IN_PROGRESS },
    });
    return runId;
  }

  /** The reconcile turn's last full status (phase set), or undefined if it wrote none. */
  get reconcileFinalStatus(): RunStatus | undefined {
    return this.reconcilePersisted.filter((s) => s.phase !== RunPhase.RUN_PHASE_UNSPECIFIED).at(-1);
  }

  /** The run a request names: the reconcile turn's id answers it, any other this execution. */
  private runNamed(runId: string): Run {
    return this.reconcileRun !== undefined && runId === this.reconcileRun.metadata?.id ? this.reconcileRun : this.execution;
  }

  /** A write to the reconcile turn: kept as written, its phase held when the write carries none. */
  private applyReconcileStatus(status: RunStatus): RunControlSignal {
    const snapshot = clone(RunStatusSchema, status);
    this.reconcilePersisted.push(snapshot);
    const run = this.reconcileRun!;
    if (snapshot.phase === RunPhase.RUN_PHASE_UNSPECIFIED) {
      snapshot.phase = run.status?.phase ?? RunPhase.RUN_IN_PROGRESS;
    }
    run.status = snapshot;
    return RunControlSignal.UNSPECIFIED;
  }

  /**
   * The server's typed read of the log (`listEvents` with `types` and
   * `order`), newest first when asked: one page holds it all. Only the types
   * the runner asks for are named; any other event matches no type.
   */
  listSessionEventsPage(types: readonly string[], order: "asc" | "desc"): SessionEvent[] {
    const wanted = new Set(types);
    const matching = this.sessionEvents.filter((e) => e.event.case !== undefined && wanted.has(LOG_TYPES[e.event.case] ?? ""));
    const ordered = order === "desc" ? [...matching].reverse() : matching;
    return ordered.map((e) => clone(SessionEventSchema, e));
  }

  /**
   * Apply one `UpdateStatus` write and answer the control signal the server
   * would. A write with no phase never carries a signal (the runner ignores
   * the response there). It is a setup-progress report, or the transcript an
   * orchestrator stop settles (the runtime writes no phase for it; the
   * workflow does, stigmer#980): the server's merge applies the transcript and
   * leaves the phase to its writers, so the double keeps the held phase.
   */
  applyStatusUpdate(status: RunStatus): RunControlSignal {
    const snapshot = clone(RunStatusSchema, status);
    this.persisted.push(snapshot);
    if (snapshot.phase === RunPhase.RUN_PHASE_UNSPECIFIED) {
      if (snapshot.setupProgress?.currentPhase) {
        this.setupProgress.push(snapshot.setupProgress.currentPhase);
      }
      if (snapshot.messages.length > 0) {
        const heldPhase = this.execution.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
        this.execution.status = this.keepServerStamp(snapshot);
        this.execution.status.phase = heldPhase;
        for (const listener of [...this.persistListeners]) listener();
      }
      return RunControlSignal.UNSPECIFIED;
    }
    this.execution.status = this.keepServerStamp(snapshot);
    for (const listener of [...this.persistListeners]) listener();
    return this.controlSignal(snapshot);
  }

  /** The server's append rules over the modelled log (the class header). */
  appendSessionEvents(runId: string, events: readonly SessionEvent[], previews: readonly SessionEventPreview[]): void {
    const phase = this.runNamed(runId).status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
    if (TERMINAL_PHASES.has(phase)) {
      this.refusedAppends.push(`run '${runId}' is finished`);
      throw new ConnectError(`run '${runId}' is finished; it takes no more events`, Code.FailedPrecondition);
    }
    const fresh: SessionEvent[] = [];
    for (const event of events) {
      const id = event.event.case === undefined ? "" : event.event.value.id;
      const held = [...this.sessionEvents, ...fresh].find((e) => e.event.case !== undefined && e.event.value.id === id);
      if (held !== undefined) {
        if (!equals(SessionEventSchema, held, event)) {
          this.refusedAppends.push(`'${id}' exists with other content`);
          throw new ConnectError(`session event '${id}' already exists with other content`, Code.AlreadyExists);
        }
        this.resentEventIds.push(id);
        continue;
      }
      const own = clone(SessionEventSchema, event);
      own.runId = runId;
      fresh.push(own);
    }
    this.sessionEvents.push(...fresh);
    this.sessionPreviews.push(...previews.map((p) => clone(SessionEventPreviewSchema, p)));
  }

  /**
   * The modelled log as a golden: one protobuf JSON object per event, with
   * its envelope's thread, in append order. What the runner sent, before
   * the server stamps a seq or an accepted time. Throws when the runner
   * resent an id the log held or had an append refused, so every golden
   * also proves a resumed turn writes only what is new and that nothing
   * landed after the run finished.
   */
  eventsGolden(): string {
    if (this.resentEventIds.length > 0 || this.refusedAppends.length > 0) {
      throw new Error(
        `the session log saw resent ids [${this.resentEventIds.join(", ")}] and refusals [${this.refusedAppends.join("; ")}]`,
      );
    }
    return JSON.stringify(this.sessionEvents.map((e) => toJson(SessionEventSchema, e, { useProtoFieldName: true })), null, 2) + "\n";
  }

  /** The runner's write with the server-stamped fields of the held status carried over. */
  private keepServerStamp(snapshot: RunStatus): RunStatus {
    const next = clone(RunStatusSchema, snapshot);
    const held = this.execution.status;
    if (held === undefined) return next;
    next.agentId = held.agentId;
    next.agentVersionHash = held.agentVersionHash;
    next.declaredPreferences = held.declaredPreferences;
    next.recalledMemories = held.recalledMemories;
    // The settings the turn runs with and the lane's approval mode are
    // stamped once at create; the server's merge never takes them from a
    // runner write, so every later invocation reads the same resolution.
    next.runConfig = held.runConfig;
    next.approvalMode = held.approvalMode;
    return next;
  }

  /**
   * The control-plane client the activity sees: every read answers from this
   * record; every write lands in it. Reads the activity makes for optional
   * facets (the run's values, channels, skills) answer the everyday shape —
   * no values (a run whose declarations hold none), no channels, no scoped
   * token (the OSS/local posture) — so a scenario opts INTO a facet by
   * overriding.
   */
  client(overrides: Partial<StigmerClient> = {}): StigmerClient {
    return mockStigmerClient({
      getExecution: vi.fn(async (id: string) => clone(RunSchema, this.runNamed(id))),
      getSession: vi.fn(async () => this.session),
      getAgent: vi.fn(async () => {
        if (this.agent === undefined) {
          throw new Error("the built-in assistant's record has no agent to read");
        }
        return this.agent;
      }),
      getAgentVersion: vi.fn(async (agentId: string, versionHash: string) => {
        if (this.agent === undefined) {
          throw new Error("the built-in assistant's record has no agent version to read");
        }
        if (agentId !== this.agent.metadata?.id || versionHash !== this.execution.status?.agentVersionHash) {
          throw new ConnectError(`agent version not found: ${agentId}@${versionHash}`, Code.NotFound);
        }
        return create(AgentVersionEntrySchema, { versionHash, specSnapshot: this.agent.spec });
      }),
      updateStatus: vi.fn(async (id: string, status: RunStatus) => {
        // The activity reads only `.signal`; UNSPECIFIED means "keep going".
        const signal = this.runNamed(id) === this.execution ? this.applyStatusUpdate(status) : this.applyReconcileStatus(status);
        return create(UpdateStatusResponseSchema, { signal });
      }),
      bindHarnessState: vi.fn(async (runId: string, harnessStateId: string) => {
        this.harnessBinds.push({ runId, harnessStateId });
        return create(BindHarnessStateResponseSchema, { harnessStateId });
      }),
      appendSessionEvents: vi.fn(async (runId: string, events: readonly SessionEvent[], previews: readonly SessionEventPreview[]) => {
        this.appendSessionEvents(runId, events, previews);
        return create(AppendSessionEventsResponseSchema);
      }),
      listRunSessionEvents: vi.fn(async (_sessionId: string, runId: string, types: readonly string[] = []) =>
        this.sessionEvents
          .filter((e) => e.runId === runId)
          .filter((e) => types.length === 0 || (e.event.case !== undefined && types.includes(LOG_TYPES[e.event.case] ?? "")))
          .map((e) => clone(SessionEventSchema, e)),
      ),
      listSessionEvents: vi.fn(async (_sessionId: string, query: { readonly types: readonly string[]; readonly order: "asc" | "desc" }) => ({
        events: this.listSessionEventsPage(query.types, query.order),
        nextPageToken: "",
      })),
      // A run whose agent and tools declare nothing: the fetch answers no values.
      fetchExecutionValues: vi.fn(async () => create(ExecutionValuesSchema)),
      getAgentByReference: vi.fn(async (ref: ApiResourceReference) => {
        const agent = this.subagents.find(
          (a) => a.metadata?.slug === ref.slug && (ref.version === "" || a.status?.versionHash === ref.version),
        );
        if (agent === undefined) throw new ConnectError(`agent not found: ${ref.slug}@${ref.version}`, Code.NotFound);
        return agent;
      }),
      getSkillByReference: vi.fn(async (ref: ApiResourceReference) => {
        const skill = this.skills.find((s) => s.metadata?.slug === ref.slug);
        if (skill === undefined) throw new ConnectError(`skill not found: ${ref.slug}`, Code.NotFound);
        return skill;
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
 * drain from a user pause (`classifyTurnInterruption`). `cancelTimedOut()`
 * aborts it with Temporal's own reason, `TIMED_OUT` (a heartbeat timeout),
 * the cancellation the turn reads as infrastructure.
 */
export interface InvocationControls {
  cancel(): void;
  signalWorkerShutdown(): void;
  cancelTimedOut(): void;
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
    cancelTimedOut: () => env.cancel("TIMED_OUT"),
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
