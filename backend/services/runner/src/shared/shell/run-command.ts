/**
 * How the native harness runs one shell command: the one place that spawns
 * it, bounds it, streams what it prints and stops it. Both doors to the
 * shell use it: the agent's `execute` tool (`execute-deep-agent/shell-tool.ts`)
 * and the backend's own `execute` (`execute-deep-agent/cas-capture-backend.ts`),
 * so no path keeps deepagents' process handling.
 *
 * What deepagents' `LocalShellBackend.execute` (1.14.1) did, and why each
 * is replaced:
 *  - It buffered both pipes until `close`, so nothing streamed. Here every
 *    chunk reaches `onOutput` as it arrives.
 *  - On its timeout it sent SIGTERM to the shell alone and returned only
 *    "Command timed out", discarding the output. Here the command runs in its
 *    own process group, a timeout or an abort stops the whole group (SIGTERM,
 *    then SIGKILL after a grace), and the output collected so far is kept.
 *  - It resolved on `close`, which waits for every holder of the pipes, so a
 *    backgrounded or orphaned child that kept them open held the call open
 *    for ever (stigmer#2432). Here the call ends at the shell's `exit`: the
 *    pipes are drained for a short grace, then destroyed. A background child
 *    is not killed when its shell exits normally; it loses its output pipe.
 *  - It took no signal, so the turn's stop never reached a running command.
 *    Here an abort stops the group at once.
 *  - stdin is closed (`ignore`): a command that reads input sees end of file
 *    rather than waiting for input nobody will send.
 *
 * Output is capped per stream at `maxOutputBytes` characters, deepagents'
 * own cap (100,000), so a chatty build cannot grow without bound. A stream
 * over the cap keeps its first half and its last half, cut at line ends
 * (`shared/text-cut.ts`), with `… [N characters omitted] …` between them:
 * the end of a long command is where its verdict is (the failing tests, the
 * last error), and deepagents kept only the start. The formatted result
 * keeps deepagents' shape and notes byte for byte
 * ({@link formatCommandOutput}), so prompts and goldens read as before.
 *
 * No LangChain here: the tool and the backend own their framework's shapes.
 * Pinned by `__tests__/run-command.test.ts` against real processes.
 */

import { spawn } from "node:child_process";
import { headCutIndex, tailCutIndex } from "../text-cut.js";

/** deepagents' `LocalShellBackend` cap on a command's output, in characters. */
export const DEFAULT_MAX_OUTPUT_BYTES = 100_000;

/** How long the pipes are drained after the shell exits, for output still in flight. */
const DRAIN_GRACE_MS = 100;

/** How long a stopped group has after SIGTERM before it is killed. */
const KILL_GRACE_MS = 2_000;

export interface RunCommandOptions {
  readonly command: string;
  readonly cwd: string;
  /** The command's whole environment; nothing is inherited from the runner. */
  readonly env: Record<string, string>;
  readonly timeoutSeconds: number;
  /** Stops the command's group when it aborts (the turn's stop). */
  readonly signal?: AbortSignal;
  /** Told every chunk as it arrives, in arrival order. */
  readonly onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
  readonly maxOutputBytes?: number;
}

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  /** The shell's exit code; `null` when it was ended by a signal or never started. */
  readonly exitCode: number | null;
  /** Hit its timeout; its group was stopped. */
  readonly timedOut: boolean;
  /** Stopped by the caller's signal. */
  readonly aborted: boolean;
  /** Some output went past the cap and was dropped. */
  readonly truncated: boolean;
  /** The spawn itself failed (no shell, a bad cwd). */
  readonly spawnError?: string;
}

/** The line standing in for what a capped stream left out. */
export function omittedOutputLine(chars: number): string {
  return `… [${chars} characters omitted] …`;
}

/**
 * Collects one stream up to the cap: its first half as it arrives, and a
 * window over its last half (the module header).
 */
class Capped {
  private head = "";
  private tail = "";
  private total = 0;
  private readonly headMax: number;
  private readonly tailMax: number;
  constructor(max: number) {
    this.headMax = Math.ceil(max / 2);
    this.tailMax = max - this.headMax;
  }
  add(chunk: string): void {
    this.total += chunk.length;
    const room = this.headMax - this.head.length;
    if (room > 0) {
      this.head += chunk.slice(0, room);
      chunk = chunk.slice(room);
    }
    if (chunk.length === 0) return;
    // One character more than the tail keeps: the one before it says whether the tail starts a line.
    this.tail += chunk;
    if (this.tail.length > this.tailMax + 1) this.tail = this.tail.slice(this.tail.length - this.tailMax - 1);
  }
  get truncated(): boolean {
    return this.total > this.headMax + this.tailMax;
  }
  get value(): string {
    if (!this.truncated) return this.head + this.tail;
    const head = this.head.slice(0, headCutIndex(this.head, this.headMax));
    const tail = this.tail.slice(tailCutIndex(this.tail, this.tailMax));
    const joint = head.endsWith("\n") || head.length === 0 ? "" : "\n";
    return `${head}${joint}${omittedOutputLine(this.total - head.length - tail.length)}\n${tail}`;
  }
}

/** Run `command` in a shell, in its own process group (the module header). Never rejects. */
export function runCommand(options: RunCommandOptions): Promise<CommandResult> {
  const max = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const stdout = new Capped(max);
  const stderr = new Capped(max);
  let timedOut = false;
  let aborted = false;

  return new Promise<CommandResult>((resolve) => {
    if (options.signal?.aborted) {
      resolve({ stdout: "", stderr: "", exitCode: null, timedOut: false, aborted: true, truncated: false });
      return;
    }

    const child = spawn(options.command, {
      shell: true,
      detached: true,
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let drainTimer: ReturnType<typeof setTimeout> | undefined;

    const signalGroup = (signal: NodeJS.Signals): void => {
      /* v8 ignore next -- @preserve: a child with no pid failed to spawn, and its error settles the call before any stop */
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        // The group is already gone.
      }
    };

    const stopGroup = (): void => {
      signalGroup("SIGTERM");
      killTimer ??= setTimeout(() => signalGroup("SIGKILL"), KILL_GRACE_MS);
      killTimer.unref?.();
    };

    const finish = (exitCode: number | null, spawnError?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (drainTimer !== undefined) clearTimeout(drainTimer);
      // A stopped group keeps its kill timer: SIGKILL follows SIGTERM if it lingers.
      options.signal?.removeEventListener("abort", onAbort);
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve({
        stdout: stdout.value,
        stderr: stderr.value,
        exitCode,
        timedOut,
        aborted,
        truncated: stdout.truncated || stderr.truncated,
        ...(spawnError !== undefined ? { spawnError } : {}),
      });
    };

    // Removed at settle, so it only ever fires on a running command.
    const onAbort = (): void => {
      aborted = true;
      stopGroup();
    };

    // Cleared at settle, so it only ever fires on a running command.
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      stopGroup();
    }, Math.max(0, options.timeoutSeconds) * 1000);
    timeoutTimer.unref?.();

    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout.add(chunk);
      options.onOutput?.(chunk, "stdout");
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr.add(chunk);
      options.onOutput?.(chunk, "stderr");
    });

    child.on("error", (err) => finish(null, err.message));
    // Every pipe closed: nothing more can arrive.
    child.on("close", (code) => finish(code));
    // The shell is gone; a child it left behind may still hold the pipes.
    child.on("exit", (code) => {
      drainTimer = setTimeout(() => finish(code), DRAIN_GRACE_MS);
      drainTimer.unref?.();
    });
  });
}

/** How a command ended, as both doors word it. */
export type CommandEnding =
  | { readonly kind: "exited"; readonly exitCode: number }
  | { readonly kind: "timed-out"; readonly timeoutSeconds: number }
  | { readonly kind: "stopped" }
  | { readonly kind: "spawn-failed"; readonly message: string };

export function endingOf(result: CommandResult, timeoutSeconds: number): CommandEnding {
  if (result.spawnError !== undefined) return { kind: "spawn-failed", message: result.spawnError };
  if (result.timedOut) return { kind: "timed-out", timeoutSeconds };
  if (result.aborted) return { kind: "stopped" };
  return { kind: "exited", exitCode: result.exitCode ?? 1 };
}

/**
 * The output as deepagents' `LocalShellBackend.execute` wrote it: stdout,
 * then each stderr line prefixed `[stderr] `, `<no output>` when there is
 * none, the truncation note, and `Exit code: N` after a failed exit. What
 * a timeout or a stop adds is each door's own line.
 */
export function formatCommandOutput(result: CommandResult, maxOutputBytes: number = DEFAULT_MAX_OUTPUT_BYTES): string {
  const parts: string[] = [];
  if (result.stdout) parts.push(result.stdout);
  if (result.stderr) parts.push(...result.stderr.trim().split("\n").map((line) => `[stderr] ${line}`));
  let output = parts.length > 0 ? parts.join("\n") : "<no output>";
  if (result.truncated) output += `\n\n... Output truncated at ${maxOutputBytes} bytes.`;
  const exitCode = result.exitCode ?? 1;
  if (!result.timedOut && !result.aborted && exitCode !== 0) output = `${output.trimEnd()}\n\nExit code: ${exitCode}`;
  return output;
}
