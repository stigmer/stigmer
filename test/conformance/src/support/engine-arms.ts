// One scripted turn, run on each engine an execution suite proves it on.
// Domain: conformance support (execution engine).
//
// A suite names a turn once, in engine-neutral steps (a shell call, a file
// write, a delegation, the closing text), and an arm turns it into what that
// engine's model says:
//   - native: the session's engine left unset (stored unspecified, run as
//     native), and the steps queued on the mock in order, one model call
//     each, under native's tool names;
//   - Claude: the session on Harness.CLAUDE, and the steps played by a router
//     (@stigmer/test-support/claude-engine-wire) that answers each request
//     from its conversation: the first step whose call has no result yet.
//     The engine re-sends its history when it resumes or recovers, so a
//     queue would answer a replay with the next step; a router answers the
//     same conversation the same way however often it arrives.
// A tool's name on Claude is the one the platform's vocabulary maps native's
// to (@stigmer/tool-vocabulary, claudeNameOf), and its input is the Claude
// tool's shape.
//
// An arm is a seam, not a matrix: a suite that proves a case on Claude
// writes that case in its own `describe("on Claude")` block from the arm,
// beside its native cases, rather than running every native case on every
// engine; most native cases assert native facts (its checkpoint, its
// helpers) that have no Claude reading.
//
// Which turn a request belongs to is the task text its user carries: every
// scripted turn is keyed by a unique text (the run's message, or a helper's
// delegated prompt), and a conversation that carries several, a session's
// later turn, plays the newest one's steps.
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { claudeEngineRoute, type WireConversation } from "@stigmer/test-support/claude-engine-wire";
import {
  anthropicText,
  anthropicToolUses,
  type AnthropicMessageBody,
  type CapturedLlmRequest,
  type MockLlmProxy,
  type RoutedResponse,
} from "@stigmer/test-support/mock-llm";
// The vocabulary module is pure (no imports), read from its source as the
// benchmark reads the activity names, so the suite takes no package dependency.
import { claudeNameOf } from "../../../../backend/libs/ts/tool-vocabulary/src/vocabulary";

import type { CapabilityFlags } from "../targets/target";

/** One step of a scripted turn: one model call, in engine-neutral words. */
export type ArmStep =
  /**
   * A shell command; `timeoutSeconds` raises its bound, as a model raises it
   * for a long command. `retryInterrupted`: the model asks for it again, under
   * a new id, when the engine hands back the call as interrupted (a lost
   * runner cut it, and its outcome is unknown); native re-runs a cut step
   * from its checkpoint on its own.
   */
  | { readonly kind: "shell"; readonly id: string; readonly command: string; readonly timeoutSeconds?: number; readonly retryInterrupted?: boolean }
  | { readonly kind: "write"; readonly id: string; readonly path: string; readonly content: string }
  | { readonly kind: "edit"; readonly id: string; readonly path: string; readonly oldString: string; readonly newString: string }
  | { readonly kind: "read"; readonly id: string; readonly path: string }
  /** Hand `prompt` to the agent's saved sub-agent `agent`; its own turn is scripted under `prompt`. */
  | { readonly kind: "delegate"; readonly id: string; readonly agent: string; readonly prompt: string }
  /** A call by its name on every engine (an MCP tool, an engine's own tool). */
  | { readonly kind: "call"; readonly id: string; readonly name: string; readonly input: Record<string, unknown> }
  /** Several calls in one model reply (a parallel batch). */
  | { readonly kind: "batch"; readonly calls: readonly ArmCall[] }
  /** The model's closing words: the turn ends on them. */
  | { readonly kind: "text"; readonly text: string };

/** One call of a step. */
export type ArmCall = Exclude<ArmStep, { kind: "text" } | { kind: "batch" }>;

/** The engines a suite proves a case on. */
export type ArmWord = "stigmer" | "claude";

export interface EngineArm {
  readonly word: ArmWord;
  /** The session's engine (`sessionSpec.harness`); undefined leaves it unset, which runs native. */
  readonly harness: Harness | undefined;
  /** Script `steps` as the model's answers to the turn whose user carries `task`. */
  script(mock: MockLlmProxy, task: string, steps: readonly ArmStep[]): void;
  /** The agent loop's requests the mock answered for this arm, oldest first. */
  loopRequests(mock: MockLlmProxy): readonly CapturedLlmRequest[];
  /** How many times the engine compacted its conversation, as the mock answered it. */
  compactions(mock: MockLlmProxy): number;
}

/** Why a Claude arm does not run where `claudeTurnsRun` is false. */
export const CLAUDE_TURNS_SKIP_REASON =
  "this target runs no Claude turn on the wire mock: its runner and server are the composition's, with no restart door and no Anthropic key for the mock's runs";

/** A Claude block's `beforeEach`: skips each case, naming why, where the target runs no Claude turn. */
export function claudeTurnsOnly(capabilities: Pick<CapabilityFlags, "claudeTurnsRun">): (context: { skip(note?: string): void }) => void {
  return (context) => {
    if (!capabilities.claudeTurnsRun) context.skip(CLAUDE_TURNS_SKIP_REASON);
  };
}

/** The arms of the engines `capabilities` runs, native first. */
export function engineArms(capabilities: Pick<CapabilityFlags, "claudeTurnsRun">): readonly EngineArm[] {
  return capabilities.claudeTurnsRun ? [NATIVE_ARM, CLAUDE_ARM] : [NATIVE_ARM];
}

/** A step's call in native's words: its tool name and input. */
function nativeCall(step: ArmCall): { readonly name: string; readonly input: Record<string, unknown> } {
  switch (step.kind) {
    case "shell":
      return { name: "execute", input: { command: step.command, ...(step.timeoutSeconds === undefined ? {} : { timeout: step.timeoutSeconds }) } };
    case "write":
      return { name: "write_file", input: { file_path: step.path, content: step.content } };
    case "edit":
      return { name: "edit_file", input: { file_path: step.path, old_string: step.oldString, new_string: step.newString } };
    case "read":
      return { name: "read_file", input: { file_path: step.path } };
    case "delegate":
      return { name: "task", input: { description: step.prompt, subagent_type: step.agent } };
    case "call":
      return { name: step.name, input: step.input };
  }
}

export const NATIVE_ARM: EngineArm = {
  word: "stigmer",
  harness: undefined,
  script(mock, _task, steps) {
    for (const step of steps) {
      if (step.kind === "text") {
        mock.enqueue(anthropicText(step.text));
        continue;
      }
      const calls = step.kind === "batch" ? step.calls : [step];
      mock.enqueue(anthropicToolUses(calls.map((call) => ({ toolCallId: call.id, toolName: nativeCall(call).name, toolInput: nativeCall(call).input }))));
    }
  },
  loopRequests: (mock) => mock.scriptedRequests(),
  compactions: (mock) => mock.summaryRequests(),
};

/**
 * A step's call in Claude's words: the tool native's maps to, with the
 * Claude tool's input. A path is the workspace's own, which the engine
 * names in its environment block; a relative path is resolved against it.
 */
function claudeToolOf(step: ArmCall, conversation: WireConversation): { readonly name: string; readonly input: Record<string, unknown> } {
  const inWorkspace = (path: string): string => (path.startsWith("/") ? path : `${claudeWorkspaceOf(conversation)}/${path}`);
  switch (step.kind) {
    case "shell":
      return {
        name: claudeNameOf("stigmer", "execute"),
        // The engine's shell takes its bound in milliseconds.
        input: { command: step.command, description: "the scripted step", ...(step.timeoutSeconds === undefined ? {} : { timeout: step.timeoutSeconds * 1_000 }) },
      };
    case "write":
      return { name: claudeNameOf("stigmer", "write_file"), input: { file_path: inWorkspace(step.path), content: step.content } };
    case "edit":
      return { name: claudeNameOf("stigmer", "edit_file"), input: { file_path: inWorkspace(step.path), old_string: step.oldString, new_string: step.newString } };
    case "read":
      return { name: claudeNameOf("stigmer", "read_file"), input: { file_path: inWorkspace(step.path) } };
    case "delegate":
      return { name: claudeNameOf("stigmer", "task"), input: { description: "the scripted delegation", prompt: step.prompt, subagent_type: step.agent } };
    case "call":
      return { name: step.name, input: step.input };
  }
}

/** The workspace the engine runs in, as the environment block of its first user message names it. */
export function claudeWorkspaceOf(conversation: WireConversation): string {
  for (const said of [conversation.system, ...conversation.userTexts]) {
    const named = /Primary working directory: (\S+)/.exec(said);
    if (named?.[1] !== undefined) return named[1];
  }
  throw new Error("the Claude engine's request names no working directory; the arm cannot place a path");
}

/** How a Claude arm reports a model call's usage. */
export interface ClaudeArmOptions {
  /**
   * `fixed` (the default): 10 input and 5 output tokens a call, so a suite's
   * sums are exact. `sized`: the input the request's own length stands for
   * (four characters a token), as the API reports it, so the engine compacts
   * its conversation when the conversation would fill its window.
   */
  readonly usage?: "fixed" | "sized";
  /**
   * With sized usage, the model's window in tokens: a request whose input
   * would not fit is refused as the API refuses it ("prompt is too long",
   * 400), and the engine compacts its conversation then. An engine that
   * believes the window larger than it is (measured: Claude Haiku 4.5 on
   * SDK 0.3.310 never compacted at 300,000 tokens reported) meets the
   * window only this way, as it does against the API itself.
   */
  readonly windowTokens?: number;
}

/** Where a compaction's summary keeps what the model remembers of a turn: its task, and the calls already settled. */
const SUMMARY_TASK = "Task:";
const SUMMARY_DONE = "Done so far:";

/** An interrupted call's next id: the model asks for it again (ArmStep `retryInterrupted`). */
const againOf = (id: string): string => `${id}_again`;

/**
 * A Claude arm: its own router, its own scripted turns. The suites share
 * {@link CLAUDE_ARM}; the real-clock run builds one whose usage is sized.
 */
export function claudeArm(options: ClaudeArmOptions = {}): EngineArm {
  const turns = new Map<string, readonly ArmStep[]>();
  let minted = 0;

  /** The newest scripted turn the conversation's user carries, and its task. */
  const turnOf = (conversation: WireConversation): { readonly task: string; readonly steps: readonly ArmStep[] } | undefined => {
    for (const said of [...conversation.userTexts].reverse()) {
      let found: { readonly task: string; readonly steps: readonly ArmStep[] } | undefined;
      let at = -1;
      for (const [task, steps] of turns) {
        const index = said.lastIndexOf(task);
        if (index > at) {
          at = index;
          found = { task, steps };
        }
      }
      if (found !== undefined) return found;
    }
    return undefined;
  };

  /**
   * The calls the conversation shows settled: every result it carries, and
   * every id a compaction's summary kept (the conversation that held them is
   * the summary now).
   */
  const settledOf = (conversation: WireConversation): ReadonlySet<string> => {
    const settled = new Set<string>();
    for (const id of conversation.toolResults.keys()) settled.add(id);
    for (const said of conversation.userTexts) {
      const kept = new RegExp(`${SUMMARY_DONE} ([^\\n<]*)`).exec(said)?.[1];
      for (const id of kept?.split(",").map((part) => part.trim()).filter((part) => part !== "") ?? []) settled.add(id);
    }
    return settled;
  };

  /** Whether the engine handed `call` back interrupted and the step asks for it again (ArmStep `retryInterrupted`). */
  const retried = (call: ArmCall, conversation: WireConversation): boolean => {
    if (call.kind !== "shell" || call.retryInterrupted !== true) return false;
    const result = conversation.toolResults.get(call.id);
    return result !== undefined && result.isError && /interrupted/i.test(result.text);
  };

  /** Whether a call is done: its result is in (or its repeat's, when it was retried), or a summary kept it. */
  const done = (call: ArmCall, settled: ReadonlySet<string>, conversation: WireConversation): boolean =>
    retried(call, conversation) ? settled.has(againOf(call.id)) : settled.has(call.id) || settled.has(againOf(call.id));

  /** The input a request stands for, four characters a token. */
  const sizeOf = (conversation: WireConversation): number => Math.ceil(JSON.stringify(conversation.body).length / 4);

  const body = (text: string | undefined, calls: readonly { readonly id: string; readonly name: string; readonly input: Record<string, unknown> }[], conversation: WireConversation): AnthropicMessageBody => {
    minted += 1;
    return {
      id: `msg_conformance_claude_${minted}`,
      type: "message",
      role: "assistant",
      model: "claude-conformance",
      content: [
        ...(text === undefined ? [] : [{ type: "text" as const, text }]),
        ...calls.map((call) => ({ type: "tool_use" as const, id: call.id, name: call.name, input: call.input })),
      ],
      stop_reason: calls.length === 0 ? "end_turn" : "tool_use",
      usage: { input_tokens: options.usage === "sized" ? sizeOf(conversation) : 10, output_tokens: 5 },
    };
  };

  /**
   * One model call: the first step whose call the conversation does not show
   * settled. A batch is played whole the first time and, once the engine has
   * a result for some of its calls (a gated one refused to wait, to be asked
   * for again alone), as the calls still unsettled.
   */
  const play = (conversation: WireConversation): AnthropicMessageBody | RoutedResponse => {
    const turn = turnOf(conversation);
    if (turn === undefined) {
      return { error: { status: 500, body: { error: `no Claude turn is scripted for this conversation (its user said: ${JSON.stringify(conversation.userTexts.slice(-2))})` } } };
    }
    const size = sizeOf(conversation);
    if (options.usage === "sized" && options.windowTokens !== undefined && size > options.windowTokens) {
      return { error: { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: `prompt is too long: ${size} tokens > ${options.windowTokens} maximum` } } } };
    }
    const settled = settledOf(conversation);
    let text: string | undefined;
    for (const step of turn.steps) {
      if (step.kind === "text") {
        text = step.text;
        continue;
      }
      const calls = step.kind === "batch" ? step.calls : [step];
      const unsettled = calls.filter((call) => !done(call, settled, conversation));
      if (unsettled.length === 0) {
        text = undefined;
        continue;
      }
      return body(text, unsettled.map((call) => ({ id: retried(call, conversation) ? againOf(call.id) : call.id, ...claudeToolOf(call, conversation) })), conversation);
    }
    return body(text ?? "Done.", [], conversation);
  };

  /** What the model keeps of a turn it compacts: the task, so the turn is still named, and what is done. */
  const summary = (conversation: WireConversation): string => {
    const turn = turnOf(conversation);
    if (turn === undefined) return "The conversation so far, condensed.";
    return `${SUMMARY_TASK} ${turn.task}\n${SUMMARY_DONE} ${[...settledOf(conversation)].join(", ")}`;
  };

  const route = claudeEngineRoute(play, { compactionSummary: summary });
  return {
    word: "claude",
    harness: Harness.CLAUDE,
    script(mock, task, steps) {
      turns.set(task, steps);
      // reset() removes the router at each afterEach; installing it again is
      // the same router.
      mock.routeWith(route.route);
    },
    loopRequests: (mock) => mock.loopRequests().filter((request) => request.disposition === "routed"),
    compactions: () => route.compactions(),
  };
}

/** The Claude arm the suites share. */
export const CLAUDE_ARM: EngineArm = claudeArm();
