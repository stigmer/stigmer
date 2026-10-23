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
 * (`scripted-model-module.ts`), and the tools the model
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
 * (after the last human message) is done; `usage` folds into the first
 * model call of the arranged turn, the invocation's own (a resumed or
 * continued invocation reports what it spent, as a real engine does). Nothing is remembered on the subject: the sqlite
 * checkpoint IS the engine's memory, which is why the same plan is right on
 * a `Command(resume)` (the tool result is in the transcript before the model
 * is asked) and on a later turn of the same thread (an approved-and-run call
 * is not proposed again — Cursor's subject's "obedient model", derived
 * instead of stored).
 *
 * ── The translation, one rule per word ──────────────────────────────────────
 *  - `say(text)`      → the turn's text. A second `say` before any tool step
 *                       inserts the neutral step, an `ls` of the workspace
 *                       root, as the step boundary: a LangGraph agent cannot
 *                       speak twice without acting (only the cost-cap arm's
 *                       `[say, usage, say]` needs it). `ls` is chosen as
 *                       `read` chooses `read_file`: it needs no approval and
 *                       changes nothing. Unlike the platform tool it replaces
 *                       (#1976), an allow-list without `Glob` hides it, so
 *                       the boundary and `limit` hold only for a turn with no
 *                       tool lists, which is every turn this subject arranges
 *                       (`inputOverrides` names none). An arm that adds lists
 *                       and plays either step must keep `Glob` in them.
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
 *  - `limit`          → the neutral step under a fresh id on every model
 *                       call, the same arguments each time, until the
 *                       graph's recursion limit stops the run.
 *  - `cancelled`      → refused: this harness has no engine-side cancel (the
 *                       runtime arm is declared off for it).
 *  - `open(id)`       → a REAL `execute` of a shell that reads a control
 *                       FIFO the subject opened: the subject's open of the
 *                       FIFO's write end completes when the shell opens its
 *                       read end, which is `whenOpen` (no timer, no poll);
 *                       each emitted line is written to the FIFO and the
 *                       shell prints it; the release line ends the shell.
 *                       The product's own `execute` under the record's
 *                       whole-run trust (`autoApproveAll`), because a shell
 *                       is gated in every other posture. A streamed open is
 *                       the same shell; whether its lines reach anyone is
 *                       the adapter's business, which is the arm's point.
 *  - `open(id, subagent)` → `task` to the kit's helper (the record lists it);
 *                       the helper does the delegated work in a REAL
 *                       `execute` of the same kit shell under `id`, so the
 *                       kit's `whenOpen` and `release` drive it as they
 *                       drive the root's, then answers. A helper's work on
 *                       this harness is its own calls, streamed into the
 *                       parent (`subAgentProgress: "streamed"`): a silent
 *                       shell in the helper is the silent build of a
 *                       delegated task. Told apart from the root by its
 *                       instructions in its prompt.
 *  - `compact`        → real compaction: an engine whose plan compacts
 *                       reports a context window, sized at its first
 *                       compaction from what the runner really sends
 *                       (`countTokensApproximately` over the transcript and
 *                       the bound tools, the middleware's own counter), and
 *                       the step reads a seeded bulk file until deepagents'
 *                       summarization middleware has compacted once more.
 *                       The double answers the summary call out of band and
 *                       counts it (`scripted-model.ts`). A step before a
 *                       compaction the engine already did is done: the
 *                       conversation that held it is now the summary.
 *  - `message(text)`  → the kit's person sends `text` as the engine plays
 *                       the step before: with the tool call an `open`,
 *                       `read` or `propose` returns, so it waits while the
 *                       tool runs and the next model call takes it; after
 *                       a `say`, the call ends on that answer, so the
 *                       round's end takes it. The step is done once the
 *                       conversation holds it as a human message, which
 *                       this subject's segment reading passes over as a
 *                       person's word inside the turn, never a new turn; a
 *                       call that reaches it sent but unread fails the
 *                       script, naming it: the message was not read where
 *                       the harness says it reads one.
 */

import { execFileSync } from "node:child_process";
import { closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { HumanMessage, isAIMessage, isHumanMessage, isToolMessage, type BaseMessage } from "@langchain/core/messages";
import { countTokensApproximately } from "langchain";

import type { Config } from "../../../config.js";
import type { HarnessAdapter } from "../../../harness/types.js";
import type { ProposedAction } from "../../../__test-utils__/approval-contract/types.js";
import {
  KIT_SUBAGENT_INSTRUCTIONS,
  KIT_SUBAGENT_SLUG,
  messageAfter,
  type EngineView,
  type HarnessContractSubject,
  type LongTurnControls,
  type ScenarioStep,
  type SubjectInputOverrides,
  type TurnScenario,
} from "../../../__test-utils__/harness-contract/types.js";
import type { HermeticEnvironment } from "../../../__test-utils__/hermetic-activity.js";
import { resolveWorkspacePath } from "../../../shared/file-change.js";
import { loopbackHostedRow } from "../../../__test-utils__/loopback-host.js";
import { createDeepAgentAdapter } from "../adapter.js";
import { ENGINE_TOOL } from "../engine-tools.js";
import { hermeticDeepAgentConfig } from "./hermetic-deep-agent.js";
import { SCRIPTED_SUMMARY, SCRIPTED_SUMMARY_USAGE, ScriptedModel, type ScriptedToolCall, type ScriptedTurn, type ScriptedUsage } from "./scripted-model.js";
import { bindScriptedModel } from "./scripted-model-module.js";

/** The user's message every kit turn asks; the prompt builder needs one and the kit has none to give. */
const KIT_USER_MESSAGE = "Do what the scenario says.";

/** The one line a write ledger starts with; every execution appends its id under it, so the edit's anchor stays unique. */
const WRITE_LEDGER_MARK = "KIT-LEDGER";

/** What a seeded `read` target contains; the content is never asserted, the completed row is. */
const READ_FILE_CONTENT = "seeded by the harness contract kit\n";

/**
 * The file a `compact` step reads until the middleware compacts: 10 lines of
 * 160 characters, about 400 tokens a read. Small on purpose: the window is
 * sized from the read, and every write of the turn carries the transcript,
 * so a read five times larger cost the arm eight seconds instead of one.
 */
const BULK_FILE = "/kit-bulk.txt";
const BULK_CONTENT = `${"bulk ".repeat(32)}\n`.repeat(10);

/** How many bulk reads past the first request fill 0.85 of a sized window. */
const BULK_READS_PER_COMPACTION = 3;

/** The window an engine whose plan compacts reports until its first compaction sizes it: present (so the middleware takes fraction-based defaults), never reached. */
const UNSIZED_WINDOW = 1_000_000_000;

/** What the kit's helper answers once its work is released. */
const SUBAGENT_ANSWER = "The delegated work is done.";

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
  /** The engine's summary count when the turn was arranged; the plan's compactions are the ones after it. */
  readonly summariesAtArrange: number;
  /** A model call of this arrangement already reported the plan's usage. */
  usageFolded: boolean;
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
  private readonly operations: KitOperations;
  /** Per execution, the context window its engine reports (only an engine whose plan compacts reports one). */
  private readonly windows = new Map<string, number>();
  private readonly summaries = new Map<string, number>();
  /** Per execution, the `task` call the root is waiting on: the helper's shell runs under its id. */
  private readonly delegations = new Map<string, string>();
  private readonly executionsBySession = new Map<string, string>();
  /** Per execution, the `message` steps the kit's person has sent: a replayed plan never sends one twice. */
  private readonly sentMessages = new Map<string, Set<string>>();
  private mintCounter = 0;
  readonly longTurn: LongTurnControls;

  constructor(private readonly env: HermeticEnvironment) {
    this.config = hermeticDeepAgentConfig(env, "sqlite");
    this.operations = new KitOperations(join(env.workspaceRootDir, "kit-operations"));
    this.longTurn = {
      whenOpen: (toolCallId) => this.operations.whenOpen(toolCallId),
      emit: (toolCallId, line) => this.operations.emit(toolCallId, line),
      release: (toolCallId) => this.operations.release(toolCallId),
      opened: (toolCallId) => this.operations.opened(toolCallId),
      tasksHanded: (sessionId, message) => {
        const executionId = this.executionsBySession.get(sessionId);
        const transcript = executionId ? this.lastTranscripts.get(executionId) : undefined;
        return (transcript ?? []).filter((m) => isHumanMessage(m) && !isSummaryMessage(m) && m.text.includes(message)).length;
      },
      messagesRead: (sessionId, text) => {
        const executionId = this.executionsBySession.get(sessionId);
        const transcript = executionId ? this.lastTranscripts.get(executionId) : undefined;
        return (transcript ?? []).filter((m) => isHumanMessage(m) && m.text === text).length;
      },
      compactions: (sessionId) => this.summaries.get(this.executionsBySession.get(sessionId) ?? "") ?? 0,
      compactionSummary: { text: SCRIPTED_SUMMARY, inputTokens: SCRIPTED_SUMMARY_USAGE.inputTokens },
      // The saver holds what the graph saved; nothing else outlives the process.
      loseRunner: () => {},
    };
    // The production path: the remote adapter in front, the real one in an
    // agent host behind the pipe (`__test-utils__/loopback-host.ts`).
    this.adapter = loopbackHostedRow({ harness: "deep-agent", adapter: createDeepAgentAdapter() }).adapter;
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
    this.arranged.set(view.executionId, { steps: turn, view, summariesAtArrange: this.summaries.get(view.executionId) ?? 0, usageFolded: false });
    this.executionsBySession.set(view.sessionId, view.executionId);
    if (turn.some((step) => step.kind === "compact") && !this.windows.has(view.executionId)) this.windows.set(view.executionId, UNSIZED_WINDOW);
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
    return new ScriptedModel(
      (_tools, context) =>
        context.systemPrompt.includes(KIT_SUBAGENT_INSTRUCTIONS)
          ? (transcript) => this.playHelper(executionId, transcript)
          : (transcript) => this.play(executionId, transcript),
      [],
      {
        onPark: () => {
          for (const waiter of this.hangWaiters.splice(0)) waiter();
        },
        contextWindow: () => this.windows.get(executionId),
        onSummary: () => this.summaries.set(executionId, (this.summaries.get(executionId) ?? 0) + 1),
      },
    );
  }

  /** The kit's helper: it runs the delegating call's shell, then answers once the shell has. */
  private playHelper(executionId: string, transcript: readonly BaseMessage[]): ScriptedTurn {
    const toolCallId = this.delegations.get(executionId);
    if (!toolCallId) throw new Error(`${this.name}: the kit's helper was asked for execution '${executionId}' with no delegation open (kit bug)`);
    const workId = `${toolCallId}-work`;
    if (settledToolCallIds(transcript).has(workId)) return { text: SUBAGENT_ANSWER };
    return { toolCalls: [{ id: workId, name: ENGINE_TOOL.execute, args: { command: this.operations.shellCommand(toolCallId) } }] };
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
      case "cut":
        throw new Error(`${this.name}: cut() is not producible by this subject (its model calls hold no vendor connection across the turn; the runtime arm is declared off for it); test bug`);
      case "open":
        if (step.as === "subagent" && step.streams) {
          throw new Error(`${this.name}: open(…, { as: "subagent", streams: true }) is not translated by this subject (a helper's turn prints nothing); test bug`);
        }
        return;
      case "say":
      case "read":
      case "usage":
      case "hang":
      case "limit":
      case "compact":
      case "message":
        return;
      default: {
        const exhaustive: never = step;
        throw new Error(`${this.name}: unknown scenario step ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  /** The kit's person sends the `message` step after the step at `index` (the header's `message`), once per execution. */
  private sendAfter(plan: ArrangedTurn, index: number): void {
    const message = messageAfter(plan.steps, index);
    if (message === undefined) return;
    const sent = this.sentMessages.get(plan.view.executionId) ?? new Set<string>();
    if (sent.has(message.text)) return;
    sent.add(message.text);
    this.sentMessages.set(plan.view.executionId, sent);
    plan.view.sendMessage(message.text);
  }

  /** Whether `message` is a person's word sent while the turn worked, by its text: the kit's person sent it. */
  private isSentMidTurn(executionId: string, message: BaseMessage): boolean {
    return isHumanMessage(message) && (this.sentMessages.get(executionId)?.has(message.text) ?? false);
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
    } else if (step.kind === "compact") {
      seedFile(resolveWorkspacePath(BULK_FILE, workspaceDir, true).absolutePath, BULK_CONTENT);
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
    const segment = messagesOfThisTurn(transcript, (m) => this.isSentMidTurn(executionId, m));
    const spoken = new Set(segment.filter((m) => isAIMessage(m)).map((m) => m.text));
    const firstCallOfArrangement = !plan.usageFolded;
    const compacted = (this.summaries.get(executionId) ?? 0) - plan.summariesAtArrange;
    let compactsSeen = 0;

    let text: string | undefined;
    let usage: ScriptedUsage | undefined;
    const close = (rest: Partial<ScriptedTurn>): ScriptedTurn => {
      if (usage !== undefined) plan.usageFolded = true;
      return { text, usage, ...rest };
    };

    for (const [index, step] of plan.steps.entries()) {
      if (step.kind === "compact") {
        compactsSeen += 1;
        if (compactsSeen <= compacted) continue;
        this.sizeWindow(executionId, transcript);
        return close({ toolCalls: [{ id: `kit-compact-${++this.mintCounter}`, name: "read_file", args: { file_path: BULK_FILE } }] });
      }
      // A step before a compaction the engine already did is done (the header).
      if (compactsSeen < compacted) continue;
      switch (step.kind) {
        case "say":
          if (spoken.has(step.text)) break;
          if (text !== undefined) return close({ toolCalls: [this.neutralCall("boundary")] });
          text = step.text;
          break;
        case "propose":
          if (settled.has(step.toolCallId)) break;
          this.sendAfter(plan, index);
          return close({ toolCalls: [this.gatedCall(step.toolCallId, step.action, plan.view)] });
        case "read":
          if (settled.has(step.toolCallId)) break;
          this.sendAfter(plan, index);
          return close({ toolCalls: [{ id: step.toolCallId, name: "read_file", args: { file_path: step.path } }] });
        case "usage":
          if (!firstCallOfArrangement) break;
          usage = addUsage(usage, step.delta);
          break;
        case "hang":
          return close({ ends: { kind: "hang" } });
        case "fail":
          return close({ ends: { kind: "fail", error: new Error(step.message) } });
        case "limit":
          return close({ toolCalls: [this.neutralCall("limit")] });
        case "open":
          if (settled.has(step.toolCallId)) break;
          this.sendAfter(plan, index);
          if (step.as === "subagent") {
            this.delegations.set(executionId, step.toolCallId);
            return close({ toolCalls: [{ id: step.toolCallId, name: "task", args: { description: "The kit's delegated work.", subagent_type: KIT_SUBAGENT_SLUG } }] });
          }
          return close({ toolCalls: [{ id: step.toolCallId, name: ENGINE_TOOL.execute, args: { command: this.operations.shellCommand(step.toolCallId) } }] });
        case "message":
          if (segment.some((m) => isHumanMessage(m) && m.text === step.text)) break;
          if (this.sentMessages.get(executionId)?.has(step.text)) {
            throw new Error(`${this.name}: the model was called again before it read the message sent mid-turn: '${step.text}'`);
          }
          // Sent as the answer before it is written: the round's end reads it.
          this.sendAfter(plan, index - 1);
          return close({});
        case "cancelled":
        case "cut":
          // Refused at `arrange`; unreachable in a plan that got this far.
          throw new Error(`${this.name}: ${step.kind}() reached the engine (arrange should have refused it)`);
        default: {
          const exhaustive: never = step;
          throw new Error(`${this.name}: unknown scenario step ${JSON.stringify(exhaustive)}`);
        }
      }
    }
    return close({});
  }

  /**
   * Size the window of an engine whose plan compacts, once, from the request
   * the runner really sends: 0.85 of it is that request plus a few bulk
   * reads, so a compaction lands after those reads and again after as many.
   */
  private sizeWindow(executionId: string, transcript: readonly BaseMessage[]): void {
    if (this.windows.get(executionId) !== UNSIZED_WINDOW) return;
    const engine = this.engines.get(executionId);
    const tools = (engine?.boundTools ?? []) as Parameters<typeof countTokensApproximately>[1];
    const request = countTokensApproximately([...transcript], tools);
    const read = countTokensApproximately([new HumanMessage(BULK_CONTENT)]);
    this.windows.set(executionId, Math.ceil((request + BULK_READS_PER_COMPACTION * read) / 0.85));
  }

  /** An ungated, effect-free tool call: the step boundary a LangGraph agent needs between two texts, and the loop a `limit` spins. */
  private neutralCall(why: "boundary" | "limit"): ScriptedToolCall {
    return { id: `kit-${why}-${++this.mintCounter}`, name: ENGINE_TOOL.ls, args: { path: "/" } };
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

/**
 * The messages after the last human message that starts a turn: what this
 * kit turn has said and done so far. A compaction's summary is not a human
 * turn, and neither is a person's word sent while the turn worked
 * (`sentMidTurn`): the turn it was read in goes on.
 */
function messagesOfThisTurn(transcript: readonly BaseMessage[], sentMidTurn: (m: BaseMessage) => boolean): readonly BaseMessage[] {
  let start = 0;
  transcript.forEach((m, i) => {
    if (isHumanMessage(m) && !isSummaryMessage(m) && !sentMidTurn(m)) start = i + 1;
  });
  return transcript.slice(start);
}

/** deepagents' summary message: a human message the summarization middleware marks as its own. */
function isSummaryMessage(message: BaseMessage): boolean {
  return message.additional_kwargs?.lc_source === "summarization";
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

// ── Open operations ─────────────────────────────────────────────────────────

/** The line that ends a kit shell; never a line the kit emits. */
const RELEASE_LINE = "__kit_release__";

/** A shell the kit drives through its control FIFO. */
interface KitOperation {
  readonly ctl: string;
  readonly command: string;
  readonly writer: Promise<FileHandle>;
  running: boolean;
  done: boolean;
}

/**
 * The operations `open` steps start, by tool-call id. A shell is opened
 * through a FIFO: the subject's open of the write end completes exactly when
 * the shell opens the read end, so "running" is the kernel's rendezvous,
 * never a poll. A release covers later openings of the same id too (a
 * reinvocation that re-runs the call), and is safe on one that never ran.
 */
class KitOperations {
  private readonly operations = new Map<string, KitOperation>();
  private readonly waiters = new Map<string, Array<() => void>>();
  private readonly released = new Set<string>();
  /** How many shells began under each id: the moment the shell opened its FIFO. */
  private readonly starts = new Map<string, number>();
  private counter = 0;

  constructor(private readonly dir: string) {}

  opened(toolCallId: string): number {
    return this.starts.get(toolCallId) ?? 0;
  }

  /** The command for `toolCallId`'s shell, starting a new one unless one is still live. */
  shellCommand(toolCallId: string): string {
    const live = this.operations.get(toolCallId);
    if (live !== undefined && !live.done) return live.command;
    mkdirSync(this.dir, { recursive: true });
    const ctl = join(this.dir, `op-${++this.counter}.ctl`);
    execFileSync("mkfifo", [ctl]);
    const command =
      `exec 3<'${ctl}'; ` +
      `while IFS= read -r line <&3; do [ "$line" = '${RELEASE_LINE}' ] && break; printf '%s\\n' "$line"; done; ` +
      `echo 'kit operation finished'`;
    const operation: KitOperation = { ctl, command, writer: open(ctl, "w"), running: false, done: false };
    this.operations.set(toolCallId, operation);
    void operation.writer.then(
      () => {
        operation.running = true;
        this.starts.set(toolCallId, this.opened(toolCallId) + 1);
        this.wake(toolCallId);
        if (this.released.has(toolCallId)) void this.finish(operation);
      },
      () => {},
    );
    return command;
  }

  whenOpen(toolCallId: string): Promise<void> {
    const operation = this.operations.get(toolCallId);
    if (operation?.running) return Promise.resolve();
    return new Promise((resolve) => this.waiters.set(toolCallId, [...(this.waiters.get(toolCallId) ?? []), resolve]));
  }

  async emit(toolCallId: string, line: string): Promise<void> {
    const operation = this.operations.get(toolCallId);
    if (operation === undefined || operation.done) throw new Error(`deep-agent: emit(${toolCallId}) with no shell open (kit bug)`);
    await (await operation.writer).write(`${line}\n`);
  }

  async release(toolCallId: string): Promise<void> {
    this.released.add(toolCallId);
    const operation = this.operations.get(toolCallId);
    if (operation && !operation.done) await this.finish(operation);
  }

  private wake(toolCallId: string): void {
    for (const waiter of this.waiters.get(toolCallId) ?? []) waiter();
    this.waiters.delete(toolCallId);
  }

  /** End an operation: tell the shell to finish, first completing a write end still waiting for a reader that never came. */
  private async finish(operation: KitOperation): Promise<void> {
    if (operation.done) return;
    operation.done = true;
    const reader = operation.running ? undefined : openSync(operation.ctl, constants.O_RDONLY | constants.O_NONBLOCK);
    const handle = await operation.writer;
    try {
      await handle.write(`${RELEASE_LINE}\n`);
    } catch {
      // The shell is gone (its run was torn down): nothing is left to tell.
    } finally {
      await handle.close();
      if (reader !== undefined) closeSync(reader);
      rmSync(operation.ctl, { force: true });
    }
  }
}
