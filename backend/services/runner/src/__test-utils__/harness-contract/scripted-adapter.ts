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
 * A `runTurn` with no scenario arranged is a test bug and throws (the same
 * rule as the scripted `@cursor/sdk` agent's `send()` with no script left);
 * every other exit is a `TurnOutcome`.
 */

import { ApprovalAction, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";

import type { Config } from "../../config.js";
import type { HarnessCapabilities, PausePrimitive, StateIdSource } from "../../harness/capabilities.js";
import type { HarnessAdapter, TurnInput, TurnOutcome, TurnSink } from "../../harness/types.js";
import { DEEP_AGENT_VISION_PROFILE } from "../../shared/attachment-vision.js";
import type { ProposedAction } from "../approval-contract/types.js";
import { testConfig } from "../config-fixture.js";
import { aiMessage, findToolCallRow, waitingToolCall } from "../proto-helpers.js";
import type { HarnessContractSubject, ScenarioStep, TurnScenario } from "./types.js";

export interface ScriptedHarnessOptions {
  /** Diagnostic name; defaults to a name that says which primitives this instance runs under. */
  readonly name?: string;
  readonly pausePrimitive: PausePrimitive;
  readonly stateIdSource: StateIdSource;
}

/** The lifecycle calls the adapter received, for the kit's lifetime invariants. */
export interface RecordedLifecycle {
  readonly boots: readonly Config[];
  readonly shutdowns: number;
  readonly releasedSessions: readonly string[];
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

  private readonly queue: TurnScenario[] = [];
  private readonly mintedStateIds = new Set<string>();
  private readonly executions = new Map<string, number>();
  private mintCounter = 0;

  private readonly boots: Config[] = [];
  private shutdowns = 0;
  private readonly releasedSessions: string[] = [];

  constructor(options: ScriptedHarnessOptions) {
    this.name = options.name ?? `scripted(${options.pausePrimitive}, ${options.stateIdSource})`;
    this.capabilities = {
      pausePrimitive: options.pausePrimitive,
      stateIdSource: options.stateIdSource,
      systemPrompt: true,
      subAgents: false,
      toolRestriction: true,
      visionProfile: DEEP_AGENT_VISION_PROFILE,
    };
  }

  // ── Engine controls (the subject's side of the kit seam) ──────────────────

  /** Queue what the next `runTurn` plays. */
  arrange(turn: TurnScenario): void {
    this.queue.push(turn);
  }

  executionCount(toolCallId: string): number {
    return this.executions.get(toolCallId) ?? 0;
  }

  get lifecycle(): RecordedLifecycle {
    return { boots: this.boots, shutdowns: this.shutdowns, releasedSessions: this.releasedSessions };
  }

  // ── HarnessAdapter ────────────────────────────────────────────────────────

  async boot(config: Config): Promise<void> {
    this.boots.push(config);
  }

  async shutdown(): Promise<void> {
    this.shutdowns += 1;
  }

  /** Nothing is parked per session here; a real adapter releases its parked engine. */
  async releaseSession(sessionId: string): Promise<void> {
    this.releasedSessions.push(sessionId);
  }

  async runTurn(input: TurnInput, sink: TurnSink): Promise<TurnOutcome> {
    const turn = this.queue.shift();
    if (!turn) throw new Error(`${this.name}: runTurn called with no scenario arranged (test bug)`);

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
          outcome: { kind: "failed", message: `${this.name}: could not bind engine state`, cause: err },
        };
      }
      return { kind: "ok" };
    }

    if (!this.mintedStateIds.has(input.threadId)) {
      return {
        kind: "ended",
        outcome: { kind: "failed", message: `${this.name}: no engine state '${input.threadId}' to resume` },
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
        sink.requestPersist();
        return undefined;
      }
      case "propose":
        return this.propose(step.toolCallId, step.action, input, sink);
      case "usage": {
        sink.reportUsage(step.delta);
        sink.recordActivity();
        return undefined;
      }
      case "hang": {
        await whenAborted(sink.stopSignal);
        return { kind: "interrupted" };
      }
      case "fail":
        return { kind: "failed", message: step.message };
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
        this.settleRow(existing, toolCallId, action, ToolCallStatus.TOOL_CALL_COMPLETED, sink);
        return undefined;
      }
      case ApprovalAction.SKIP:
      case ApprovalAction.REJECT: {
        this.settleRow(existing, toolCallId, action, ToolCallStatus.TOOL_CALL_SKIPPED, sink);
        return undefined;
      }
      default: {
        const exhaustive: never = decision;
        throw new Error(`${this.name}: unknown approval action ${String(exhaustive)}`);
      }
    }
  }

  /**
   * Carry the proposal's row to its terminal status. The row normally exists
   * (the runtime seeded the status with last turn's WAITING row); a decision
   * with no row is a runtime that decided out of band, and the adapter still
   * records what happened rather than losing the fact.
   */
  private settleRow(
    existing: ToolCall | undefined,
    toolCallId: string,
    action: ProposedAction,
    status: ToolCallStatus,
    sink: TurnSink,
  ): void {
    if (existing) {
      existing.status = status;
    } else {
      const message = aiMessage("");
      const row = waitingToolCall(toolCallId, action.kind, "");
      row.status = status;
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

export function scriptedSubject(options: ScriptedHarnessOptions): ScriptedSubject {
  const adapter = new ScriptedHarnessAdapter(options);
  return {
    name: adapter.name,
    adapter,
    config: testConfig(),
    arrange: (turn) => adapter.arrange(turn),
    executionCount: (toolCallId) => adapter.executionCount(toolCallId),
  };
}
