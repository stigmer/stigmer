/**
 * The operations a turn has open right now — the tool calls that started and
 * have not finished — folded from the transcript events every harness
 * already emits, so the turn runtime can tell a turn that is working from a
 * turn that is stuck.
 *
 * Why this exists: the stall watchdog (`shared/stall-watchdog.ts`) fails a
 * turn that reports no activity for its window, and a tool that prints
 * nothing reports none. A ten-minute build, a long test run or a helper that
 * thinks for a while was killed at the window as if it had wedged
 * (stigmer#2414, stigmer#2416). With this fold the watchdog asks "is anything
 * running?" first: while an operation is open the idle time does not grow,
 * and the window counts from the moment the last one closes. A turn with
 * nothing open and nothing arriving is still stopped at the window.
 *
 * Why a fold over the observed events and not a query over the rows: a
 * hosted turn's engine runs in the agent host, whose builder folds the
 * events; this process receives every folded event at once, as a notice the
 * runtime's builder relays to its observer (`agent-host/remote-adapter.ts`,
 * `TranscriptBuilder.relayObserved`), and the rows only with the next
 * persist. Liveness read from the rows would lag a persist in that mode. The
 * turn timeline (`turn-timeline.ts`) is the same kind of fold, written once
 * for every harness and fed in either mode.
 *
 * The fold's rules, each pinned by `__tests__/open-operations.test.ts`:
 *   - A call opens on `tool_started`, unless it already closed in this turn:
 *     a recovery may re-emit the start of a call the builder has settled,
 *     and the builder keeps the outcome (`transcript/builder.ts`), so the
 *     call stays closed here too.
 *   - A call closes on `tool_finished`, `tool_error` or `approval_proposed`:
 *     a call held for a person's decision is not running.
 *   - A call is DELEGATING when a `sub_agent_started` names its id (the
 *     sub-agent's id is the delegating call's on every harness,
 *     `transcript/events.ts`), in either order: native announces the
 *     sub-agent before the `task` call starts. A delegating call counts as
 *     open only on a harness that reports its sub-agents' work at completion
 *     (`HarnessCapabilities.subAgentProgress`); where the work streams, the
 *     sub-agent's own calls are what count, so a sub-agent whose model hangs
 *     with nothing open is caught at the window like the root's.
 *
 * Whether the turn is waiting on its model ({@link OpenOperations.awaitingModel})
 * is the stall's second question: a stall owed by the model provider is
 * recoverable, and any other is the engine's (`run-turn.ts`). It is true
 * while a model round is open (a `message_start` with no `message_finish`),
 * or while the newest fact folded is a tool's result that nothing has
 * answered yet (no call started, no round opened since) and nothing is open:
 * the engine handed the model a result and the model has not replied. A
 * turn that has folded nothing yet is not waiting on its model by this
 * reading: the stall may be in the engine's own setup.
 *
 * The oldest open call, with its age, is what the runtime's backstop reads:
 * an operation open longer than `Config.openOperationMaxMs` is stopped
 * ({@link OperationLimitError}), because some operations have no bound of
 * our own (a Cursor `task`, Cursor's MCP calls) and a live heartbeat over an
 * unbounded call would keep a dead turn alive forever. Ages are on the wall
 * clock read when the event is observed; a relayed event's few milliseconds
 * in the pipe are nothing against a bound measured in minutes.
 *
 * Nothing here persists. What a client sees of it is the turn's liveness
 * ({@link OpenOperations.snapshot}): the runtime's liveness pump
 * (`liveness-pump.ts`) sends it as a `stigmer.run.liveness` preview, each
 * operation with how long it has been open and how long the turn has
 * waited on its model, measured here when it is sent.
 */

import type { SubAgentProgress } from "./capabilities.js";
import type { TranscriptEvent } from "./transcript/events.js";

/**
 * Default backstop for one open operation (ms), `Config.openOperationMaxMs`:
 * a tool call or delegated task open this long is stopped and the turn
 * fails with the operation-limit copy. It exists for what has no bound of
 * our own (a Cursor `task`, Cursor's MCP calls, an opaque tool of a later
 * harness); every operation the runner runs itself is bounded well below it
 * (the MCP SDK's 60 s request, `web_fetch`'s 15 s per hop).
 */
export const DEFAULT_OPEN_OPERATION_MAX_MS = 3_600_000;

/** An operation the fold holds open, as the backstop and the logs name it. */
export interface OpenOperation {
  readonly callId: string;
  /** The tool's name as the engine called it (`execute`, `shell`, `task`, an MCP tool). */
  readonly name: string;
  /** The sub-agent whose call it is; absent for the root. */
  readonly subAgentId?: string;
  /** Wall-clock instant (`Date.now()` scale) the fold saw it open. */
  readonly openedAtMs: number;
}

/** What a turn has open at one instant: what its liveness names (`liveness-pump.ts`). */
export interface OperationsSnapshot {
  /** The counted operations open, oldest first, each with its age. */
  readonly operations: ReadonlyArray<OpenOperation & { readonly ageMs: number }>;
  /** How long the turn has waited on its model's reply; undefined while it is not waiting. */
  readonly awaitingModelMs: number | undefined;
}

export interface OpenOperationsOptions {
  readonly subAgentProgress: SubAgentProgress;
  /** Told when the last counted operation closes: the moment the stall window counts from. */
  readonly onIdle?: () => void;
  /** `Date.now` in production; tests inject a scripted one. */
  readonly now?: () => number;
}

export class OpenOperations {
  private readonly open = new Map<string, OpenOperation>();
  private readonly closed = new Set<string>();
  private readonly delegating = new Set<string>();
  /** The model rounds open now, by the run id their `message_start` named, with when each opened. */
  private readonly openRounds = new Map<string, number>();
  /** The newest fact folded is a tool's result nothing has answered yet. */
  private resultUnanswered = false;
  /** When the newest unanswered result arrived. */
  private resultAtMs = 0;
  private readonly now: () => number;

  constructor(private readonly options: OpenOperationsOptions) {
    this.now = options.now ?? Date.now;
  }

  /** The builder's observer: fold one event (the module header's rules). */
  observe(event: TranscriptEvent): void {
    switch (event.kind) {
      case "tool_started": {
        this.resultUnanswered = false;
        if (this.closed.has(event.callId) || this.open.has(event.callId)) return;
        this.open.set(event.callId, {
          callId: event.callId,
          name: event.name,
          ...(event.subAgentId !== undefined ? { subAgentId: event.subAgentId } : {}),
          openedAtMs: this.now(),
        });
        return;
      }
      case "tool_finished":
      case "tool_error":
        this.close(event.callId);
        this.resultUnanswered = true;
        this.resultAtMs = this.now();
        return;
      case "approval_proposed":
        this.close(event.callId);
        this.resultUnanswered = false;
        return;
      case "message_start":
        if (!this.openRounds.has(event.runId)) this.openRounds.set(event.runId, this.now());
        this.resultUnanswered = false;
        return;
      case "message_finish":
        this.openRounds.delete(event.runId);
        return;
      case "sub_agent_started": {
        const wasHeld = this.held();
        this.delegating.add(event.subAgentId);
        if (wasHeld && !this.held()) this.options.onIdle?.();
        return;
      }
      default:
        return;
    }
  }

  /** Whether anything counted is running: the watchdog's `held()`. */
  held(): boolean {
    for (const operation of this.open.values()) {
      if (this.counts(operation)) return true;
    }
    return false;
  }

  /** Whether the turn is waiting on its model's reply now (the module header). */
  awaitingModel(): boolean {
    return this.openRounds.size > 0 || (this.resultUnanswered && !this.held());
  }

  /** What the turn has open now, with every age measured at this call (the module header). */
  snapshot(): OperationsSnapshot {
    const now = this.now();
    const operations = [...this.open.values()]
      .filter((operation) => this.counts(operation))
      .sort((a, b) => a.openedAtMs - b.openedAtMs)
      .map((operation) => ({ ...operation, ageMs: now - operation.openedAtMs }));
    return { operations, awaitingModelMs: this.awaitingSinceMs(operations.length > 0, now) };
  }

  /** How long the turn has waited on its model, by {@link awaitingModel}'s reading; undefined when it is not. */
  private awaitingSinceMs(held: boolean, now: number): number | undefined {
    if (this.openRounds.size > 0) return now - Math.min(...this.openRounds.values());
    return this.resultUnanswered && !held ? now - this.resultAtMs : undefined;
  }

  /** The counted operation open longest, or `undefined` when none is. */
  oldest(): (OpenOperation & { readonly ageMs: number }) | undefined {
    let oldest: OpenOperation | undefined;
    for (const operation of this.open.values()) {
      if (!this.counts(operation)) continue;
      if (oldest === undefined || operation.openedAtMs < oldest.openedAtMs) oldest = operation;
    }
    return oldest === undefined ? undefined : { ...oldest, ageMs: this.now() - oldest.openedAtMs };
  }

  private counts(operation: OpenOperation): boolean {
    return !this.delegating.has(operation.callId) || this.options.subAgentProgress === "at-completion";
  }

  private close(callId: string): void {
    this.closed.add(callId);
    const operation = this.open.get(callId);
    if (operation === undefined) return;
    this.open.delete(callId);
    if (this.counts(operation) && !this.held()) this.options.onIdle?.();
  }
}

/**
 * The runtime's backstop stopped an operation that stayed open past
 * `Config.openOperationMaxMs`. Not a stall: the turn was making progress
 * by every measure the runtime has, and was stopped at a limit.
 */
export class OperationLimitError extends Error {
  constructor(
    public readonly operation: string,
    public readonly limitMs: number,
  ) {
    super(`\`${operation}\` ran for more than ${describeLimit(limitMs)} without finishing`);
    this.name = "OperationLimitError";
  }
}

/** Recognizable prefix on the backstop's failure message, as the stall's is (`STALL_ERROR_PREFIX`). */
export const OPERATION_LIMIT_ERROR_PREFIX = "[OperationLimitError]";

/** The backstop's `status.error`: the prefix, the sentence, and the stall's actionable close. */
export function formatOperationLimitFailure(error: OperationLimitError): string {
  return `${OPERATION_LIMIT_ERROR_PREFIX} ${error.message}. Retry or resume.`;
}

/** A limit in the words the copy uses: whole minutes from one minute up, seconds below. */
function describeLimit(limitMs: number): string {
  if (limitMs >= 60_000) {
    const minutes = Math.round(limitMs / 60_000);
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const seconds = Math.max(1, Math.round(limitMs / 1000));
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}
