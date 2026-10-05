/**
 * Run one hook command — the evaluator's one impure seam.
 *
 * As Claude Code runs a command hook: exec form (`args` set) spawns the
 * command with its arguments and no shell; shell form runs the command in
 * `bash -c`. The call's JSON is written to stdin and stdin is closed; each
 * output stream is kept up to {@link OUTPUT_CAP_BYTES}. The working
 * directory is the workspace root and the environment is the caller's (the
 * agent shell's, plus the hook's own variables, `evaluate.ts`).
 *
 * The command gets its own process group, and the whole group is killed when
 * its timeout passes or the turn is stopped, so a hook that forks cannot
 * keep its call waiting. A child it leaves running after it exits by itself
 * is left alone (a hook may start a helper on purpose), and its answer is
 * the command's: the runner settles {@link EXIT_DRAIN_MS} after the command
 * exits even when a helper still holds the output pipes. A timed-out or failed command answers no decision; what it
 * printed is kept for the log.
 *
 * While the command lives, `onPulse` is called every `pulseMs` (at most
 * {@link ACTIVITY_PULSE_MS}): a PreToolUse hook runs before its tool
 * starts, so nothing else reports activity, and the turn's stall watchdog
 * would stop a turn whose hook legitimately runs for minutes (Claude's
 * default timeout is ten). The hook's own timeout bounds the wait instead.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

/** Claude Code's default command-hook timeout. */
export const DEFAULT_HOOK_TIMEOUT_SECONDS = 600;

/** The most of each output stream kept; the rest is dropped. */
export const OUTPUT_CAP_BYTES = 1024 * 1024;

/**
 * How long the runner keeps reading a command's output after the command
 * exits. A helper it started in the background may hold the pipes open for
 * as long as it lives; the command's own answer is written by then.
 */
export const EXIT_DRAIN_MS = 250;

/** How often, at most, a running hook reports that the turn is alive. */
export const ACTIVITY_PULSE_MS = 30_000;

/**
 * The pulse for a turn whose stall watchdog fires after `stallTimeoutMs`:
 * a third of it, so a lowered timeout still sees every running hook alive,
 * and never more than {@link ACTIVITY_PULSE_MS}.
 */
export function activityPulseFor(stallTimeoutMs: number): number {
  return Math.max(1, Math.min(ACTIVITY_PULSE_MS, Math.floor(stallTimeoutMs / 3)));
}

/** The longest delay a timer keeps; a longer one fires at once. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * A handler's timeout as a timer delay. The contract bounds it only from
 * below, and a delay past the timer's limit would fire at once and kill
 * every run, so a longer one waits as long as a timer can (about 24 days);
 * the turn's stop still ends it.
 */
export function hookTimeoutMs(timeoutSeconds: number): number {
  return Math.min(timeoutSeconds * 1000, MAX_TIMER_MS);
}

/** The shell a shell-form handler runs in. */
export const HOOK_SHELL = "bash";

/** One command to run. */
export interface HookProcessSpec {
  readonly command: string;
  /** Exec form's arguments; `null` runs `command` in {@link HOOK_SHELL}. */
  readonly args: readonly string[] | null;
  readonly timeoutSeconds: number;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly stdin: string;
}

/** What a run produced. */
export interface HookRunResult {
  /** The exit code; `null` when the command did not exit by itself (killed, or never started). */
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  /** Set when the command could not be started. */
  readonly spawnError?: string;
}

export interface HookRunOptions {
  /** The turn's stop: aborting it kills the command. */
  readonly signal?: AbortSignal;
  /** Called every `pulseMs` while the command lives. */
  readonly onPulse?: () => void;
  /** How often `onPulse` is called; {@link ACTIVITY_PULSE_MS} when absent. */
  readonly pulseMs?: number;
}

/** The function the evaluator runs commands through; a test substitutes its own. */
export type HookProcessRunner = (spec: HookProcessSpec, options: HookRunOptions) => Promise<HookRunResult>;

export const runHookProcess: HookProcessRunner = (spec, options) =>
  new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spec.args === null
        ? spawn(HOOK_SHELL, ["-c", spec.command], { cwd: spec.cwd, env: spec.env, detached: true, stdio: "pipe" })
        : spawn(spec.command, [...spec.args], { cwd: spec.cwd, env: spec.env, detached: true, stdio: "pipe" });
    } catch (err) {
      // A command Node refuses outright (a NUL byte in it) never starts.
      resolve({ exitCode: null, stdout: "", stderr: "", timedOut: false, spawnError: err instanceof Error ? err.message : String(err) });
      return;
    }

    const stdout = new CappedText();
    const stderr = new CappedText();
    let timedOut = false;
    let settled = false;

    const killGroup = (): void => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, hookTimeoutMs(spec.timeoutSeconds));
    const pulse = options.onPulse ? setInterval(options.onPulse, options.pulseMs ?? ACTIVITY_PULSE_MS) : undefined;
    const onAbort = (): void => killGroup();
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (result: HookRunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pulse) clearInterval(pulse);
      options.signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };

    child.stdout.on("data", (chunk: Buffer) => stdout.add(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.add(chunk));
    child.on("error", (err) => {
      finish({ exitCode: null, stdout: stdout.text(), stderr: stderr.text(), timedOut, spawnError: err.message });
    });
    let exitCode: number | null = null;
    let drain: NodeJS.Timeout | undefined;
    const settle = (): void => {
      if (drain) clearTimeout(drain);
      finish({ exitCode: timedOut ? null : exitCode, stdout: stdout.text(), stderr: stderr.text(), timedOut });
    };
    child.on("exit", (code) => {
      exitCode = code;
      // A background helper may keep the pipes open; stop reading soon after.
      drain = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        settle();
      }, EXIT_DRAIN_MS);
    });
    child.on("close", settle);

    // A command that never reads its input closes the pipe first; that is not a failure.
    child.stdin.on("error", () => undefined);
    child.stdin.end(spec.stdin);
    if (options.signal?.aborted) killGroup();
  });

/** A stream's text, kept up to {@link OUTPUT_CAP_BYTES}. */
class CappedText {
  private readonly chunks: Buffer[] = [];
  private size = 0;

  add(chunk: Buffer): void {
    const room = OUTPUT_CAP_BYTES - this.size;
    if (room <= 0) return;
    const kept = chunk.length > room ? chunk.subarray(0, room) : chunk;
    this.chunks.push(kept);
    this.size += kept.length;
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf-8");
  }
}
