/**
 * The scripted harness adapter — the reference implementation of
 * `HarnessAdapter`, driven by a `TurnScenario` per turn instead of a vendor
 * SDK.
 *
 * Two jobs. It is the fake the contract kit runs against under every
 * capability combination, so the kit is proven before any real adapter
 * implements the contract. And it is the TEMPLATE a future harness author
 * reads first: every rule of the contract appears here as the smallest code
 * that honours it, with the reason beside it. Its measured line count is the
 * program's "lines a new harness must write" data point.
 *
 * The insight this fake makes visible: above the contract line, the two real
 * pause primitives are indistinguishable. Whether the engine checkpoints at
 * the gate (`interrupt`) or a hook denies the tool and the run is cancelled
 * (`deny-and-retry`), the turn ends `awaiting_approval` with a WAITING row on
 * the status, and the next invocation carries the decision. How the engine
 * RESUMES is the adapter's business, below the line, and the runtime never
 * sees it. So this fake takes `pausePrimitive` as an option and does not
 * branch on it — and the kit runs it under both to prove the kit does not
 * branch on it either.
 *
 * What is deliberately simple here and would be real work in an adapter:
 * "executing" a side effect is incrementing a counter; the engine state id is
 * a counter too; the transcript rows are built with the shared proto
 * factories. What is NOT simplified is the contract behaviour itself —
 * settling with an outcome and never rejecting, stopping at every step
 * boundary and inside a hang, binding before the first persist, executing an
 * approval exactly once, refusing to resume a state it never minted — because
 * those are what the kit measures.
 *
 * What this fake deliberately does NOT do, because it is not an adapter's
 * job: carry a REJECTed or SKIPped row to its terminal status. The decision
 * is on the row (the server's field) and the transition follows from it with
 * no engine knowledge, so it belongs to the runtime — one writer per field,
 * as `approvalDecisionsOf` is the runtime's one reader (S2 M4, Q-M4-1; the
 * runtime's arm lands in S3). An adapter's whole duty for a non-executing
 * decision is to not execute.
 *
 * Scenarios are arranged PER SESSION (the engine is per session in every real
 * harness; a subject arranges that session's engine), and arranging replaces
 * what that session had not yet played. A `runTurn` with no scenario arranged
 * for its session is a test bug and throws (the same rule as the scripted
 * `@cursor/sdk` agent's `send()` with no script left); every other exit is a
 * `TurnOutcome`.
 */

import { ApprovalAction, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";

import type { Config } from "../../config.js";
import type { HarnessCapabilities, PausePrimitive, StateIdSource } from "../../harness/capabilities.js";
import type { HarnessAdapter, TurnInput, TurnOutcome, TurnSink } from "../../harness/types.js";
import { DEEP_AGENT_VISION_PROFILE } from "../../shared/attachment-vision.js";
import type { ProposedAction } from "../approval-contract/types.js";
import { testConfig } from "../config-fixture.js";
import { aiMessage, findToolCallRow, toolCall, waitingToolCall } from "../proto-helpers.js";
import type { EngineView, HarnessContractSubject, ScenarioStep, TurnScenario } from "./types.js";

export interface ScriptedHarnessOptions {
  /** Diagnostic name; defaults to a name that says which primitives this instance runs under. */
  readonly name?: string;
  readonly pausePrimitive: PausePrimitive;
  readonly stateIdSource: StateIdSource;
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

/** A proposal already carried to a terminal row has been settled by an earlier invocation. */
function isSettled(row: ToolCall | undefined): boolean {
  return row !== undefined
    && (row.status === ToolCallStatus.TOOL_CALL_COMPLETED || row.status === ToolCallStatus.TOOL_CALL_SKIPPED);
}

export class ScriptedHarnessAdapter implements HarnessAdapter {
  readonly name: string;
  readonly capabilities: HarnessCapabilities;

  /** The next turn each session plays; arranging a session replaces its entry. */
  private readonly arranged = new Map<string, TurnScenario>();
  private readonly mintedStateIds = new Set<string>();
  private readonly executions = new Map<string, number>();
  private readonly hangWaiters: Array<() => void> = [];
  private mintCounter = 0;

  constructor(options: ScriptedHarnessOptions) {
    this.name = options.name ?? `scripted(${options.pausePrimitive}, ${options.stateIdSource})`;
    this.capabilities = {
      pausePrimitive: options.pausePrimitive,
      stateIdSource: options.stateIdSource,
      systemPrompt: true,
      subAgents: false,
      toolRestriction: true,
      visionProfile: DEEP_AGENT_VISION_PROFILE,
      fileReview: { harnessId: "scripted", excludePaths: [] },
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
   * and settles a repeated proposal from the row itself, so it has nothing to
   * decide before the turn.
   */
  arrange(turn: TurnScenario, view: Pick<EngineView, "sessionId">): void {
    this.arranged.set(view.sessionId, turn);
  }

  executionCount(toolCallId: string): number {
    return this.executions.get(toolCallId) ?? 0;
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

    // The signal may be aborted before the turn is entered; do no work then.
    if (sink.stopSignal.aborted) return { kind: "interrupted" };

    const resumed = await this.resolveEngineState(input, sink);
    if (resumed.kind !== "ok") return resumed.outcome;

    for (const step of turn) {
      // Stop at every step boundary — the Cursor loop's per-event isCancelled().
      if (sink.stopSignal.aborted) return { kind: "interrupted" };
      const ended = await this.play(step, input, sink);
      if (ended) return ended;
    }
    return { kind: "completed" };
  }

  /**
   * Create or resume the engine, per `stateIdSource`. An engine-minted id is
   * bound BEFORE the turn proceeds so a crash mid-turn still resumes; a
   * resume of an id this engine never minted fails the way `Agent.resume` of
   * an unknown id fails, so a runtime that threads the wrong id is caught. A
   * deterministic engine's id is the runtime's; nothing to bind.
   */
  private async resolveEngineState(
    input: TurnInput,
    sink: TurnSink,
  ): Promise<{ kind: "ok" } | { kind: "ended"; outcome: TurnOutcome }> {
    if (this.capabilities.stateIdSource === "deterministic") return { kind: "ok" };

    if (input.threadId === "") {
      const minted = `${this.name}#state-${++this.mintCounter}`;
      this.mintedStateIds.add(minted);
      try {
        await sink.bindHarnessState(minted);
      } catch (err) {
        return {
          kind: "ended",
          outcome: { kind: "failed", surface: "internal", message: `${this.name}: could not bind engine state`, cause: err },
        };
      }
      return { kind: "ok" };
    }

    if (!this.mintedStateIds.has(input.threadId)) {
      return {
        kind: "ended",
        outcome: { kind: "failed", surface: "internal", message: `${this.name}: no engine state '${input.threadId}' to resume` },
      };
    }
    return { kind: "ok" };
  }

  /** Play one step; returns the outcome that ends the turn, or undefined to continue. */
  private async play(step: ScenarioStep, input: TurnInput, sink: TurnSink): Promise<TurnOutcome | undefined> {
    switch (step.kind) {
      case "say": {
        sink.status.messages.push(aiMessage(step.text));
        sink.recordActivity();
        // Awaited, as the Cursor loop awaits its own: a platform STOP the
        // runtime reads from this write aborts the signal before the next
        // step boundary sees it (the contract's "MAY await for ordering").
        await sink.requestPersist();
        return undefined;
      }
      case "propose":
        return this.propose(step.toolCallId, step.action, input, sink);
      case "read": {
        // Ungated: the row lands COMPLETED at once, the effect counts as run,
        // and the persist is awaited like `say`'s — a real engine's tool call
        // is the discrete event its loop flushes on.
        const message = aiMessage("");
        const row = toolCall(step.toolCallId, "read", ToolCallStatus.TOOL_CALL_COMPLETED);
        row.result = `contents of ${step.path}`;
        message.toolCalls.push(row);
        sink.status.messages.push(message);
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
      case "cancelled":
        return { kind: "cancelled" };
      default: {
        const exhaustive: never = step;
        throw new Error(`${this.name}: unknown scenario step ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  /**
   * The gate, above the contract line. The status is the single source of
   * truth for whether the effect ran: a row already carried to COMPLETED or
   * SKIPPED by an earlier invocation is settled and the step is a no-op, which
   * is what makes "reinvoked twice with the same decision, still once" hold
   * without a second ledger.
   */
  private propose(
    toolCallId: string,
    action: ProposedAction,
    input: TurnInput,
    sink: TurnSink,
  ): TurnOutcome | undefined {
    const existing = findToolCallRow(sink.status, toolCallId);
    if (isSettled(existing)) return undefined;

    const decision = input.approvalDecisions.get(toolCallId) ?? ApprovalAction.UNSPECIFIED;
    switch (decision) {
      case ApprovalAction.UNSPECIFIED: {
        // Propose: surface the gated call as a WAITING row and stop the turn.
        // Never write a second row for the same id on a resumed turn.
        if (!existing) {
          const message = aiMessage("");
          message.toolCalls.push(waitingToolCall(toolCallId, action.kind, `Approve ${action.kind} ${action.resource}?`));
          sink.status.messages.push(message);
        }
        sink.recordActivity();
        sink.requestPersist();
        return { kind: "awaiting_approval" };
      }
      case ApprovalAction.APPROVE:
      case ApprovalAction.APPROVE_ALL: {
        this.executions.set(toolCallId, this.executionCount(toolCallId) + 1);
        this.completeRow(existing, toolCallId, action, sink);
        return undefined;
      }
      case ApprovalAction.SKIP:
      case ApprovalAction.REJECT: {
        // Not executed, and the row is left as the runtime handed it (see
        // the header): the engine simply moves on.
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
   * Report the executed action on its row, as a real engine's completion
   * event does. The row normally exists (the runtime seeded the status with
   * last turn's WAITING row); a decision with no row is a runtime that decided
   * out of band, and the adapter still records what happened rather than
   * losing the fact.
   */
  private completeRow(existing: ToolCall | undefined, toolCallId: string, action: ProposedAction, sink: TurnSink): void {
    if (existing) {
      existing.status = ToolCallStatus.TOOL_CALL_COMPLETED;
    } else {
      const message = aiMessage("");
      const row = waitingToolCall(toolCallId, action.kind, "");
      row.status = ToolCallStatus.TOOL_CALL_COMPLETED;
      message.toolCalls.push(row);
      sink.status.messages.push(message);
    }
    sink.recordActivity();
    sink.requestPersist();
  }
}

/** The scripted adapter as a kit subject: the adapter IS its own engine, so the seam is a thin view over it. */
export interface ScriptedSubject extends HarnessContractSubject {
  readonly adapter: ScriptedHarnessAdapter;
}

/**
 * The fake fills the `deep-agent` row in S2 — the one row the runtime does
 * not yet serve for real (the native adapter lands in S3, and takes the row
 * over from the fake in the runtime half then).
 */
export function scriptedSubject(options: ScriptedHarnessOptions): ScriptedSubject {
  const adapter = new ScriptedHarnessAdapter(options);
  return {
    name: adapter.name,
    harness: "deep-agent",
    adapter,
    config: testConfig(options.config),
    arrange: (turn, view) => adapter.arrange(turn, view),
    whenHanging: () => adapter.whenHanging(),
    executionCount: (toolCallId) => adapter.executionCount(toolCallId),
  };
}
