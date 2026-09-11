/**
 * Scripted `@cursor/sdk` agent — the double the hermetic `ExecuteCursor` runs
 * drive instead of a live Cursor agent.
 *
 * The Cursor harness delegates the agent loop to the SDK: `agent.send()`
 * returns a `Run` whose `stream()` yields `SDKMessage`s, whose `onDelta`
 * callback carries usage, and whose `wait()` resolves the `RunResult`. Between
 * those events the REAL SDK also performs side effects the harness observes
 * only indirectly — it executes the tool (writing a file into the workspace) and
 * it spawns the workspace's `.cursor/hooks.json` hook before a gated tool (the
 * runner's own bash script, which appends to the denial ledger). A double that
 * replays events alone would leave those effects out and the harness's
 * deny-and-retry and file-review paths untested.
 *
 * So a turn is a SCRIPT of ordered steps, one of four kinds:
 *
 *  - `event(SDKMessage)`     — yielded from `stream()`
 *  - `delta(update)`         — fired through `onDelta` (usage, `turn-ended`)
 *  - `effect(fn)`            — the side effect the SDK would have performed
 *                              (run the real hook, write a workspace file,
 *                              cancel the activity from the outside)
 *  - `result(RunResult)`     — what `wait()` resolves; ends the run
 *
 * The same shape as the native harness's `__test-utils__/scripted-model.ts`
 * (`ScriptStep`, driven in order), applied to the SDK's event surface.
 *
 * Typing: `SDKMessage`, `Run`, `RunResult` and `SDKAgent` are the SDK's own
 * types (`@cursor/sdk` 1.0.13, concrete in `messages.d.ts` / `run.d.ts` /
 * `agent.d.ts`), so a script that drifts from the real event shape fails
 * `tsc`. The delta channel is the exception: `InteractionUpdate` re-exports
 * from `@anysphere/cursor-sdk-shared`, a workspace package the published SDK
 * does not ship, so under `skipLibCheck` it resolves to `any` — in production
 * code too (`turn-stream.ts`, `delta-enricher.ts` read it untyped). The one
 * delta this double emits, the `turn-ended` usage, is therefore typed HERE
 * ({@link TurnEndedUsageDelta}) against what `turn-stream.ts` reads from it,
 * and that gap is recorded in the entry's findings rather than papered over.
 *
 * Cancellation: `run.cancel()` is how the harness stops a turn (first denial,
 * cost cap, stall). The double honours it the way the SDK does — the stream
 * ends at the next step, `wait()` resolves `{ status: "cancelled" }` — because
 * the deny-and-retry path depends on exactly that ordering.
 *
 * Every `send()` consumes the NEXT script in the agent's queue: turn 1, then
 * the resumed turn 2 on the same parked agent. A `send()` with no script left
 * is a test bug and throws.
 */

import type {
  ModelSelection,
  Run,
  RunOperation,
  RunResult,
  RunStatus,
  SDKAgent,
  SDKMessage,
  SDKUserMessage,
  SendOptions,
} from "@cursor/sdk";
import type { ConversationTurn } from "@cursor/sdk";

// ---------------------------------------------------------------------------
// Script steps
// ---------------------------------------------------------------------------

/**
 * The `turn-ended` delta as `turn-stream.ts` reads it (`update.type ===
 * "turn-ended" && update.usage` -> `usageAccumulator.addTurn(update.usage)`).
 * See the module header for why this is typed locally.
 */
export interface TurnEndedUsageDelta {
  readonly type: "turn-ended";
  readonly usage: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly cacheWriteTokens?: number;
    readonly cacheReadTokens?: number;
  };
}

/** What an `effect` step can reach: the run it is part of. */
export interface EffectContext {
  readonly run: ScriptedRun;
  readonly agent: ScriptedCursorAgent;
}

export type ScriptStep =
  | { readonly kind: "event"; readonly event: SDKMessage }
  | { readonly kind: "delta"; readonly update: TurnEndedUsageDelta }
  | { readonly kind: "effect"; readonly label: string; readonly run: (ctx: EffectContext) => void | Promise<void> }
  | { readonly kind: "result"; readonly result: Omit<RunResult, "id"> };

/** One `send()`'s worth of behaviour. */
export type TurnScript = readonly ScriptStep[];

/** Step builders — the vocabulary a scenario file reads as. */
export const step = {
  event(event: SDKMessage): ScriptStep {
    return { kind: "event", event };
  },
  turnEnded(usage: TurnEndedUsageDelta["usage"]): ScriptStep {
    return { kind: "delta", update: { type: "turn-ended", usage } };
  },
  effect(label: string, run: (ctx: EffectContext) => void | Promise<void>): ScriptStep {
    return { kind: "effect", label, run };
  },
  finished(result?: Partial<Omit<RunResult, "id" | "status">>): ScriptStep {
    return { kind: "result", result: { status: "finished", ...result } };
  },
  errored(result?: Partial<Omit<RunResult, "id" | "status">>): ScriptStep {
    return { kind: "result", result: { status: "error", ...result } };
  },
} as const;

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** Called once per step so the driver's clock can tick. */
export type StepObserver = (step: ScriptStep, index: number) => void;

export class ScriptedRun implements Run {
  readonly id: string;
  readonly agentId: string;
  private _status: RunStatus = "running";
  private cancelled = false;
  private scriptedResult: Omit<RunResult, "id"> | undefined;
  private streamed = false;
  private readonly statusListeners = new Set<(status: RunStatus) => void>();
  /** `run.cancel()` calls, for assertions. */
  readonly cancelCalls: number[] = [];

  constructor(
    readonly agent: ScriptedCursorAgent,
    id: string,
    private readonly script: TurnScript,
    private readonly onDelta: SendOptions["onDelta"],
    private readonly observeStep: StepObserver | undefined,
    /** What `conversation()` answers; the error classifier reads it on a failed run. */
    private readonly conversationTurns: ConversationTurn[] = [],
  ) {
    this.id = id;
    this.agentId = agent.agentId;
  }

  get status(): RunStatus {
    return this._status;
  }

  get result(): string | undefined {
    return this.scriptedResult?.result;
  }

  get model(): ModelSelection | undefined {
    return this.scriptedResult?.model ?? this.agent.model;
  }

  supports(_operation: RunOperation): boolean {
    return true;
  }

  unsupportedReason(_operation: RunOperation): string | undefined {
    return undefined;
  }

  onDidChangeStatus(listener: (status: RunStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  async conversation(): Promise<ConversationTurn[]> {
    return this.conversationTurns;
  }

  async *stream(): AsyncGenerator<SDKMessage, void> {
    if (this.streamed) {
      throw new Error(`ScriptedRun ${this.id}: stream() consumed twice`);
    }
    this.streamed = true;
    for (let i = 0; i < this.script.length; i++) {
      // A cancel lands between steps, exactly where the SDK's own stream would
      // stop delivering.
      if (this.cancelled) break;
      const s = this.script[i];
      this.observeStep?.(s, i);
      switch (s.kind) {
        case "event":
          yield s.event;
          break;
        case "delta":
          await this.onDelta?.({ update: s.update as never });
          break;
        case "effect":
          await s.run({ run: this, agent: this.agent });
          break;
        case "result":
          this.scriptedResult = s.result;
          break;
        default: {
          const exhaustive: never = s;
          throw new Error(`ScriptedRun: unknown step ${String(exhaustive)}`);
        }
      }
    }
    if (!this.cancelled) this.setStatus(this.scriptedResult?.status ?? "finished");
  }

  async wait(): Promise<RunResult> {
    if (this.cancelled) {
      return { id: this.id, status: "cancelled" };
    }
    if (!this.scriptedResult) {
      // A script that never declared its result is a test bug — surface it
      // instead of inventing a "finished" the golden would then pin.
      throw new Error(
        `ScriptedRun ${this.id}: wait() called but the script has no result step ` +
          `(add step.finished() or step.errored())`,
      );
    }
    return { id: this.id, ...this.scriptedResult };
  }

  async cancel(): Promise<void> {
    this.cancelCalls.push(Date.now());
    this.cancelled = true;
    this.setStatus("cancelled");
  }

  private setStatus(status: RunStatus): void {
    this._status = status;
    for (const l of this.statusListeners) l(status);
  }
}

// ---------------------------------------------------------------------------
// The agent
// ---------------------------------------------------------------------------

export interface ScriptedAgentOptions {
  readonly agentId: string;
  /** One script per `send()`, consumed in order. */
  readonly turns: readonly TurnScript[];
  /** Run ids, one per turn, so goldens carry stable `run_id`s. */
  readonly runIds?: readonly string[];
  readonly observeStep?: StepObserver;
  readonly conversationTurns?: ConversationTurn[];
}

/** What the harness passed to `send()`, kept for assertions on the prompt. */
export interface RecordedSend {
  readonly message: string | SDKUserMessage;
  readonly hasOnDelta: boolean;
}

export class ScriptedCursorAgent implements SDKAgent {
  readonly agentId: string;
  model: ModelSelection | undefined = undefined;
  readonly sends: RecordedSend[] = [];
  readonly runs: ScriptedRun[] = [];
  closeCalls = 0;
  private nextTurn = 0;

  constructor(private readonly options: ScriptedAgentOptions) {
    this.agentId = options.agentId;
  }

  async send(message: string | SDKUserMessage, options?: SendOptions): Promise<Run> {
    const script = this.options.turns[this.nextTurn];
    if (!script) {
      throw new Error(
        `ScriptedCursorAgent ${this.agentId}: send() #${this.nextTurn + 1} has no script ` +
          `(the scenario declared ${this.options.turns.length})`,
      );
    }
    const runId = this.options.runIds?.[this.nextTurn] ?? `run-${this.agentId}-${this.nextTurn + 1}`;
    this.nextTurn++;
    this.sends.push({ message, hasOnDelta: !!options?.onDelta });
    if (options?.model) this.model = options.model;
    const run = new ScriptedRun(
      this,
      runId,
      script,
      options?.onDelta,
      this.options.observeStep,
      this.options.conversationTurns,
    );
    this.runs.push(run);
    return run;
  }

  close(): void {
    this.closeCalls++;
  }

  async reload(): Promise<void> {
    // No persisted state to reload in the double.
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.close();
  }

  async listArtifacts(): Promise<never[]> {
    return [];
  }

  async downloadArtifact(_path: string): Promise<Buffer> {
    throw new Error("ScriptedCursorAgent: artifacts are not part of the scripted surface");
  }
}
