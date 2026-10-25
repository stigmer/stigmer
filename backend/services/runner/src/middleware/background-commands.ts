/**
 * The agent hears when a command it started in the background ends, and a
 * reply that ends while its commands still run does not end the turn.
 * Installed beside the `shell` middleware wherever commands can run in the
 * background (`shell.ts`; the root's stack and every sub-agent's).
 *
 *   - Before each model call (`beforeModel`), each of this graph's commands
 *     that ended and the thread has not been told of becomes one user
 *     message after the latest tool results, the way a person's message
 *     sent mid-turn is delivered (`execute-deep-agent/turn-input-middleware.ts`):
 *     `<background-command id="…" command="…" ended="exit 1">`, the end of
 *     its output cut to the run's tool-result budget, and its output file.
 *     A start this invocation does not hold was stopped when an earlier one
 *     ended (every invocation starts with nothing running,
 *     `shared/shell/background-commands.ts`); it is told as
 *     `ended="stopped"`, "when the turn paused for your approval" when this
 *     invocation resumes the person's decisions, else "when the turn was
 *     interrupted". One recovery path for an approval pause, a stop and a
 *     move to another runner alike.
 *   - At a round's end (`afterModel`, an answer with no tool calls) with
 *     this graph's commands still running: the first time in the
 *     invocation it sends the model back once with a reminder naming them,
 *     so a dev server it forgot is stopped rather than holding the turn to
 *     its timeout. After that it waits for whichever comes first: a command
 *     ends (its notice is delivered and the model answers it), a person's
 *     message arrives (root only: this hook returns nothing and the turn's
 *     input middleware, next in langchain's round-end chain, delivers it in
 *     its own order), or the turn's stop or yield (the commands' notices say
 *     they were stopped with the turn, and the model call that follows is
 *     refused by the turn boundary, so the resumed thread never ends on the
 *     agent's own answer). A sub-agent waits only on its commands and the
 *     stop; a person's message and a yield are the root's.
 *
 * Why round-end hooks run in this order: langchain 1.5.14 chains `afterModel`
 * from the last middleware registered to the first, and a hook that jumps
 * leaves the chain there. This middleware is in Stigmer's stack, registered
 * after the turn-input middleware (`turn-setup.ts`), so it runs first and
 * hands a person's message on by returning nothing.
 *
 * "This graph's commands" is read from the graph's own thread: the starts
 * its tool results record (`shell-tool.ts` `backgroundArtifactOf`). One
 * sub-agent spec serves several `task` calls at once, each with its own
 * thread, so the thread is the one identity that tells them apart. What the
 * thread was told is read from it too: a notice is a message whose id is
 * the command's ({@link noticeIdOf}), and a stop the agent asked for
 * records the ending on its own result. Nothing is kept in a state key of
 * its own: deepagents hands a sub-agent's state keys back to its parent
 * when the `task` returns, so two sub-agents at once would both write it.
 *
 * While it waits the turn is working, not stalled: it writes
 * {@link BACKGROUND_WAIT_EVENT} on the graph's custom stream at the start
 * and the end of the wait, which the native translator turns into the
 * `background_wait_started` and `background_wait_finished` facts, and the
 * runtime's open-operations fold holds the stall watchdog between them
 * (`harness/open-operations.ts`). The person learns of each ending from the
 * command's own status in the session's log, written when it ended
 * (`execute-deep-agent/background-facts.ts`), not from this middleware.
 *
 * Proven by `__tests__/background-commands.test.ts` and on a real graph by
 * `execute-deep-agent/__tests__/background-binding.test.ts`.
 */

import { HumanMessage, isAIMessage, isHumanMessage, isToolMessage, type BaseMessage } from "@langchain/core/messages";

import type { TurnInputChannel } from "../harness/turn-input.js";
import { backgroundArtifactOf, endingLine, STOP_BACKGROUND_TOOL_NAME, SHELL_TOOL_NAME } from "../activities/execute-deep-agent/shell-tool.js";
import { deliveredInputsOf } from "../activities/execute-deep-agent/turn-input-middleware.js";
import type { InputBarriers } from "../activities/execute-deep-agent/input-barrier.js";
import type { BackgroundCommand, BackgroundCommands, BackgroundOutputPaths, PriorStop } from "../shared/shell/background-commands.js";
import { endingOf, formatCommandOutput, omittedOutputLine } from "../shared/shell/run-command.js";
import { headCutIndex, tailCutIndex } from "../shared/text-cut.js";
import { customStreamWriterOf } from "./tool-scope.js";
import { haltsAtModelCall, type TurnBoundaryScope, type TurnBoundarySignals } from "./turn-boundary.js";
import type { BackgroundShellConfig, StigmerMiddleware } from "./types.js";

/** The custom-stream event a wait writes at its start and its end (`translator.ts` reads it). Wire-free. */
export const BACKGROUND_WAIT_EVENT = "stigmer.background_wait";

/** How often a wait asks for a person's message when no status write refreshed the hint. */
export const BACKGROUND_WAIT_CLAIM_MS = 10_000;

/** The tool-result budget a notice is cut to when the stack names none. */
const DEFAULT_NOTICE_CHARS = 30_000;

/** How much of a command's text a notice quotes. */
const NOTICE_COMMAND_CHARS = 200;

/** The id prefix of a notice message (the header: what the thread was told is read from it). */
const NOTICE_ID_PREFIX = "background-ended-";

export function noticeIdOf(commandId: string): string {
  return `${NOTICE_ID_PREFIX}${commandId}`;
}

export interface BackgroundCommandsMiddlewareConfig extends BackgroundShellConfig {
  readonly scope: TurnBoundaryScope;
  /** The turn's stop and yield; absent, nothing ends a wait but an ending (unit tests). */
  readonly signals?: TurnBoundarySignals;
  /** The person's messages: the root's alone. */
  readonly input?: { readonly channel: TurnInputChannel; readonly barriers?: InputBarriers };
  /** The run's tool-result budget, which a notice's output is cut to. */
  readonly maxNoticeChars?: number;
  readonly claimEveryMs?: number;
}

/** A start the thread records, with the command its call ran. */
interface ThreadStart {
  readonly id: string;
  readonly command: string;
}

/** What one graph's thread records of its background commands: its starts, and the ones it was told ended. */
export function backgroundThreadOf(messages: readonly BaseMessage[]): { readonly starts: ThreadStart[]; readonly told: ReadonlySet<string> } {
  const commandOf = new Map<string, string>();
  const starts: ThreadStart[] = [];
  const told = new Set<string>();
  for (const message of messages) {
    if (isAIMessage(message)) {
      for (const call of message.tool_calls ?? []) {
        if (call.id !== undefined && call.name === SHELL_TOOL_NAME && typeof call.args.command === "string") commandOf.set(call.id, call.args.command);
      }
    } else if (isToolMessage(message)) {
      const artifact = backgroundArtifactOf(message.artifact);
      if (artifact === undefined) continue;
      if ("id" in artifact) starts.push({ id: artifact.id, command: commandOf.get(artifact.id) ?? "" });
      else told.add(artifact.ended);
    } else if (isHumanMessage(message) && message.id?.startsWith(NOTICE_ID_PREFIX)) {
      told.add(message.id.slice(NOTICE_ID_PREFIX.length));
    }
  }
  return { starts, told };
}

/** A command's text as a notice quotes it: one line, at most {@link NOTICE_COMMAND_CHARS}. */
function quoted(command: string): string {
  const line = command.replace(/\s+/g, " ").trim();
  return line.length > NOTICE_COMMAND_CHARS ? `${line.slice(0, NOTICE_COMMAND_CHARS)}…` : line;
}

/** `text` cut to `budget` characters, keeping its start and its end (`shared/text-cut.ts`). */
function cut(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const half = Math.floor(budget / 2);
  const head = text.slice(0, headCutIndex(text, half));
  const tail = text.slice(tailCutIndex(text, half));
  return `${head}${head.endsWith("\n") ? "" : "\n"}${omittedOutputLine(text.length - head.length - tail.length)}\n${tail}`;
}

/** What a notice says of one ending. */
interface Ending {
  readonly attribute: string;
  readonly body: string;
}

function endingOfCommand(command: BackgroundCommand, maxChars: number): Ending {
  const result = command.result!;
  const ending = endingOf(result, command.timeoutSeconds);
  const output = cut(formatCommandOutput(result), maxChars);
  switch (ending.kind) {
    case "exited":
      return { attribute: `exit ${ending.exitCode}`, body: output };
    case "timed-out":
      return { attribute: "timed out", body: output };
    case "stopped":
      // A person's stop is told as theirs, so the agent does not start it again unasked.
      return command.stoppedBy?.by === "person"
        ? { attribute: "stopped by the person", body: `${output}\n${endingLine(ending, command.stoppedBy)}` }
        : { attribute: "stopped", body: `${output}\nStopped with the turn.` };
    case "spawn-failed":
      return { attribute: "failed to start", body: ending.message };
    /* v8 ignore start -- @preserve: the never arm; the compiler proves no ending reaches it */
    default: {
      const exhaustive: never = ending;
      throw new Error(`background commands: unknown ending ${JSON.stringify(exhaustive)}`);
    }
    /* v8 ignore stop */
  }
}

function priorEnding(prior: PriorStop): Ending {
  const when = prior === "approval" ? "when the turn paused for your approval" : "when the turn was interrupted";
  return { attribute: "stopped", body: `Stopped ${when}. Start it again if you still need it.` };
}

/** A command that will be stopped with the invocation that is ending now (a halt during a wait). */
function haltEnding(): Ending {
  return { attribute: "stopped", body: "Stopped with the turn. Start it again if you still need it." };
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** The middleware (module header). */
export function createBackgroundCommandsMiddleware(config: BackgroundCommandsMiddlewareConfig): StigmerMiddleware {
  const { commands, outputPaths, scope } = config;
  const maxChars = config.maxNoticeChars ?? DEFAULT_NOTICE_CHARS;
  const claimEveryMs = config.claimEveryMs ?? BACKGROUND_WAIT_CLAIM_MS;
  const halted = (): boolean => config.signals !== undefined && haltsAtModelCall(config.signals, scope);

  const notice = (start: ThreadStart, ending: Ending): HumanMessage => {
    const file = outputPaths === undefined ? "" : `\nIts whole output is in ${outputPaths.virtual(start.id)}.`;
    return new HumanMessage({
      id: noticeIdOf(start.id),
      content:
        `<background-command id="${escapeAttribute(start.id)}" command="${escapeAttribute(quoted(start.command))}" ended="${ending.attribute}">\n` +
        `${ending.body}${file}\n</background-command>`,
    });
  };

  /** The notices the thread is owed now: every start it was not told of that is not running. */
  const owedNotices = (messages: readonly BaseMessage[]): HumanMessage[] => {
    const { starts, told } = backgroundThreadOf(messages);
    const notices: HumanMessage[] = [];
    for (const start of starts) {
      if (told.has(start.id)) continue;
      const command = commands.get(start.id);
      if (command === undefined) notices.push(notice(start, priorEnding(commands.priorStop())));
      else if (command.result !== undefined) notices.push(notice(start, endingOfCommand(command, maxChars)));
    }
    return notices;
  };

  /** This graph's commands still running, by its thread's starts. */
  const runningOf = (messages: readonly BaseMessage[]): ThreadStart[] => {
    const { starts, told } = backgroundThreadOf(messages);
    return starts.filter((start) => {
      const command = commands.get(start.id);
      return !told.has(start.id) && command !== undefined && command.result === undefined;
    });
  };

  /** At a halt: what ended is told as it ended, what still runs as stopped with the turn (it is, before the invocation returns). */
  const haltNotices = (messages: readonly BaseMessage[]): HumanMessage[] => [
    ...owedNotices(messages),
    ...runningOf(messages).map((start) => notice(start, haltEnding())),
  ];

  /** Whether a person's message is waiting for the root, taken now so the turn-input middleware delivers it. */
  const personWaits = async (state: Record<string, unknown>, write: ((chunk: unknown) => void) | undefined): Promise<boolean> => {
    if (config.input === undefined) return false;
    await config.input.barriers?.cross(write);
    if ((await config.input.channel.claim({ force: true })).length > 0) return true;
    return (await config.input.channel.claimed(deliveredInputsOf(state))).length > 0;
  };

  /** Waits for an ending, a person's message, or the halt (module header). */
  const wait = (ids: readonly string[]): Promise<"ended" | "person" | "halted"> =>
    new Promise((resolve) => {
      const done = new AbortController();
      const cleanups: Array<() => void> = [];
      const finish = (why: "ended" | "person" | "halted"): void => {
        if (done.signal.aborted) return;
        done.abort();
        for (const cleanup of cleanups) cleanup();
        resolve(why);
      };
      void commands.whenAnyEnds(ids, done.signal).then(() => finish("ended"));
      if (config.signals !== undefined) {
        const onHalt = (): void => {
          if (halted()) finish("halted");
        };
        const haltSignals = scope === "root" ? [config.signals.stopSignal, config.signals.yieldSignal] : [config.signals.stopSignal];
        for (const signal of haltSignals) {
          signal.addEventListener("abort", onHalt, { once: true });
          cleanups.push(() => signal.removeEventListener("abort", onHalt));
        }
        onHalt();
      }
      const input = config.input;
      if (input !== undefined) {
        const ask = (): void => {
          input.channel.claim({ force: true }).then(
            (taken) => {
              if (taken.length > 0) finish("person");
            },
            () => undefined,
          );
        };
        cleanups.push(input.channel.onPending(ask));
        const timer = setInterval(ask, claimEveryMs);
        timer.unref?.();
        cleanups.push(() => clearInterval(timer));
      }
    });

  const reminder = (running: readonly ThreadStart[]): HumanMessage =>
    new HumanMessage({
      content:
        "<background-commands-running>\n" +
        `These commands you started in the background are still running: ${running.map((start) => `${start.id} (\`${quoted(start.command)}\`)`).join(", ")}. ` +
        "If you end your reply now, the turn waits until one ends and you are told how. " +
        `Stop the ones you no longer need with ${STOP_BACKGROUND_TOOL_NAME} first.\n` +
        "</background-commands-running>",
    });

  return {
    name: scope === "root" ? "StigmerBackgroundCommands" : "StigmerSubAgentBackgroundCommands",

    beforeModel(state) {
      const notices = owedNotices((state.messages ?? []) as BaseMessage[]);
      return notices.length > 0 ? { messages: notices } : undefined;
    },

    afterModel: {
      canJumpTo: ["model"],
      hook: async (state, runtime) => {
        const messages = (state.messages ?? []) as BaseMessage[];
        const last = messages.at(-1);
        if (last === undefined || !isAIMessage(last) || (last.tool_calls?.length ?? 0) > 0) return undefined;
        const write = customStreamWriterOf(runtime);
        const owed = owedNotices(messages);
        if (owed.length > 0) return { messages: owed, jumpTo: "model" };
        const running = runningOf(messages);
        if (running.length === 0) return undefined;
        if (halted()) return { messages: haltNotices(messages), jumpTo: "model" };
        if (await personWaits(state, write)) return undefined;
        if (commands.takeReminder()) return { messages: [reminder(running)], jumpTo: "model" };

        write?.({ name: BACKGROUND_WAIT_EVENT, phase: "started" });
        let woke: "ended" | "person" | "halted";
        try {
          woke = await wait(running.map((start) => start.id));
        } finally {
          write?.({ name: BACKGROUND_WAIT_EVENT, phase: "finished" });
        }
        if (woke === "person") return undefined;
        return { messages: woke === "halted" ? haltNotices(messages) : owedNotices(messages), jumpTo: "model" };
      },
    },
  };
}
