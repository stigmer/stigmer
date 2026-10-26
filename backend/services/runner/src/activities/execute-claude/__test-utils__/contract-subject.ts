/**
 * The Claude harness as a `HarnessContractSubject` — the REAL
 * `createClaudeAdapter()`, hosted as production hosts it (the remote adapter
 * in front, the adapter in an agent host behind the pipe), running the REAL
 * engine, whose model is the wire-level mock behind the runner's real proxy
 * (`claude-wire.ts`). There is no SDK double: the only thing scripted is
 * what the model says, and the kit's engine-neutral scenario vocabulary is
 * translated onto that.
 *
 * ── The engine is per execution, and its memory is its transcript ──────────
 * Every model call reaches the mock with the run's execution id (the proxy
 * stamps the live turn's), which picks the plan the kit arranged for that
 * execution. On every call the model plays the first step the conversation
 * does not yet show: a `propose`, `read` or `open` whose tool-use id already
 * has a result anywhere in the conversation is done (run, or refused by the
 * gate or by a person); a `say` already spoken after the turn's task is
 * done; `usage` folds
 * into the first model call of the arrangement. Nothing is remembered on the
 * subject: the session store is the engine's memory, which is why one plan
 * is right on a later invocation too.
 *
 * ── The translation, one rule per word ──────────────────────────────────────
 *  - `say(text)`      → the turn's text. A second `say` before any tool step
 *                       closes the first with a neutral step, a `Glob` of the
 *                       workspace (no approval, no change): a model reply
 *                       that ends on text ends the engine's turn.
 *  - `propose(id, a)` → ONE gated built-in, which the gate pauses (`defer`),
 *                       whose execution is counted by a real side effect
 *                       read back from disk: `write r` → `Write` of a file
 *                       holding `id` at `r` in the workspace; `shell r` →
 *                       `Bash` appending `id` to the session's shell ledger,
 *                       `r` riding as a comment. The engine re-runs it when
 *                       the run resumes with the person's answer.
 *  - `read(id, path)` → `Read` of a file the subject seeds.
 *  - `usage(delta)`   → the model call's own usage, the input given net of
 *                       the cache buckets as the API reports it; every other
 *                       call reports none, so the kit's sums are exact.
 *  - `hang`           → the model call is held open until the turn stops it
 *                       (the engine's interrupt ends the request); the hold
 *                       resolves `whenHanging()`. A `say` before it is
 *                       spoken first, closed by the neutral step.
 *  - `fail(msg)`      → the model call answers an API error carrying `msg`;
 *                       the engine ends its run failed (`engine`). The other
 *                       surfaces are refused: no model answer provokes them.
 *  - `open(id)`       → a REAL host-served `Bash` of the kit's FIFO shell
 *                       (`harness-contract/kit-operations.ts`), so
 *                       `whenOpen`, `emit` and `release` drive a real
 *                       command; under the record's whole-run trust, since a
 *                       shell is gated in every other posture.
 *  - `open(id, { as: "subagent" })` → an `Agent` call (its own id,
 *                       {@link delegationIdOf}) handing the work to the
 *                       kit's saved helper, which the engine runs as a
 *                       sub-agent; the helper's model, known by its
 *                       instructions in its prompt, runs the same FIFO
 *                       shell under `id`, then answers, and the main agent
 *                       plays on once the delegation's result is in.
 *  - `message(text)`  → the kit's person sends `text` as the engine plays
 *                       the step before it; the step is done once the
 *                       conversation shows the engine read it: as a user
 *                       message, or riding the result of the call it was
 *                       read with.
 *  - `compact`        → a neutral step whose usage says the window is nearly
 *                       full: the engine compacts its own conversation
 *                       before its next call. Its summary request is
 *                       answered out of band with {@link COMPACTION_SUMMARY}
 *                       and counted, never taken for a step; a step before a
 *                       compaction the engine already did is done, since
 *                       the conversation that held it is now the summary.
 *  - `limit`, `cancelled` and `cut` are refused at `arrange` as test bugs:
 *    the runtime arms that need them are declared off for this subject,
 *    each with its reason in the kit file.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AnthropicMessageBody } from "@stigmer/test-support/llm-wire";
import type { RoutedResponse } from "@stigmer/test-support/mock-llm";

import type { Config } from "../../../config.js";
import type { HarnessAdapter } from "../../../harness/types.js";
import type { ProposedAction } from "../../../__test-utils__/approval-contract/types.js";
import { KitOperations } from "../../../__test-utils__/harness-contract/kit-operations.js";
import { RUNTIME_USER_MESSAGE } from "../../../__test-utils__/harness-contract/runtime-contract.js";
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
import { loopbackHostedRow } from "../../../__test-utils__/loopback-host.js";
import { FIXTURE_CLAUDE_MODEL } from "../../../__test-utils__/model-registry-fixture.js";
import { ServiceTier, ThinkingMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { createClaudeAdapter } from "../adapter.js";
import { startClaudeWire, type ClaudeWire, type WireConversation } from "./claude-wire.js";
import { hermeticClaudeConfig } from "./hermetic-claude.js";

/** The user's message every adapter-half turn asks. */
const KIT_USER_MESSAGE = "Do what the scenario says.";

/** What a seeded `read` target contains; never asserted. */
const READ_FILE_CONTENT = "seeded by the harness contract kit\n";

/**
 * How the engine's own compaction asks the model for its summary (the
 * engine's prompt, SDK 0.3.310): a call carrying it is the engine
 * summarizing, never a step of the plan.
 */
const COMPACTION_PROMPT_MARK = "Your task is to create a detailed summary of the conversation so far";

/** What the model answers a compaction with; it must never reach the person as the agent's words. */
const COMPACTION_SUMMARY = "The kit's conversation so far, summarized for the engine.";

/** A model call's input that leaves the engine's window nearly full, so it compacts before its next call. */
const WINDOW_NEARLY_FULL_TOKENS = 195_000;

/** How long a `hang` holds its model call: far past any arm; the turn's stop ends it. */
const HANG_HOLD_MS = 3_600_000;

/** One tool use the model makes. */
interface WireToolUse {
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

/** The usage one model call reports: the kit's counts, the input including the cache buckets. */
interface WireUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** The turn the kit arranged for an execution. */
interface ArrangedTurn {
  readonly steps: TurnScenario;
  readonly view: EngineView;
  usageFolded: boolean;
  /** The engine's compaction count when the turn was arranged; the plan's compactions are the ones after it. */
  readonly compactedAtArrange: number;
}

/** Where a proposal's executions are counted. */
type LedgerRef = { readonly kind: "write"; readonly file: string } | { readonly kind: "shell"; readonly file: string };

export interface ClaudeContractSubject extends HarnessContractSubject {
  /** The wire, once the adapter has booted. */
  readonly wire: ClaudeWire | undefined;
  /** The session's workspace directory, as the runtime's provisioner resolves it and this subject seeds it. */
  workspaceDirOf(sessionId: string): string;
  /** Stop the wire; the file's `afterAll`. */
  close(): Promise<void>;
}

/** Build the subject over one hermetic environment. */
export function createClaudeContractSubject(env: HermeticEnvironment): ClaudeContractSubject {
  return new ClaudeSubject(env);
}

class ClaudeSubject implements ClaudeContractSubject {
  readonly name = "claude";
  readonly harness = "claude" as const;
  readonly model = FIXTURE_CLAUDE_MODEL;
  readonly config: Config;
  readonly adapter: HarnessAdapter;
  readonly longTurn: LongTurnControls;

  wire: ClaudeWire | undefined;
  private readonly arranged = new Map<string, ArrangedTurn>();
  private readonly lastConversations = new Map<string, WireConversation>();
  private readonly executionsBySession = new Map<string, string>();
  private readonly ledgers = new Map<string, LedgerRef>();
  private readonly sentMessages = new Map<string, Set<string>>();
  private readonly hangWaiters: Array<() => void> = [];
  private readonly operations: KitOperations;
  /** Per execution, how many times the engine compacted its conversation. */
  private readonly compacted = new Map<string, number>();
  private mintCounter = 0;

  constructor(private readonly env: HermeticEnvironment) {
    this.config = hermeticClaudeConfig(env);
    this.operations = new KitOperations(join(env.workspaceRootDir, "kit-operations"), this.name);
    // The proxy the hosted row dials is started at the first boot (it is
    // asynchronous; the kit reads the adapter at collection time), so the row
    // is built then too, behind a stand-in that forwards to it.
    let hosted: HarnessAdapter | undefined;
    const subject = this;
    const real = (): HarnessAdapter => {
      if (hosted === undefined) throw new Error(`${this.name}: the adapter was used before boot (kit bug)`);
      return hosted;
    };
    const adapter = createClaudeAdapter();
    this.adapter = {
      name: adapter.name,
      capabilities: adapter.capabilities,
      async boot(config: Config): Promise<void> {
        subject.wire ??= await startClaudeWire(subject.config, (conversation) => subject.play(conversation));
        hosted ??= loopbackHostedRow({ harness: "claude", adapter }, { proxy: subject.wire.proxy }).adapter;
        await hosted.boot(config);
      },
      shutdown: () => real().shutdown(),
      releaseSession: (sessionId) => real().releaseSession(sessionId),
      runTurn: (input, sink) => real().runTurn(input, sink),
    };
    this.longTurn = {
      whenOpen: (toolCallId) => this.operations.whenOpen(toolCallId),
      emit: (toolCallId, line) => this.operations.emit(toolCallId, line),
      release: (toolCallId) => this.operations.release(toolCallId),
      opened: (toolCallId) => this.operations.opened(toolCallId),
      tasksHanded: (sessionId, message) => this.userTextsOf(sessionId).filter((text) => text.includes(message)).length,
      messagesRead: (sessionId, text) => this.readTextsOf(sessionId).filter((said) => said.includes(text)).length,
      compactions: (sessionId) => this.compacted.get(this.executionsBySession.get(sessionId) ?? "") ?? 0,
      compactionSummary: { text: COMPACTION_SUMMARY },
      // The store holds what the engine mirrored; nothing else outlives the process.
      loseRunner: () => {},
    };
  }

  async close(): Promise<void> {
    await this.wire?.close();
  }

  // ── HarnessContractSubject ────────────────────────────────────────────────

  arrange(turn: TurnScenario, view: EngineView): void {
    for (const step of turn) this.refuseUnproducible(step);
    mkdirSync(this.workspaceDirOf(view.sessionId), { recursive: true });
    for (const step of turn) this.seedFor(step, view);
    this.arranged.set(view.executionId, { steps: turn, view, usageFolded: false, compactedAtArrange: this.compacted.get(view.executionId) ?? 0 });
    this.executionsBySession.set(view.sessionId, view.executionId);
  }

  inputOverrides(view: EngineView): SubjectInputOverrides {
    return {
      workspaceDir: this.workspaceDirOf(view.sessionId),
      message: KIT_USER_MESSAGE,
      model: { requested: FIXTURE_CLAUDE_MODEL, serviceTier: ServiceTier.STANDARD, thinkingMode: ThinkingMode.DISABLED },
    };
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

  workspaceDirOf(sessionId: string): string {
    return join(this.env.workspaceRootDir, "sessions", sessionId);
  }

  // ── The engine's model ────────────────────────────────────────────────────

  /** The words this subject has no honest translation for (the header); each a test bug, named. */
  private refuseUnproducible(step: ScenarioStep): void {
    switch (step.kind) {
      case "propose":
        if (step.action.kind !== "write" && step.action.kind !== "shell") throw new Error(`${this.name}: propose(${step.action.kind}) is not translated by this subject; test bug`);
        return;
      case "fail":
        if (step.surface !== "engine") throw new Error(`${this.name}: fail(..., "${step.surface}") is not producible by a model answer; test bug`);
        return;
      case "open":
        return;
      case "limit":
      case "cancelled":
      case "cut":
        throw new Error(`${this.name}: ${step.kind}() is not producible by this subject (its runtime arm is declared off); test bug`);
      case "compact":
      case "say":
      case "read":
      case "usage":
      case "hang":
      case "message":
        return;
      default: {
        const exhaustive: never = step;
        throw new Error(`${this.name}: unknown scenario step ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  /** Put on disk what a step's tool finds there. */
  private seedFor(step: ScenarioStep, view: EngineView): void {
    const workspaceDir = this.workspaceDirOf(view.sessionId);
    if (step.kind === "propose" && step.action.kind === "write") {
      this.ledgers.set(step.toolCallId, { kind: "write", file: inWorkspace(workspaceDir, step.action.resource) });
    } else if (step.kind === "propose" && step.action.kind === "shell") {
      const file = this.shellLedgerOf(view.sessionId);
      mkdirSync(dirname(file), { recursive: true });
      this.ledgers.set(step.toolCallId, { kind: "shell", file });
    } else if (step.kind === "read") {
      const file = inWorkspace(workspaceDir, step.path);
      if (!existsSync(file)) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, READ_FILE_CONTENT);
      }
    }
  }

  private shellLedgerOf(sessionId: string): string {
    return join(this.env.workspaceRootDir, "kit-ledgers", `${sessionId}.log`);
  }

  /** The session's last conversation's user texts. */
  private userTextsOf(sessionId: string): readonly string[] {
    const executionId = this.executionsBySession.get(sessionId);
    return (executionId === undefined ? undefined : this.lastConversations.get(executionId))?.userTexts ?? [];
  }

  /** Every text the session's last conversation handed the model from the person's side: its user texts and its tool results. */
  private readTextsOf(sessionId: string): readonly string[] {
    const executionId = this.executionsBySession.get(sessionId);
    const conversation = executionId === undefined ? undefined : this.lastConversations.get(executionId);
    return conversation === undefined ? [] : readTexts(conversation);
  }

  /** The kit's person sends the `message` step after the step at `index`, once per execution. */
  private sendAfter(plan: ArrangedTurn, index: number): void {
    const message = messageAfter(plan.steps, index);
    if (message === undefined) return;
    const sent = this.sentMessages.get(plan.view.executionId) ?? new Set<string>();
    if (sent.has(message.text)) return;
    sent.add(message.text);
    this.sentMessages.set(plan.view.executionId, sent);
    plan.view.sendMessage(message.text);
  }

  /** One model call's answer: the plan's first step the conversation does not show (the header). */
  play(conversation: WireConversation): AnthropicMessageBody | RoutedResponse {
    const executionId = headerOf(conversation, "x-stigmer-execution-id");
    const plan = executionId === undefined ? undefined : this.arranged.get(executionId);
    if (plan === undefined || executionId === undefined) throw new Error(`${this.name}: the model was asked for execution '${executionId ?? "<none>"}' with no turn arranged (kit bug)`);
    if (conversation.userTexts.some((text) => text.includes(COMPACTION_PROMPT_MARK))) {
      // The engine summarizing, out of band: the plan's next step is still next.
      this.compacted.set(executionId, (this.compacted.get(executionId) ?? 0) + 1);
      return this.body(`<analysis>The kit's turn.</analysis>\n<summary>${COMPACTION_SUMMARY}</summary>`, [], { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    }
    if (conversation.system.includes(KIT_SUBAGENT_INSTRUCTIONS)) return this.playHelper(plan, conversation);
    this.lastConversations.set(executionId, conversation);
    const settled = new Set(conversation.toolResults.keys());
    const spoken = spokenThisTurn(conversation);
    const firstCall = !plan.usageFolded;
    const workspaceDir = this.workspaceDirOf(plan.view.sessionId);
    // The plan's compactions the engine has done; one the engine does on its
    // own (a step's usage filled the window) moves no step.
    const planned = plan.steps.filter((step) => step.kind === "compact").length;
    const compacted = Math.min(planned, (this.compacted.get(executionId) ?? 0) - plan.compactedAtArrange);
    let compactsSeen = 0;

    let text: string | undefined;
    const usage: WireUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const answer = (tools: readonly WireToolUse[] = []): AnthropicMessageBody => {
      plan.usageFolded = true;
      return this.body(text, tools, usage);
    };

    for (const [index, step] of plan.steps.entries()) {
      if (step.kind === "compact") {
        compactsSeen += 1;
        if (compactsSeen <= compacted) continue;
        // A step the model makes with the window nearly full: the engine
        // compacts before its next call.
        usage.input += WINDOW_NEARLY_FULL_TOKENS;
        return answer([this.neutralCall()]);
      }
      // A step before a compaction the engine already did is done: the conversation that held it is now the summary.
      if (compactsSeen < compacted) continue;
      switch (step.kind) {
        case "say":
          if (spoken.has(step.text)) break;
          if (text !== undefined) return answer([this.neutralCall()]);
          text = step.text;
          break;
        case "propose":
          if (settled.has(step.toolCallId)) break;
          this.sendAfter(plan, index);
          return answer([this.gatedCall(step.toolCallId, step.action, plan.view.sessionId, workspaceDir)]);
        case "read":
          if (settled.has(step.toolCallId)) break;
          this.sendAfter(plan, index);
          return answer([{ id: step.toolCallId, name: "Read", input: { file_path: inWorkspace(workspaceDir, step.path) } }]);
        case "usage":
          if (!firstCall) break;
          addUsage(usage, step.delta);
          break;
        case "hang":
          if (text !== undefined) return answer([this.neutralCall()]);
          for (const waiter of this.hangWaiters.splice(0)) waiter();
          return { body: answer(), delayMs: HANG_HOLD_MS };
        case "fail":
          plan.usageFolded = true;
          return { error: { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: step.message } } } };
        case "open":
          if (step.as === "subagent") {
            if (settled.has(delegationIdOf(step.toolCallId))) break;
            this.sendAfter(plan, index);
            return answer([{ id: delegationIdOf(step.toolCallId), name: "Agent", input: { description: "the kit's delegated work", prompt: "Do the delegated work.", subagent_type: KIT_SUBAGENT_SLUG } }]);
          }
          if (settled.has(step.toolCallId)) break;
          this.sendAfter(plan, index);
          return answer([this.operationCall(step.toolCallId)]);
        case "message":
          if (readTexts(conversation).some((said) => said.includes(step.text))) break;
          if (this.sentMessages.get(executionId)?.has(step.text)) {
            throw new Error(`${this.name}: the model was called again before the engine read the message sent mid-turn: '${step.text}'`);
          }
          this.sendAfter(plan, index - 1);
          return answer();
        case "limit":
        case "cancelled":
        case "cut":
          throw new Error(`${this.name}: ${step.kind}() reached the model (arrange should have refused it)`);
        default: {
          const exhaustive: never = step;
          throw new Error(`${this.name}: unknown scenario step ${JSON.stringify(exhaustive)}`);
        }
      }
    }
    return answer();
  }

  private body(text: string | undefined, tools: readonly WireToolUse[], usage: WireUsage): AnthropicMessageBody {
    return {
      id: `msg_claude_kit_${++this.mintCounter}`,
      type: "message",
      role: "assistant",
      model: FIXTURE_CLAUDE_MODEL,
      content: [
        ...(text === undefined ? [] : [{ type: "text" as const, text }]),
        ...tools.map((tool) => ({ type: "tool_use" as const, id: tool.id, name: tool.name, input: tool.input })),
      ],
      stop_reason: tools.length > 0 ? "tool_use" : "end_turn",
      // The API reports the input net of the cache buckets.
      usage: {
        input_tokens: Math.max(usage.input - usage.cacheRead - usage.cacheWrite, 0),
        output_tokens: usage.output,
        cache_read_input_tokens: usage.cacheRead,
        cache_creation_input_tokens: usage.cacheWrite,
      },
    };
  }

  /** An ungated, effect-free call: the step boundary between two texts. */
  /** The kit's helper's model call: the first delegated operation its conversation has not run, then its answer. */
  private playHelper(plan: ArrangedTurn, conversation: WireConversation): AnthropicMessageBody {
    const open = plan.steps.find((step) => step.kind === "open" && step.as === "subagent" && !conversation.toolResults.has(step.toolCallId));
    const none = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    return open?.kind === "open" ? this.body(undefined, [this.operationCall(open.toolCallId)], none) : this.body("The delegated work is done.", [], none);
  }

  /** The kit's FIFO shell for operation `id` (`harness-contract/kit-operations.ts`). */
  private operationCall(id: string): WireToolUse {
    return { id, name: "Bash", input: { command: this.operations.shellCommand(id), description: "the kit's operation" } };
  }

  private neutralCall(): WireToolUse {
    return { id: `toolu_kit_boundary_${++this.mintCounter}`, name: "Glob", input: { pattern: "*" } };
  }

  private gatedCall(toolCallId: string, action: ProposedAction, sessionId: string, workspaceDir: string): WireToolUse {
    switch (action.kind) {
      case "write":
        return { id: toolCallId, name: "Write", input: { file_path: inWorkspace(workspaceDir, action.resource), content: `${toolCallId}\n` } };
      case "shell":
        return {
          id: toolCallId,
          name: "Bash",
          input: { command: `printf '%s\\n' '${toolCallId}' >> '${this.shellLedgerOf(sessionId)}' # ${action.resource}`, description: "the kit's gated call" },
        };
      case "delete":
      case "read":
      case "mcp":
        throw new Error(`${this.name}: propose(${action.kind}) reached the model (arrange should have refused it)`);
      default: {
        const exhaustive: never = action.kind;
        throw new Error(`${this.name}: unknown action kind ${String(exhaustive)}`);
      }
    }
  }
}

/** A kit path (`/work/alpha.txt`, the workspace's root as `/`) in the session's real workspace. */
function inWorkspace(workspaceDir: string, path: string): string {
  return join(workspaceDir, path.replace(/^\/+/, ""));
}

/**
 * The texts a conversation handed the model from the person's side: its user
 * texts, and its tool results, which carry a message the engine read while
 * the tool ran (it rides the result as a reminder).
 */
function readTexts(conversation: WireConversation): string[] {
  return [...conversation.userTexts, ...[...conversation.toolResults.values()].map((result) => result.text)];
}

function headerOf(conversation: WireConversation, name: string): string | undefined {
  const value = conversation.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The assistant texts after the turn's task: the last user message that
 * carries the task (the adapter half's or the runtime half's), so a later
 * invocation of the same run (a continuation note, a message read mid-turn)
 * is still the same turn.
 */
function spokenThisTurn(conversation: WireConversation): ReadonlySet<string> {
  const messages = Array.isArray(conversation.body.messages) ? (conversation.body.messages as { role?: unknown; content?: unknown }[]) : [];
  let start = 0;
  messages.forEach((message, index) => {
    if (message.role === "user" && carriesTask(message.content)) start = index + 1;
  });
  const spoken = new Set<string>();
  for (const message of messages.slice(start)) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const block of message.content as { type?: unknown; text?: unknown }[]) {
      if (block.type === "text" && typeof block.text === "string") spoken.add(block.text);
    }
  }
  return spoken;
}

function carriesTask(content: unknown): boolean {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  return text.includes(KIT_USER_MESSAGE) || text.includes(RUNTIME_USER_MESSAGE);
}

function addUsage(total: WireUsage, delta: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }): void {
  total.input += delta.inputTokens ?? 0;
  total.output += delta.outputTokens ?? 0;
  total.cacheRead += delta.cacheReadTokens ?? 0;
  total.cacheWrite += delta.cacheWriteTokens ?? 0;
}

/** The `Agent` call that hands operation `id` to the kit's helper: its own id, since the helper's shell runs under `id`. */
export function delegationIdOf(id: string): string {
  return `${id}-delegation`;
}
