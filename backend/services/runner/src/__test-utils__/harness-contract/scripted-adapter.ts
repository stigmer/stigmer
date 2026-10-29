/**
 * The scripted harness adapter — the reference implementation of
 * `HarnessAdapter`, driven by a `TurnScenario` per turn instead of a vendor
 * SDK.
 *
 * Two jobs. It is the fake the contract kit runs against, so the kit is
 * proven before any real adapter implements the contract. And it is the TEMPLATE a future harness author
 * reads first: every rule of the contract appears here as the smallest code
 * that honours it, with the reason beside it. Its measured line count is the
 * program's "lines a new harness must write" data point.
 *
 * The insight this fake makes visible: above the contract line, a pause is
 * a turn that ends `awaiting_approval` with a WAITING row on the rows, and
 * the next invocation carries the decision. How the engine RESUMES is the
 * adapter's business, below the line, and the runtime never sees it.
 *
 * What is deliberately simple here and would be real work in an adapter:
 * "executing" a side effect is incrementing a counter; there is no engine event to translate, so each step emits
 * the canonical `TranscriptEvent`s a translator would (a run for a `say`, a
 * start and a finish for a tool, a proposal for a gate) straight into
 * `sink.transcript` — the one way any harness creates a transcript row, and
 * the whole of what a real adapter's translator adds on top of this file.
 * What is NOT simplified is the contract behaviour itself —
 * settling with an outcome and never rejecting, stopping at every step
 * boundary and inside a hang, executing an approval exactly once — because
 * those are what the kit measures.
 *
 * What this fake deliberately does NOT do, because it is not an adapter's
 * job: carry a REJECTed or SKIPped row to its terminal status. The decision
 * is on the row (the server's field) and the transition follows from it with
 * no engine knowledge, so it belongs to the runtime — one writer per field,
 * as `approval-answers.ts` is the runtime's one reader and
 * `terminalizeNonExecutingDecisions` its one writer (landed in #1096,
 * `harness/approval-decisions.ts`). An adapter's whole duty for a
 * non-executing decision is to not execute.
 *
 * An `open` operation is a latch the kit releases: the row starts, the
 * operation parks on the latch or the stop signal (never a timer), each line
 * the kit emits is a `tool_output_delta` with an activity mark — the least a
 * harness owes for output it streams — and the release finishes the row. A
 * finished operation is in the engine's memory, so a turn that continues
 * does not run it again; one the stop cut is not.
 *
 * A message a person sends while the turn works (`message`) is sent as the
 * fake plays the step before it, through the kit's person, and read at the
 * `message` step, its next step: the fake claims what waits
 * (`TurnSink.input`) and takes every message the run took that it has not
 * read, as an engine delivers what it claimed once. A turn's end asks once
 * more, so a message sent as it finished is read by it. What it read is in
 * its memory per session, so a continued turn never reads one twice.
 *
 * A continued invocation is never handed the task: the engine picks the
 * turn up from its memory, the rule every harness keeps (stigmer#2417). The
 * fake records what each invocation was handed, the task or a continuation,
 * so the kit can count it. Either kind remembers which runs' input it
 * took, so a run it already took is never handed again, even when nothing
 * of it reached the session's log. That memory alone decides, as a saved
 * state stamped with its run does, and it also remembers which runs it
 * finished, so a run it finished runs nothing (stigmer#2487).
 *
 * A yield (`sink.yieldSignal`) is taken at the next step boundary: every
 * step here is durable the moment it ends (the engine's memory is this
 * object), so the boundary between two steps is where a real engine's
 * saved step would be. An open operation is never cut to yield; it finishes
 * first. The
 * fake has no subagents and no context, so `open(…, { as: "subagent" })` and
 * `compact()` are refused as test bugs; its registrations declare both off.
 *
 * Scenarios are arranged PER SESSION (the engine is per session in every real
 * harness; a subject arranges that session's engine), and arranging replaces
 * what that session had not yet played. A `runTurn` with no scenario arranged
 * for its session is a test bug and throws; every other exit is a
 * `TurnOutcome`.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import type { Config } from "../../config.js";
import type { HarnessCapabilities } from "../../harness/capabilities.js";
import type { HarnessAdapter, TurnInput, TurnOutcome, TurnSink } from "../../harness/types.js";
import { DEEP_AGENT_VISION_PROFILE } from "../../shared/attachment-vision.js";
import type { ProposedAction } from "../approval-contract/types.js";
import { testConfig } from "../config-fixture.js";
import { messageAfter } from "./types.js";
import type { EngineView, HarnessContractSubject, LongTurnControls, ScenarioStep, TurnScenario } from "./types.js";
import { ApprovalAction } from "../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

export interface ScriptedHarnessOptions {
  /** Diagnostic name; defaults to `scripted`. */
  readonly name?: string;
  /**
   * The subject's `Config` over `testConfig()`'s inert defaults. The fake reads
   * none of it; the RUNTIME does when the subject runs through the real
   * activity (the workspace root it provisions under, the task queue the
   * drain signal is keyed by).
   */
  readonly config?: Partial<Config>;
}

/**
 * Resolves when the signal aborts; resolves at once if it already has. Parks
 * on the abort EVENT, never on a timer, so a hanging turn holds nothing that
 * could keep a process alive — the property the runtime's heartbeat relies
 * on when it declares a stalled turn dead.
 */
function whenAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

export class ScriptedHarnessAdapter implements HarnessAdapter {
  readonly name: string;
  readonly capabilities: HarnessCapabilities;

  /** The next turn each session plays; arranging a session replaces its entry. */
  private readonly arranged = new Map<string, TurnScenario>();
  private readonly executions = new Map<string, number>();
  /**
   * The engine's memory, per session: the calls it has carried out or moved
   * past. A real engine keeps this in its own state (a checkpoint, a vendor
   * agent); the runtime hands a resumed turn only the asks it resumes onto,
   * never the rows an earlier invocation settled.
   */
  private readonly settledCalls = new Map<string, Set<string>>();
  private readonly hangWaiters: Array<() => void> = [];
  /** The operations an `open` step started and the kit has not yet released, by tool-call id. */
  private readonly openOperations = new Map<string, OpenOperation>();
  private readonly openWaiters = new Map<string, Array<() => void>>();
  /** The ids the kit has released: an operation opened under one of them later finishes at once. */
  private readonly released = new Set<string>();
  /** How many times each operation began. */
  private readonly opens = new Map<string, number>();
  /** The executions whose input this engine took: the engine's saved run stamp. */
  private readonly tookRuns = new Set<string>();
  /** The executions whose turn this engine finished: the engine's saved "done". */
  private readonly finishedRuns = new Set<string>();
  /** Per session, every message the engine was handed as a new request. */
  private readonly handed = new Map<string, string[]>();
  /** Per session, the kit's person, as the last arrange handed it. */
  private readonly persons = new Map<string, (text: string) => void>();
  /** Per session, the `message` steps already sent: a replayed script never sends one twice. */
  private readonly sentMessages = new Map<string, Set<string>>();
  /** Per session, every message a person sent that the engine read, by id, in the order read. */
  private readonly readMessages = new Map<string, Map<string, string>>();
  /** One `runId` per `say`, as an engine mints one per model run; the builder keys a message on it. */
  private runCounter = 0;

  constructor(options: ScriptedHarnessOptions) {
    this.name = options.name ?? "scripted";
    this.capabilities = {
      harness: Harness.STIGMER,
      subAgents: false,
      runsHooks: true,
      visionProfile: DEEP_AGENT_VISION_PROFILE,
      fileReview: { harnessId: "scripted", excludePaths: [] },
      contextCompaction: "none",
    };
  }

  /**
   * Resolves the next time a turn parks on a `hang` step — for a test that
   * stands where the runtime's watchdog stands and needs to know the engine
   * is silent before it advances the clock. Never on a timer.
   */
  whenHanging(): Promise<void> {
    return new Promise((resolve) => this.hangWaiters.push(resolve));
  }

  // ── Engine controls (the subject's side of the kit seam) ──────────────────

  /**
   * What the session's next `runTurn` plays. The rest of the view is not
   * needed here: this fake reads its decisions from `input.approvalDecisions`
   * and settles a repeated proposal from its own memory, so it has nothing to
   * decide before the turn.
   */
  arrange(turn: TurnScenario, view: Pick<EngineView, "sessionId" | "sendMessage">): void {
    this.arranged.set(view.sessionId, turn);
    this.persons.set(view.sessionId, view.sendMessage);
  }

  executionCount(toolCallId: string): number {
    return this.executions.get(toolCallId) ?? 0;
  }

  /** Resolves once the `open` operation behind `toolCallId` has started. Never on a timer. */
  whenOpen(toolCallId: string): Promise<void> {
    if (this.openOperations.has(toolCallId)) return Promise.resolve();
    return new Promise((resolve) => this.openWaiters.set(toolCallId, [...(this.openWaiters.get(toolCallId) ?? []), resolve]));
  }

  /** The open operation prints `line`: one `tool_output_delta` and an activity mark. */
  async emit(toolCallId: string, line: string): Promise<void> {
    const operation = this.openOperations.get(toolCallId);
    if (!operation) throw new Error(`${this.name}: emit(${toolCallId}) with no such operation open (kit bug)`);
    operation.sink.transcript.apply({ kind: "tool_output_delta", callId: toolCallId, delta: `${line}\n` });
    operation.sink.recordActivity("shell");
  }

  /** Let the operation finish; an operation opened later under the same id finishes at once. */
  async release(toolCallId: string): Promise<void> {
    const operation = this.openOperations.get(toolCallId);
    this.released.add(toolCallId);
    operation?.release();
  }

  /** How many times the operation behind `toolCallId` began. */
  opened(toolCallId: string): number {
    return this.opens.get(toolCallId) ?? 0;
  }

  /** How many times the session's engine was handed `message` as a new request. */
  tasksHanded(sessionId: string, message: string): number {
    return (this.handed.get(sessionId) ?? []).filter((m) => m === message).length;
  }

  /** How many times the session's engine read `text` as a message a person sent while its turn worked. */
  messagesRead(sessionId: string, text: string): number {
    return [...(this.readMessages.get(sessionId)?.values() ?? [])].filter((read) => read === text).length;
  }

  /** Drop the engine's memory of a session: the self-check's adapter that forgets what it ran. */
  forgetSettled(sessionId: string): void {
    this.settledCalls.delete(sessionId);
  }

  private hasSettled(sessionId: string, toolCallId: string): boolean {
    return this.settledCalls.get(sessionId)?.has(toolCallId) ?? false;
  }

  private settle(sessionId: string, toolCallId: string): void {
    const calls = this.settledCalls.get(sessionId) ?? new Set<string>();
    calls.add(toolCallId);
    this.settledCalls.set(sessionId, calls);
  }

  // ── HarnessAdapter ────────────────────────────────────────────────────────

  /** Nothing to install: a real adapter imports its SDK lazily and installs its transport here. */
  async boot(_config: Config): Promise<void> {}

  /** Nothing held: a real adapter closes every engine it still has parked. */
  async shutdown(): Promise<void> {}

  /** Nothing is parked per session here; a real adapter releases the engine it parked for `sessionId`. */
  async releaseSession(_sessionId: string): Promise<void> {}

  async runTurn(input: TurnInput, sink: TurnSink): Promise<TurnOutcome> {
    const turn = this.arranged.get(input.sessionId);
    if (!turn) throw new Error(`${this.name}: runTurn called with no scenario arranged for session '${input.sessionId}' (test bug)`);
    this.arranged.delete(input.sessionId);

    // The signals may be aborted before the turn is entered; do no work then.
    if (sink.stopSignal.aborted || sink.yieldSignal.aborted) return { kind: "interrupted" };

    // A first invocation hands the engine the execution's message as a new
    // request; a continued one never does (the header).
    const continued = this.tookRuns.has(input.executionId);
    if (!continued) {
      this.handed.set(input.sessionId, [...(this.handed.get(input.sessionId) ?? []), input.execution.spec?.message ?? ""]);
    }
    this.tookRuns.add(input.executionId);

    // An engine that already finished this run has nothing left to run.
    if (this.finishedRuns.has(input.executionId)) {
      return { kind: "completed" };
    }

    for (const [index, step] of turn.entries()) {
      // Stop, or yield, at every step boundary.
      if (sink.stopSignal.aborted || sink.yieldSignal.aborted) return { kind: "interrupted" };
      this.sendDuring(turn, index, input.sessionId);
      const ended = await this.play(step, input, sink);
      if (ended) return ended;
    }
    // The round's end asks once more: a message sent as the turn finished is its own.
    await this.readMessagesOf(input.sessionId, sink);
    this.finishedRuns.add(input.executionId);
    return { kind: "completed" };
  }

  /** Play one step; returns the outcome that ends the turn, or undefined to continue. */
  private async play(step: ScenarioStep, input: TurnInput, sink: TurnSink): Promise<TurnOutcome | undefined> {
    switch (step.kind) {
      case "say": {
        // One model run: start, its text, finish — the shape every
        // translator emits for an assistant message.
        const runId = `run-${++this.runCounter}`;
        sink.transcript.apply({ kind: "message_start", runId });
        sink.transcript.apply({ kind: "text_delta", runId, text: step.text });
        sink.transcript.apply({ kind: "message_finish", runId });
        sink.recordActivity();
        // Awaited: a platform STOP the runtime reads from this write aborts the signal before the next
        // step boundary sees it (the contract's "MAY await for ordering").
        await sink.requestPersist();
        return undefined;
      }
      case "propose":
        if (step.flows) return this.flowingWrite(step.toolCallId, step.action, input, sink);
        return this.propose(step.toolCallId, step.action, input, sink);
      case "read": {
        // Ungated: the row starts and finishes at once, the effect counts as
        // run, and the persist is awaited like `say`'s — a real engine's tool
        // call is the discrete event its loop flushes on. The builder puts
        // the row on the message whose text preceded it.
        sink.transcript.apply({ kind: "tool_started", callId: step.toolCallId, name: "read", input: { path: step.path }, mcpServerSlug: "" });
        sink.transcript.apply({ kind: "tool_finished", callId: step.toolCallId, result: `contents of ${step.path}` });
        this.executions.set(step.toolCallId, this.executionCount(step.toolCallId) + 1);
        sink.recordActivity("read");
        await sink.requestPersist();
        return undefined;
      }
      case "usage": {
        sink.reportUsage(step.delta);
        sink.recordActivity();
        return undefined;
      }
      case "hang": {
        for (const waiter of this.hangWaiters.splice(0)) waiter();
        await whenAborted(sink.stopSignal);
        return { kind: "interrupted" };
      }
      case "fail":
        return { kind: "failed", surface: step.surface, message: step.message };
      case "limit":
        return { kind: "tool_call_limit" };
      case "open":
        if (step.as === "subagent") throw new Error(`${this.name}: open(…, { as: "subagent" }) is not producible by this fake (it has no subagents); test bug`);
        if (this.hasSettled(input.sessionId, step.toolCallId)) return undefined;
        return this.openOperation(step.toolCallId, input.sessionId, sink);
      case "compact":
        throw new Error(`${this.name}: compact() is not producible by this fake (it keeps no context); test bug`);
      case "message":
        await this.readMessagesOf(input.sessionId, sink);
        return undefined;
      default: {
        const exhaustive: never = step;
        throw new Error(`${this.name}: unknown scenario step ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  /** The kit's person sends the `message` step after the step at `index`, once per session (the header). */
  private sendDuring(turn: TurnScenario, index: number, sessionId: string): void {
    const message = messageAfter(turn, index);
    const sent = this.sentMessages.get(sessionId) ?? new Set<string>();
    if (message === undefined || sent.has(message.text)) return;
    sent.add(message.text);
    this.sentMessages.set(sessionId, sent);
    this.persons.get(sessionId)?.(message.text);
  }

  /** Read what waits for the turn, and what the run took and this engine has not read (the header). */
  private async readMessagesOf(sessionId: string, sink: TurnSink): Promise<void> {
    const read = this.readMessages.get(sessionId) ?? new Map<string, string>();
    this.readMessages.set(sessionId, read);
    await sink.input.claim({ force: true });
    for (const message of await sink.input.claimed(new Set(read.keys()))) {
      read.set(message.id, message.text);
    }
  }

  /**
   * A tool that runs until the kit releases it: the row starts with an
   * activity mark and a persist (a real engine's tool start is a discrete
   * event), the operation parks on the release or the stop signal, and the
   * release finishes the row.
   */
  private async openOperation(toolCallId: string, sessionId: string, sink: TurnSink): Promise<TurnOutcome | undefined> {
    this.opens.set(toolCallId, this.opened(toolCallId) + 1);
    sink.transcript.apply({ kind: "tool_started", callId: toolCallId, name: "shell", input: { command: `kit operation ${toolCallId}` }, mcpServerSlug: "" });
    sink.recordActivity("shell");
    await sink.requestPersist();
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    this.openOperations.set(toolCallId, { sink, release });
    if (this.released.has(toolCallId)) release();
    for (const waiter of this.openWaiters.get(toolCallId) ?? []) waiter();
    this.openWaiters.delete(toolCallId);
    try {
      await Promise.race([released, whenAborted(sink.stopSignal)]);
    } finally {
      this.openOperations.delete(toolCallId);
    }
    if (sink.stopSignal.aborted) return { kind: "interrupted" };
    sink.transcript.apply({ kind: "tool_finished", callId: toolCallId, result: "done" });
    this.executions.set(toolCallId, this.executionCount(toolCallId) + 1);
    this.settle(sessionId, toolCallId);
    sink.recordActivity("shell");
    await sink.requestPersist();
    return undefined;
  }

  /**
   * The gate, above the contract line. The engine's memory says whether the
   * effect ran: a call an earlier invocation carried out or moved past is
   * settled and the step is a no-op, which is what makes "reinvoked twice
   * with the same decision, still once" hold.
   */
  private async propose(
    toolCallId: string,
    action: ProposedAction,
    input: TurnInput,
    sink: TurnSink,
  ): Promise<TurnOutcome | undefined> {
    if (this.hasSettled(input.sessionId, toolCallId)) return undefined;

    const decision = input.approvalDecisions.get(toolCallId) ?? ApprovalAction.UNSPECIFIED;
    switch (decision) {
      case ApprovalAction.UNSPECIFIED: {
        // Propose: surface the gated call as a WAITING row and stop the turn.
        // `approval_proposed` is an upsert by id — a resumed turn that
        // re-proposes reopens the seeded row, never writes a second one. No
        // `args` on purpose: a `write` carrying whole-file content would make
        // the runtime's exact-apply eligible on APPROVE, and this fake's
        // execution count would then measure a path the engine never ran.
        sink.transcript.apply({
          kind: "approval_proposed",
          callId: toolCallId,
          name: action.kind,
          mcpServerSlug: "",
          message: `Approve ${action.kind} ${action.resource}?`,
        });
        sink.recordActivity();
        sink.requestPersist();
        return { kind: "awaiting_approval" };
      }
      case ApprovalAction.APPROVE:
      case ApprovalAction.APPROVE_ALL: {
        this.executions.set(toolCallId, this.executionCount(toolCallId) + 1);
        this.settle(input.sessionId, toolCallId);
        await this.completeRow(toolCallId, action, sink);
        return undefined;
      }
      case ApprovalAction.SKIP:
      case ApprovalAction.REJECT: {
        // Not executed, and the row is left as the runtime handed it (see
        // the header): the engine simply moves on.
        this.settle(input.sessionId, toolCallId);
        sink.recordActivity();
        return undefined;
      }
      default: {
        const exhaustive: never = decision;
        throw new Error(`${this.name}: unknown approval action ${String(exhaustive)}`);
      }
    }
  }

  /**
   * A write under apply-then-review capture: no gate — the engine writes the
   * bytes into the workspace and reports a COMPLETED `write` row, and the
   * RUNTIME captures the change for review after the turn. The bytes are the
   * fake's own (the tool-call id, one line); a call already carried out on a
   * reinvocation is a no-op, as `propose`'s is.
   */
  private async flowingWrite(toolCallId: string, action: ProposedAction, input: TurnInput, sink: TurnSink): Promise<TurnOutcome | undefined> {
    if (this.hasSettled(input.sessionId, toolCallId)) return undefined;
    this.settle(input.sessionId, toolCallId);
    const file = join(input.workspace.primaryDir, action.resource);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${toolCallId}\n`);
    sink.transcript.apply({ kind: "tool_started", callId: toolCallId, name: "write", input: { path: action.resource }, mcpServerSlug: "" });
    sink.transcript.apply({ kind: "tool_finished", callId: toolCallId, result: "" });
    this.executions.set(toolCallId, this.executionCount(toolCallId) + 1);
    sink.recordActivity("write");
    await sink.requestPersist();
    return undefined;
  }

  /**
   * Report the executed action on its row, as a real engine's re-issue does:
   * a start (which flips the seeded WAITING row to RUNNING — or creates the
   * row when a runtime decided out of band and no row exists, so the fact is
   * recorded rather than lost) and a finish.
   */
  private async completeRow(toolCallId: string, action: ProposedAction, sink: TurnSink): Promise<void> {
    sink.transcript.apply({ kind: "tool_started", callId: toolCallId, name: action.kind, input: {}, mcpServerSlug: "" });
    sink.transcript.apply({ kind: "tool_finished", callId: toolCallId, result: "" });
    sink.recordActivity();
    // Awaited like `read`'s: the approved call is the engine's discrete
    // event, and a drain or STOP the runtime reads from this write is seen
    // at the next step boundary.
    await sink.requestPersist();
  }
}

/** One operation an `open` step holds: the sink it reports through and the latch the kit releases. */
interface OpenOperation {
  readonly sink: TurnSink;
  readonly release: () => void;
}

/** The scripted adapter as a kit subject: the adapter IS its own engine, so the seam is a thin view over it. */
export interface ScriptedSubject extends HarnessContractSubject {
  readonly adapter: ScriptedHarnessAdapter;
}

/**
 * The fake declares the `stigmer` row: in #1070 the runtime served that row
 * through this fake alone; since #1096 the real Stigmer adapter takes it over
 * in the runtime half
 * (`execute-deep-agent/__test-utils__/contract-subject.ts`), and the fake
 * keeps declaring it so the kit's self-check runs a full subject under both
 * pause primitives without an engine.
 */
export function scriptedSubject(options: ScriptedHarnessOptions): ScriptedSubject {
  const adapter = new ScriptedHarnessAdapter(options);
  return {
    name: adapter.name,
    harness: "stigmer",
    adapter,
    config: testConfig(options.config),
    arrange: (turn, view) => adapter.arrange(turn, view),
    whenHanging: () => adapter.whenHanging(),
    executionCount: (toolCallId) => adapter.executionCount(toolCallId),
    longTurn: scriptedLongTurn(adapter),
  };
}

/** The fake's long-turn controls; it never compacts (it keeps no context), so its count is zero. */
function scriptedLongTurn(adapter: ScriptedHarnessAdapter): LongTurnControls {
  return {
    whenOpen: (toolCallId) => adapter.whenOpen(toolCallId),
    emit: (toolCallId, line) => adapter.emit(toolCallId, line),
    release: (toolCallId) => adapter.release(toolCallId),
    opened: (toolCallId) => adapter.opened(toolCallId),
    tasksHanded: (sessionId, message) => adapter.tasksHanded(sessionId, message),
    messagesRead: (sessionId, text) => adapter.messagesRead(sessionId, text),
    compactions: () => 0,
    compactionSummary: { text: "no context" },
    // What it keeps between invocations is already as a killed process leaves it.
    loseRunner: () => {},
  };
}
