/**
 * The native harness's `execute` tool: a shell command run by the runner's
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
 * chunk to the graph's stream as a `tool-output-delta`, which the native
 * translator maps to `tool_output_delta`, which the runtime's preview pump
 * sends to the session. Chunks are coalesced to the streaming floor
 * (`shared/streaming-scheduler.ts`, 500 ms by default), so a chatty build
 * yields at most two chunks a second.
 *
 * The arguments are named as Cursor's shell names them: `command`, and
 * `timeout` in seconds (deepagents' own unit). The default is deepagents'
 * 120 s; a larger request is honoured up to `Config.shellTimeoutMaxSeconds`
 * and clamped above it, and the result says so. `timeout` is not part of the
 * approval fingerprint, which keys a shell call on its command alone
 * (`shared/approval-fingerprint.ts`), so raising it changes no approval.
 *
 * The result keeps the shape deepagents' tool wrote: the output, then
 * `[Command succeeded|failed with exit code N]`, then the truncation note.
 * A command stopped at its timeout keeps what it printed and says it was
 * stopped. Pinned by `__tests__/shell-tool.test.ts`, and on a real graph by
 * `__tests__/shell-binding.test.ts`.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { DEFAULT_SHELL_TIMEOUT_SECONDS, type ShellRunOptions } from "./cas-capture-backend.js";
import { endingOf, formatCommandOutput, type CommandResult } from "../../shared/shell/run-command.js";

/** The tool's name: deepagents' own, which every reader of a shell row reads. */
export const SHELL_TOOL_NAME = "execute";

/** What the model is told about `timeout`, beside deepagents' description of the tool. */
export const SHELL_TIMEOUT_ARG_PROMPT =
  `How long the command may run, in seconds (default ${DEFAULT_SHELL_TIMEOUT_SECONDS}). ` +
  "Raise it for a build, a full test suite or an install that takes minutes; " +
  "a command still running at its timeout is stopped and returns what it printed.";

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
}

const shellArgs = z.object({
  command: z.string().describe("The shell command to execute"),
  timeout: z.number().positive().nullish().describe(SHELL_TIMEOUT_ARG_PROMPT),
});

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

/** The tool's result in deepagents' words, with the clamp and the stop said. */
export function shellResult(result: CommandResult, timeoutSeconds: number, clampedFrom: number | undefined): string {
  const ending = endingOf(result, timeoutSeconds);
  const parts = [formatCommandOutput(result)];
  switch (ending.kind) {
    case "exited":
      parts.push(`\n[Command ${ending.exitCode === 0 ? "succeeded" : "failed"} with exit code ${ending.exitCode}]`);
      break;
    case "timed-out":
      parts.push(`\n[Command timed out after ${ending.timeoutSeconds} seconds; its processes were stopped]`);
      break;
    case "stopped":
      parts.push("\n[Command stopped with the turn; its processes were stopped]");
      break;
    case "spawn-failed":
      return `Error executing command: ${ending.message}\n[Command failed with exit code 1]`;
    /* v8 ignore start -- @preserve: the never arm; the compiler proves no ending reaches it */
    default: {
      const exhaustive: never = ending;
      throw new Error(`shell tool: unknown command ending ${JSON.stringify(exhaustive)}`);
    }
    /* v8 ignore stop */
  }
  if (result.truncated) parts.push("\n[Output was truncated due to size limits]");
  if (clampedFrom !== undefined) {
    parts.push(`\n[The timeout asked for, ${clampedFrom} seconds, is above this runner's limit; the command ran with ${timeoutSeconds}]`);
  }
  return parts.join("");
}

/** The executable `execute` tool over one graph's backend. */
export function createShellTool(options: ShellToolOptions) {
  return tool(
    async function* (input: z.infer<typeof shellArgs>, config?: { readonly signal?: AbortSignal }): AsyncGenerator<string, string> {
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
