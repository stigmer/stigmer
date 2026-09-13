/**
 * The native deep-agent harness as a `HarnessContractSubject` — the REAL
 * `createDeepAgentAdapter()` driven through the harness contract kit, with
 * the kit's engine-neutral scenario vocabulary translated onto the
 * `ScriptedModel` double that every native hermetic golden already runs on.
 *
 * The sibling of `execute-cursor/__test-utils__/contract-subject.ts` (the
 * mold) and of `gateway-substrate.ts` (the native side of the approval
 * contract kit): the kit owns the invariants and the runtime stand-in, this
 * module owns the ENGINE — what the model will do on its next call — and
 * reports what really happened. The adapter under test is the production
 * one, untouched; the model client is the one module doubled
 * (`scripted-model-module.ts`, S3 M0 ruling Q-M0-1), and the tools the model
 * calls are deepagents' real built-ins over the real gate.
 *
 * ── The engine is per execution, and its memory is the conversation ────────
 * One `ScriptedModel` per execution, minted at the first `arrange` and handed
 * out by the double for every build production requests under that
 * execution's `headerScope.executionId` — the attribution header the proxy
 * already carries, so concurrent executions each reach their own engine
 * through an id nothing was added to send. The kit arranges a turn as a
 * PLAN, and on every model call the engine plays the first step the
 * conversation does not yet show: a `propose` or `read` whose tool-call id
 * already has a `ToolMessage` anywhere on the thread (executed, or the
 * gate's denial) is done; a `say` already spoken in THIS turn's segment
 * (after the last human message) is done; `usage` folds into the turn's
 * first model call only. Nothing is remembered on the subject: the sqlite
 * checkpoint IS the engine's memory, which is why the same plan is right on
 * a `Command(resume)` (the tool result is in the transcript before the model
 * is asked) and on a later turn of the same thread (an approved-and-run call
 * is not proposed again — Cursor's "obedient model" of Q-M4-4, derived
 * instead of stored).
 *
 * ── The translation, one rule per word ──────────────────────────────────────
 *  - `say(text)`      → the turn's text. A second `say` before any tool step
 *                       inserts an ungated `think` call as the step boundary:
 *                       a LangGraph agent cannot speak twice without acting
 *                       (only the cost-cap arm's `[say, usage, say]` needs it).
 *  - `propose(id, a)` → ONE gated built-in whose execution is counted by a
 *                       REAL side effect the subject reads back:
 *                       `write r` → `edit_file` appending `id` as a line to a
 *                       ledger the subject seeded at the path the backend
 *                       resolves `r` to (`resolveWorkspacePath`, the virtual
 *                       root). FILE_EDIT and FILE_WRITE are one `write`
 *                       category by design (`tool-kind.ts`); unlike
 *                       `write_file`, which refuses an existing path and so
 *                       leaves no trace of a second execution, an edit
 *                       counts EVERY execution.
 *                       `shell r` → `execute` appending `id` to the session's
 *                       shell ledger, `r` riding as a trailing comment.
 *                       `delete` and `mcp` are refused as test bugs: no kit
 *                       invariant asks for them here.
 *                       `executionCount(id)` is the number of ledger lines
 *                       equal to `id` — the safety-critical observable, read
 *                       off disk, independent of anything the adapter wrote.
 *  - `read(id, path)` → `read_file` of a file the subject seeds; the ungated
 *                       tool call every harness flushes a persist on.
 *  - `usage(delta)`   → the model turn's `usage_metadata` (the cache buckets
 *                       under `input_token_details`); consecutive deltas sum,
 *                       the kit judges sums.
 *  - `hang`           → the turn parks on the run's abort signal after its
 *                       chunks (`ScriptedTurn.ends`); the park resolves
 *                       `whenHanging()`. Never a timer.
 *  - `fail(msg, s)`   → the turn throws `msg` after its chunks. `engine` and
 *                       `internal` are one act here: the native adapter has
 *                       ONE failure surface (`turn.ts` classifies every
 *                       escaped error `internal`); `actionable` is refused.
 *  - `limit`          → a `think` call under a fresh id on every model call,
 *                       until the graph's recursion limit stops the run.
 *  - `cancelled`      → refused: this harness has no engine-side cancel (the
 *                       runtime arm is declared off for it).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isAIMessage, isHumanMessage, isToolMessage, type BaseMessage } from "@langchain/core/messages";

import type { Config } from "../../../config.js";
import type { HarnessAdapter } from "../../../harness/types.js";
import type { ProposedAction } from "../../../__test-utils__/approval-contract/types.js";
import type {
  EngineView,
  HarnessContractSubject,
  ScenarioStep,
  SubjectInputOverrides,
  TurnScenario,
} from "../../../__test-utils__/harness-contract/types.js";
import type { HermeticEnvironment } from "../../../__test-utils__/hermetic-activity.js";
import { resolveWorkspacePath } from "../../../shared/file-change.js";
import { createDeepAgentAdapter } from "../adapter.js";
import { hermeticDeepAgentConfig } from "./hermetic-deep-agent.js";
import { ScriptedModel, type ScriptedToolCall, type ScriptedTurn, type ScriptedUsage } from "./scripted-model.js";
import { bindScriptedModel } from "./scripted-model-module.js";

/** The user's message every kit turn asks; the prompt builder needs one and the kit has none to give. */
const KIT_USER_MESSAGE = "Do what the scenario says.";

/** The one line a write ledger starts with; every execution appends its id under it, so the edit's anchor stays unique. */
const WRITE_LEDGER_MARK = "KIT-LEDGER";

/** What a seeded `read` target contains; the content is never asserted, the completed row is. */
const READ_FILE_CONTENT = "seeded by the harness contract kit\n";

export interface DeepAgentContractSubject extends HarnessContractSubject {
  readonly adapter: HarnessAdapter;
  /** The engine minted for an execution, once the kit has arranged a turn for it. */
  engineFor(executionId: string): ScriptedModel | undefined;
  /** The conversation the engine was last asked with, for the subject file's observations of what the graph shows the model. */
  lastTranscriptOf(executionId: string): readonly BaseMessage[] | undefined;
  /** The session's workspace directory, as the runtime's provisioner resolves it and as this subject seeds it. */
  workspaceDirOf(sessionId: string): string;
}

/**
 * Build the subject over one hermetic environment (the temp `HOME` the sqlite
 * checkpoints land under, the temp workspace root). The environment is the
 * caller's to create before and dispose after; the model-client double is
 * bound for the module here, so a file holds one subject.
 */
export function createDeepAgentContractSubject(env: HermeticEnvironment): DeepAgentContractSubject {
  return new DeepAgentSubject(env);
}

/** Where one proposal's executions are counted; recorded at `arrange`, read by `executionCount`. */
type LedgerRef = { readonly kind: "write"; readonly file: string } | { readonly kind: "shell"; readonly file: string };

/** The turn the kit arranged for an execution, and the view it was arranged from. */
interface ArrangedTurn {
  readonly steps: TurnScenario;
  readonly view: EngineView;
}

class DeepAgentSubject implements DeepAgentContractSubject {
  readonly name = "deep-agent";
  readonly harness = "deep-agent" as const;
  readonly adapter: HarnessAdapter;
  readonly config: Config;

  private readonly engines = new Map<string, ScriptedModel>();
  private readonly arranged = new Map<string, ArrangedTurn>();
  private readonly lastTranscripts = new Map<string, readonly BaseMessage[]>();
  private readonly ledgers = new Map<string, LedgerRef>();
  private readonly hangWaiters: Array<() => void> = [];
  private mintCounter = 0;

  constructor(private readonly env: HermeticEnvironment) {
    this.config = hermeticDeepAgentConfig(env, "sqlite");
    this.adapter = createDeepAgentAdapter();
    bindScriptedModel((opts) => {
      const executionId = opts.headerScope?.executionId;
      const engine = executionId ? this.engines.get(executionId) : undefined;
      if (!engine) {
        throw new Error(`${this.name}: buildChatModel asked for execution '${executionId ?? "<none>"}' but no turn was arranged for it (kit bug)`);
      }
      return engine;
    });
  }

  // ── HarnessContractSubject ────────────────────────────────────────────────

  arrange(turn: TurnScenario, view: EngineView): void {
    // A word this subject cannot translate is refused HERE, as a test bug:
    // refused at play time it would surface as an engine failure and read as
    // the adapter's behaviour.
    for (const step of turn) this.refuseUnproducible(step);
    mkdirSync(this.workspaceDirOf(view.sessionId), { recursive: true });
    for (const step of turn) this.seedFor(step, view);
    this.arranged.set(view.executionId, { steps: turn, view });
    if (!this.engines.has(view.executionId)) this.engines.set(view.executionId, this.mintEngine(view.executionId));
  }

  inputOverrides(view: EngineView): SubjectInputOverrides {
    // No model is named: the adapter resolves the registry's featured native
    // model, which is the fixture's — the production "no model named" path.
    return { workspaceDir: this.workspaceDirOf(view.sessionId), message: KIT_USER_MESSAGE };
  }

  whenHanging(): Promise<void> {
    return new Promise((resolve) => this.hangWaiters.push(resolve));
  }

  executionCount(toolCallId: string): number {
    const ledger = this.ledgers.get(toolCallId);
    if (!ledger || !existsSync(ledger.file)) return 0;
    return readFileSync(ledger.file, "utf8")
      .split("\n")
      .filter((line) => line === toolCallId).length;
  }

  // ── The subject file's observations ──────────────────────────────────────

  engineFor(executionId: string): ScriptedModel | undefined {
    return this.engines.get(executionId);
  }

  lastTranscriptOf(executionId: string): readonly BaseMessage[] | undefined {
    return this.lastTranscripts.get(executionId);
  }

  /** The directory the runtime's provisioner gives a session with no workspace entries (`session-root.ts`). */
  workspaceDirOf(sessionId: string): string {
    return join(this.env.workspaceRootDir, "sessions", sessionId);
  }

  // ── The engine ────────────────────────────────────────────────────────────

  private mintEngine(executionId: string): ScriptedModel {
    return new ScriptedModel(() => (transcript) => this.play(executionId, transcript), [], {
      onPark: () => {
        for (const waiter of this.hangWaiters.splice(0)) waiter();
      },
    });
  }

  /** The words this subject has no honest translation for (see the header); each is a kit-file bug, named. */
  private refuseUnproducible(step: ScenarioStep): void {
    switch (step.kind) {
      case "propose":
        if (step.action.kind !== "write" && step.action.kind !== "shell") {
          throw new Error(`${this.name}: propose(${step.action.kind}) is not translated by this subject (no kit invariant asks for it); test bug`);
        }
        return;
      case "fail":
        if (step.surface === "actionable") {
          throw new Error(`${this.name}: fail(..., "actionable") is not producible by this subject (the native adapter has one failure surface, internal); test bug`);
        }
        return;
      case "cancelled":
        throw new Error(`${this.name}: cancelled() is not producible by this subject (this harness has no engine-side cancel; the runtime arm is declared off for it); test bug`);
      case "say":
      case "read":
      case "usage":
      case "hang":
      case "limit":
        return;
      default: {
        const exhaustive: never = step;
        throw new Error(`${this.name}: unknown scenario step ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  /** The shell ledger of one session; outside the session's workspace so the engine's tree holds only what the engine wrote. */
  private shellLedgerOf(sessionId: string): string {
    return join(this.env.workspaceRootDir, "kit-ledgers", `${sessionId}.log`);
  }

  /** Put on disk what a step's tool will find there: the write ledger under its mark, the read target. */
  private seedFor(step: ScenarioStep, view: EngineView): void {
    const workspaceDir = this.workspaceDirOf(view.sessionId);
    if (step.kind === "propose" && step.action.kind === "write") {
      const file = resolveWorkspacePath(step.action.resource, workspaceDir, true).absolutePath;
      seedFile(file, `${WRITE_LEDGER_MARK}\n`);
      this.ledgers.set(step.toolCallId, { kind: "write", file });
    } else if (step.kind === "propose" && step.action.kind === "shell") {
      const file = this.shellLedgerOf(view.sessionId);
      mkdirSync(dirname(file), { recursive: true });
      this.ledgers.set(step.toolCallId, { kind: "shell", file });
    } else if (step.kind === "read") {
      seedFile(resolveWorkspacePath(step.path, workspaceDir, true).absolutePath, READ_FILE_CONTENT);
    }
  }

  /**
   * The one turn to play now: the plan's steps in order, each skipped when
   * the conversation already shows it, until a step closes the turn (a tool
   * call, a hang, a failure) or the plan runs out (an empty message, which
   * ends the graph run).
   */
  private play(executionId: string, transcript: readonly BaseMessage[]): ScriptedTurn {
    const plan = this.arranged.get(executionId);
    if (!plan) throw new Error(`${this.name}: the model was asked for execution '${executionId}' with no turn arranged (kit bug)`);
    this.lastTranscripts.set(executionId, transcript);
    const settled = settledToolCallIds(transcript);
    const segment = messagesOfThisTurn(transcript);
    const spoken = new Set(segment.filter((m) => isAIMessage(m)).map((m) => m.text));
    const firstCallOfTurn = !segment.some((m) => isAIMessage(m));

    let text: string | undefined;
    let usage: ScriptedUsage | undefined;
    const close = (rest: Partial<ScriptedTurn>): ScriptedTurn => ({ text, usage, ...rest });

    for (const step of plan.steps) {
      switch (step.kind) {
        case "say":
          if (spoken.has(step.text)) break;
          if (text !== undefined) return close({ toolCalls: [this.thinkCall("boundary")] });
          text = step.text;
          break;
        case "propose":
          if (settled.has(step.toolCallId)) break;
          return close({ toolCalls: [this.gatedCall(step.toolCallId, step.action, plan.view)] });
        case "read":
          if (settled.has(step.toolCallId)) break;
          return close({ toolCalls: [{ id: step.toolCallId, name: "read_file", args: { file_path: step.path } }] });
        case "usage":
          if (!firstCallOfTurn) break;
          usage = addUsage(usage, step.delta);
          break;
        case "hang":
          return close({ ends: { kind: "hang" } });
        case "fail":
          return close({ ends: { kind: "fail", error: new Error(step.message) } });
        case "limit":
          return close({ toolCalls: [this.thinkCall("limit")] });
        case "cancelled":
          // Refused at `arrange`; unreachable in a plan that got this far.
          throw new Error(`${this.name}: cancelled() reached the engine (arrange should have refused it)`);
        default: {
          const exhaustive: never = step;
          throw new Error(`${this.name}: unknown scenario step ${JSON.stringify(exhaustive)}`);
        }
      }
    }
    return close({});
  }

  /** An ungated, effect-free tool call: the step boundary a LangGraph agent needs between two texts, and the loop a `limit` spins. */
  private thinkCall(why: "boundary" | "limit"): ScriptedToolCall {
    return { id: `kit-think-${why}-${++this.mintCounter}`, name: "think", args: { thought: `kit: ${why}` } };
  }

  private gatedCall(toolCallId: string, action: ProposedAction, view: EngineView): ScriptedToolCall {
    switch (action.kind) {
      case "write":
        return {
          id: toolCallId,
          name: "edit_file",
          args: {
            file_path: action.resource,
            old_string: WRITE_LEDGER_MARK,
            new_string: `${WRITE_LEDGER_MARK}\n${toolCallId}`,
          },
        };
      case "shell":
        return {
          id: toolCallId,
          name: "execute",
          args: { command: `printf '%s\\n' '${toolCallId}' >> '${this.shellLedgerOf(view.sessionId)}' # ${action.resource}` },
        };
      case "delete":
      case "read":
      case "mcp":
        // Refused at `arrange`; unreachable in a plan that got this far.
        throw new Error(`${this.name}: propose(${action.kind}) reached the engine (arrange should have refused it)`);
      default: {
        const exhaustive: never = action.kind;
        throw new Error(`${this.name}: unknown action kind ${String(exhaustive)}`);
      }
    }
  }
}

// ── Reading the conversation ────────────────────────────────────────────────

/** Every tool call the thread has an answer for — executed, or answered by the gate's denial. */
function settledToolCallIds(transcript: readonly BaseMessage[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const m of transcript) if (isToolMessage(m)) ids.add(m.tool_call_id);
  return ids;
}

/** The messages after the last human message: what this kit turn has said and done so far. */
function messagesOfThisTurn(transcript: readonly BaseMessage[]): readonly BaseMessage[] {
  let start = 0;
  transcript.forEach((m, i) => {
    if (isHumanMessage(m)) start = i + 1;
  });
  return transcript.slice(start);
}

function addUsage(total: ScriptedUsage | undefined, delta: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }): ScriptedUsage {
  const carriesCache = total?.cacheReadTokens !== undefined || delta.cacheReadTokens !== undefined || delta.cacheWriteTokens !== undefined;
  return {
    inputTokens: (total?.inputTokens ?? 0) + (delta.inputTokens ?? 0),
    outputTokens: (total?.outputTokens ?? 0) + (delta.outputTokens ?? 0),
    ...(carriesCache
      ? {
          cacheReadTokens: (total?.cacheReadTokens ?? 0) + (delta.cacheReadTokens ?? 0),
          cacheWriteTokens: (total?.cacheWriteTokens ?? 0) + (delta.cacheWriteTokens ?? 0),
        }
      : {}),
  };
}

/** Create `file` with `content` unless it exists — a ledger keeps what earlier turns appended. */
function seedFile(file: string, content: string): void {
  if (existsSync(file)) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}
