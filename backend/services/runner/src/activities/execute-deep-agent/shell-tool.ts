/**
 * The Stigmer harness's `execute` tool: a shell command run by the runner's
 * command runner (`shared/shell/run-command.ts`) through the graph's own
 * backend, whose output streams into the turn while it runs, whose timeout
 * the model can raise for a slow build, and which stops with the turn.
 *
 * Why a tool of our own under deepagents' name: deepagents' `execute` takes
 * `{ command }` alone and calls `backend.execute(command)` with no signal and
 * no callback, so its output cannot stream, its bound is fixed and the turn's
 * stop never reaches it. The name stays `execute`, because the SDKs, the
 * console, hooks, tool-kind and the CLI all read it; the `shell` middleware
 * (`middleware/shell.ts`) shows the model this tool's schema and hands each
 * `execute` call this implementation, so deepagents' own tool stays
 * registered but never runs.
 *
 * Streaming: the tool is an async generator. LangChain sends each yielded
 * chunk to the graph's stream as a `tool-output-delta`, which the Stigmer
 * translator maps to `tool_output_delta`, which the runtime's preview pump
 * sends to the session. Chunks are coalesced to the streaming floor
 * (`shared/streaming-scheduler.ts`, 500 ms by default), so a chatty build
 * yields at most two chunks a second.
 *
 * The arguments are `command` and `timeout`, in seconds (deepagents' own
 * unit). The default is deepagents'
 * 120 s; a larger request is honoured up to `Config.shellTimeoutMaxSeconds`
 * and clamped above it, and the result says so. Neither `timeout` nor
 * `background` changes what the approval gate asks: it asks by the tool's
 * category, and a person's lease or answer covers the call whatever its
 * arguments (`middleware/approval-gate.ts`).
 *
 * `background: true` starts the command and returns at once, with its id
 * (the call's own tool call id) and the file its output goes to, in the
 * session's offload directory under `/large_tool_results/`, which
 * `read_file` reads. The command runs in this invocation's registry
 * (`shared/shell/background-commands.ts`), with no timeout of its own but
 * the runner's ceiling unless the model asks for less. The agent is told
 * when it ends (`middleware/background-commands.ts`) and can stop it with
 * {@link STOP_BACKGROUND_TOOL_NAME}. The person sees it too: the registry
 * reports its start, its output and its end to the turn's transcript
 * (`background-facts.ts`), which the session's log carries as
 * `stigmer.background_command.status` events beside the start's tool use,
 * its output previewed under the same id; and a person can stop it alone
 * (`SessionCommandController.stopBackgroundCommand`, reaching the adapter
 * through `TurnSink.backgroundStops`), which the agent is told. The start's result carries
 * `artifact.background.id`, so the thread itself records the start; the
 * stop's carries `artifact.background.ended`. The middleware reads both
 * back from the thread ({@link backgroundArtifactOf}).
 *
 * The result keeps the shape deepagents' tool wrote: the output, then
 * `[Command succeeded|failed with exit code N]`, then the truncation note.
 * A command stopped at its timeout keeps what it printed and says it was
 * stopped. Pinned by `__tests__/shell-tool.test.ts`, and on a real graph by
 * `__tests__/shell-binding.test.ts` and `__tests__/background-binding.test.ts`.
 */

import { ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { DEFAULT_SHELL_TIMEOUT_SECONDS, type ShellRunOptions } from "./cas-capture-backend.js";
import { endingOf, formatCommandOutput, type CommandEnding, type CommandResult } from "../../shared/shell/run-command.js";
import {
  MAX_RUNNING_BACKGROUND_COMMANDS,
  type BackgroundCommand,
  type BackgroundStoppedBy,
  type BackgroundCommands,
  type BackgroundOutputPaths,
} from "../../shared/shell/background-commands.js";
import type { ShellMiddlewareConfig } from "../../middleware/types.js";

/** The tool's name: deepagents' own, which every reader of a shell row reads. */
export const SHELL_TOOL_NAME = "execute";

/** What the model is told about `timeout`, beside deepagents' description of the tool. */
export const SHELL_TIMEOUT_ARG_PROMPT =
  `How long the command may run, in seconds (default ${DEFAULT_SHELL_TIMEOUT_SECONDS}). ` +
  "Raise it for a build, a full test suite or an install that takes minutes; " +
  "a command still running at its timeout is stopped and returns what it printed.";

/** The tool that stops a background command: bound only beside `execute` (`middleware/shell.ts`). */
export const STOP_BACKGROUND_TOOL_NAME = "stop_background_command";

/** What the model is told about `background`, beside deepagents' description of the tool. */
export const SHELL_BACKGROUND_ARG_PROMPT =
  "Run the command in the background: the call returns at once with the command's id and the file its output goes to, " +
  "and you are told when it ends, how it ended and the last of its output, so do not poll it or sleep waiting for it. " +
  "Use it for a slow build or test suite while you keep working, or for a dev server you then call. " +
  "Its timeout defaults to this runner's limit. If you end your reply while one still runs, the turn waits for it, " +
  `so first stop the ones you no longer need with ${STOP_BACKGROUND_TOOL_NAME}. ` +
  "A pause for the person's approval stops every background command, and you are told.";

/** The backend door the tool runs through (`CasCaptureShellBackend.runShell`). */
export interface ShellRunner {
  runShell(command: string, options: ShellRunOptions): Promise<CommandResult>;
}

export interface ShellToolOptions {
  readonly backend: ShellRunner;
  /** The highest `timeout` honoured (`Config.shellTimeoutMaxSeconds`). */
  readonly maxTimeoutSeconds: number;
  /** The least time between two streamed chunks (the streaming floor). */
  readonly floorMs: number;
  /** This invocation's background commands; absent, `background` runs the command in the foreground (unit tests). */
  readonly background?: BackgroundShellOptions;
}

export interface BackgroundShellOptions {
  readonly commands: BackgroundCommands;
  /** Where output files go; undefined when the session has no scratch directory (`platform-route.ts`). */
  readonly outputPaths: BackgroundOutputPaths | undefined;
}

const shellArgs = z.object({
  command: z.string().describe("The shell command to execute"),
  timeout: z.number().positive().nullish().describe(SHELL_TIMEOUT_ARG_PROMPT),
  background: z.boolean().nullish().describe(SHELL_BACKGROUND_ARG_PROMPT),
});

/** What a start or a stop records on its `ToolMessage` (the header). */
export type BackgroundArtifact = { readonly id: string } | { readonly ended: string };

/** The background fact a tool result records, if any. */
export function backgroundArtifactOf(artifact: unknown): BackgroundArtifact | undefined {
  if (artifact === null || typeof artifact !== "object") return undefined;
  const background = (artifact as { readonly background?: unknown }).background;
  if (background === null || typeof background !== "object") return undefined;
  const { id, ended } = background as { readonly id?: unknown; readonly ended?: unknown };
  if (typeof id === "string") return { id };
  if (typeof ended === "string") return { ended };
  return undefined;
}

/** The tool config fields this module reads: the call's abort signal and its own tool call. */
interface ToolRunConfig {
  readonly signal?: AbortSignal;
  readonly toolCall?: { readonly id?: string };
}

/** Resolves after `ms`, or when `done` settles, whichever is first. */
function pause(ms: number, done: Promise<unknown>): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    void done.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * The bracketed line that says how a command ended, in deepagents' words;
 * a stop the agent or a person asked for says so, since "with the turn"
 * would be untrue.
 */
export function endingLine(ending: CommandEnding, stoppedBy?: BackgroundStoppedBy): string {
  switch (ending.kind) {
    case "exited":
      return `[Command ${ending.exitCode === 0 ? "succeeded" : "failed"} with exit code ${ending.exitCode}]`;
    case "timed-out":
      return `[Command timed out after ${ending.timeoutSeconds} seconds; its processes were stopped]`;
    case "stopped":
      if (stoppedBy?.by === "agent") return "[Stopped at your request; its processes were stopped]";
      if (stoppedBy?.by === "person") return "[Stopped by the person; its processes were stopped]";
      return "[Command stopped with the turn; its processes were stopped]";
    case "spawn-failed":
      return `[Command failed to start: ${ending.message}]`;
    /* v8 ignore start -- @preserve: the never arm; the compiler proves no ending reaches it */
    default: {
      const exhaustive: never = ending;
      throw new Error(`shell tool: unknown command ending ${JSON.stringify(exhaustive)}`);
    }
    /* v8 ignore stop */
  }
}

/** The tool's result in deepagents' words, with the clamp and the stop said. */
export function shellResult(result: CommandResult, timeoutSeconds: number, clampedFrom: number | undefined): string {
  const ending = endingOf(result, timeoutSeconds);
  if (ending.kind === "spawn-failed") return `Error executing command: ${ending.message}\n[Command failed with exit code 1]`;
  const parts = [formatCommandOutput(result), `\n${endingLine(ending)}`];
  if (result.truncated) parts.push("\n[Output was truncated due to size limits]");
  parts.push(clampNote(timeoutSeconds, clampedFrom));
  return parts.join("");
}

/** The clamp's note, when the timeout asked for was above the ceiling; empty otherwise. */
function clampNote(timeoutSeconds: number, clampedFrom: number | undefined): string {
  return clampedFrom === undefined ? "" : `\n[The timeout asked for, ${clampedFrom} seconds, is above this runner's limit; the command ran with ${timeoutSeconds}]`;
}

/** Start `command` in the background and answer at once (the header). */
function startInBackground(
  options: ShellToolOptions & { readonly background: BackgroundShellOptions },
  command: string,
  asked: number | null | undefined,
  id: string | undefined,
): string | ToolMessage {
  if (id === undefined) return "Error: a command can run in the background only as a tool call.";
  const requested = asked ?? options.maxTimeoutSeconds;
  const timeoutSeconds = Math.min(requested, options.maxTimeoutSeconds);
  const clampedFrom = requested > options.maxTimeoutSeconds ? requested : undefined;
  const { commands, outputPaths } = options.background;
  const answer = commands.start({
    id,
    command,
    timeoutSeconds,
    outputPath: outputPaths?.real(id),
    run: (run) => options.backend.runShell(command, { timeoutSeconds, ...run }),
  });
  switch (answer.kind) {
    case "full":
      return (
        `Not started: ${MAX_RUNNING_BACKGROUND_COMMANDS} commands already run in the background (${answer.running.join(", ")}). ` +
        `Stop one with ${STOP_BACKGROUND_TOOL_NAME}, or wait for one to end.`
      );
    case "closed":
      return "Not started: the turn is ending.";
    case "started": {
      const where = outputPaths === undefined
        ? "This session keeps no output file; you will be told the last of its output when it ends."
        : `Output is going to ${outputPaths.virtual(id)}; you will be told when it ends.`;
      return new ToolMessage({
        content: `Started in the background (id ${id}). ${where} Do not poll it.${clampNote(timeoutSeconds, clampedFrom)}`,
        tool_call_id: id,
        name: SHELL_TOOL_NAME,
        status: "success",
        artifact: { background: { id } },
      });
    }
    /* v8 ignore start -- @preserve: the never arm; the compiler proves no answer reaches it */
    default: {
      const exhaustive: never = answer;
      throw new Error(`shell tool: unknown start answer ${JSON.stringify(exhaustive)}`);
    }
    /* v8 ignore stop */
  }
}

/** The executable `execute` tool over one graph's backend. */
export function createShellTool(options: ShellToolOptions) {
  return tool(
    async function* (input: z.infer<typeof shellArgs>, config?: ToolRunConfig): AsyncGenerator<string, string | ToolMessage> {
      if (input.background === true && options.background !== undefined) {
        return startInBackground({ ...options, background: options.background }, input.command, input.timeout, config?.toolCall?.id);
      }
      const asked = input.timeout ?? DEFAULT_SHELL_TIMEOUT_SECONDS;
      const timeoutSeconds = Math.min(asked, options.maxTimeoutSeconds);
      const clampedFrom = asked > options.maxTimeoutSeconds ? asked : undefined;

      let pending = "";
      let wake: (() => void) | undefined;
      let finished: CommandResult | undefined;
      const done = options.backend
        .runShell(input.command, {
          timeoutSeconds,
          ...(config?.signal ? { signal: config.signal } : {}),
          onOutput: (chunk) => {
            pending += chunk;
            wake?.();
          },
        })
        .then((result) => {
          finished = result;
          wake?.();
          return result;
        });

      for (;;) {
        if (pending === "" && finished === undefined) {
          await new Promise<void>((resolve) => (wake = resolve));
          wake = undefined;
        }
        if (pending !== "") {
          const chunk = pending;
          pending = "";
          yield chunk;
          if (finished === undefined) await pause(options.floorMs, done);
          continue;
        }
        if (finished !== undefined) break;
      }
      return shellResult(await done, timeoutSeconds, clampedFrom);
    },
    {
      name: SHELL_TOOL_NAME,
      description: "Execute a shell command in the workspace.",
      schema: shellArgs,
    },
  );
}

const stopArgs = z.object({
  id: z.string().describe("The id the command's background start returned."),
});

/** The stop tool's answer for a command it found: what it printed, then how it ended. */
function stoppedResult(command: BackgroundCommand, result: CommandResult, id: string): ToolMessage {
  const ending = endingOf(result, command.timeoutSeconds);
  const mine = command.stoppedBy?.by === "agent" && command.stoppedBy.callId === id;
  const already = mine ? "" : "It had already ended.\n";
  return new ToolMessage({
    content: `${already}${formatCommandOutput(result)}\n${endingLine(ending, command.stoppedBy)}`,
    tool_call_id: id,
    name: STOP_BACKGROUND_TOOL_NAME,
    status: "success",
    artifact: { background: { ended: command.id } },
  });
}

/** The tool that stops one of this invocation's background commands by its id. */
export function createStopBackgroundCommandTool(commands: BackgroundCommands) {
  return tool(
    async (input: z.infer<typeof stopArgs>, config?: ToolRunConfig): Promise<string | ToolMessage> => {
      const command = await commands.stop(input.id, { agent: config?.toolCall?.id ?? "" });
      if (command?.result === undefined) {
        const running = commands.running().map((c) => c.id);
        return `No command started in the background in this turn has id ${input.id}. ${running.length === 0 ? "None is running." : `Running: ${running.join(", ")}.`}`;
      }
      return stoppedResult(command, command.result, config?.toolCall?.id ?? "");
    },
    {
      name: STOP_BACKGROUND_TOOL_NAME,
      description:
        "Stop a command you started with execute in the background, by the id its start returned, " +
        "and get what it printed. Stop the ones you no longer need before you end your reply: the turn waits for those still running.",
      schema: stopArgs,
    },
  );
}

/** One graph's shell, as its `shell` middleware binds it: `execute`, and beside it the stop tool when commands can run in the background. */
export function createShellBinding(options: ShellToolOptions): ShellMiddlewareConfig {
  const shellTool = createShellTool(options);
  if (options.background === undefined) return { tool: shellTool };
  return {
    tool: shellTool,
    background: { ...options.background, stopTool: createStopBackgroundCommandTool(options.background.commands) },
  };
}
