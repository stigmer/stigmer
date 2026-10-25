/**
 * The commands the native agent started in the background during one
 * invocation of its turn: started, written to a file, stopped, and waited
 * for, here and nowhere else.
 *
 * One registry per invocation. The adapter creates it for each `runTurn`
 * and stops every command in it before that invocation returns, whatever
 * the outcome (`execute-deep-agent/adapter.ts`, `turn.ts`), and when the
 * turn's stop or yield fires. That is the whole lifetime rule, and it reads
 * no cause and no outcome, as the adapter contract forbids
 * (`harness/stop-controller.ts`). It is why the rule holds:
 *  - File review captures the working tree once, right after the adapter
 *    returns (`harness/capture.ts`). A command still writing after that, or
 *    during a pause for the person's approval, would write outside every
 *    capture and change the tree while the person decides. So an
 *    invocation that ends awaiting approval stops its commands too, and the
 *    resumed invocation tells the agent (`middleware/background-commands.ts`).
 *  - A hosted sandbox sleeps a few minutes after its turn, and sleep stops
 *    the runner; a command left running past the turn would die unseen and
 *    unmetered. Nothing outlives its invocation, so nothing is unseen.
 * Nothing is keyed by session or run, and no map outlives an invocation.
 *
 * A command's id is the tool call id of the `execute` that started it: the
 * framework's own identity, unique in the session, already the key of the
 * start's row in the session's log, with no counter to keep.
 *
 * Who stopped a command is kept beside its result, because the ending
 * alone cannot say it: the agent (its stop tool, by that call's id), a
 * person (`stop(id, "person")`, the session's stop of one command), or the
 * invocation's end, which the adapter names `approval` when it ends
 * awaiting a person's answer and `turn` otherwise. The adapter reads its
 * own outcome for that, never why its stop signal fired.
 *
 * What the session sees of each command comes from here too: the
 * {@link BackgroundListeners} the registry is built with hear each start,
 * each chunk of output and each end, the end before the command's group is
 * stopped and before `stop` or `stopAll` resolves, so an invocation that
 * returns has already reported every ending.
 *
 * What the registry bounds:
 *  - At most {@link MAX_RUNNING_BACKGROUND_COMMANDS} run at once; a further
 *    start is refused with the running ids, so the agent stops one first.
 *  - Its output file keeps the first {@link MAX_BACKGROUND_OUTPUT_BYTES} of
 *    what it printed, then one line says how much was dropped. The command
 *    runner's own head and tail (`run-command.ts`) still hold the end, which
 *    is what the agent is told when the command ends.
 *  - Stopping is awaited until every process in the command's group has
 *    gone (`stopProcessGroup`), so a write made by a stopped command lands
 *    before the capture that follows. Groups of commands that already ended
 *    are stopped too: a child the command left behind (`cmd &` inside it)
 *    does not outlive the invocation either.
 *
 * No LangChain here, like `run-command.ts`: the tool and the middleware own
 * their framework's shapes. Pinned by `__tests__/background-commands.test.ts`
 * against real processes.
 */

import { open, type FileHandle } from "node:fs/promises";

import { stopProcessGroup, type CommandResult } from "./run-command.js";

/** How many background commands may run at once in one invocation. */
export const MAX_RUNNING_BACKGROUND_COMMANDS = 8;

/** How much of a background command's output its file keeps (bytes). */
export const MAX_BACKGROUND_OUTPUT_BYTES = 10 * 1024 * 1024;

/** Where a background command's output file is, as the agent reads it and on disk. */
export interface BackgroundOutputPaths {
  /** The path the agent's `read_file` opens. */
  virtual(id: string): string;
  /** The file this process writes. */
  real(id: string): string;
}

/** The file name of a command's output: its id, kept to characters every filesystem takes. */
export function backgroundOutputFileName(id: string): string {
  return `background-${id.replace(/[^A-Za-z0-9_-]/g, "_")}.log`;
}

/** How a start runs its command: the backend's door, with the registry's signal and listeners. */
export interface BackgroundRunOptions {
  readonly signal: AbortSignal;
  readonly onOutput: (chunk: string) => void;
  readonly onSpawn: (processGroupId: number) => void;
}

export interface BackgroundStartRequest {
  /** The starting call's tool call id. */
  readonly id: string;
  readonly command: string;
  readonly timeoutSeconds: number;
  /** The file its output goes to; undefined when the session keeps no scratch directory. */
  readonly outputPath: string | undefined;
  readonly run: (options: BackgroundRunOptions) => Promise<CommandResult>;
}

/** Who stopped a command (the header). */
export type BackgroundStoppedBy =
  | { readonly by: "agent"; readonly callId: string }
  | { readonly by: "person" }
  | { readonly by: "approval" }
  | { readonly by: "turn" };

/** One background command, as read at one moment. */
export interface BackgroundCommand {
  readonly id: string;
  readonly command: string;
  readonly timeoutSeconds: number;
  /** Set once it ended, however it ended. */
  readonly result: CommandResult | undefined;
  /** Who asked for it to stop, when someone did before it ended on its own. */
  readonly stoppedBy: BackgroundStoppedBy | undefined;
}

/** What hears each command's life: the adapter turns it into the turn's transcript facts. */
export interface BackgroundListeners {
  readonly onStarted?: (command: BackgroundCommand) => void;
  readonly onOutput?: (id: string, chunk: string) => void;
  /** It ended, with its result set; called before `stop` and `stopAll` resolve. */
  readonly onEnded?: (command: BackgroundCommand) => void;
}

/** Why `stopAll` stops what still runs: the invocation ends awaiting a person's answer, or otherwise. */
export type InvocationEnd = "approval" | "turn";

export type BackgroundStartAnswer =
  | { readonly kind: "started" }
  | { readonly kind: "full"; readonly running: readonly string[] }
  /** The invocation has ended: nothing more starts. */
  | { readonly kind: "closed" };

/** Why the earlier invocation's commands were stopped, as the next one tells the agent. */
export type PriorStop = "approval" | "interrupted";

class Entry {
  result: CommandResult | undefined;
  stoppedBy: BackgroundStoppedBy | undefined;
  processGroupId: number | undefined;
  readonly controller = new AbortController();
  /** Resolves once it ended and its file is closed. */
  done: Promise<void> = Promise.resolve();

  constructor(
    readonly id: string,
    readonly command: string,
    readonly timeoutSeconds: number,
  ) {}

  view(): BackgroundCommand {
    return {
      id: this.id,
      command: this.command,
      timeoutSeconds: this.timeoutSeconds,
      result: this.result,
      stoppedBy: this.stoppedBy,
    };
  }
}

/** Writes one command's output to its file, the first {@link MAX_BACKGROUND_OUTPUT_BYTES} of it (the header). */
class OutputFile {
  private writing: Promise<unknown>;
  private written = 0;
  private dropped = 0;
  private handle: FileHandle | undefined;

  constructor(path: string) {
    this.writing = open(path, "w").then(
      (handle) => (this.handle = handle),
      (err: unknown) => console.warn(`[background-commands] output file not opened: ${path}: ${String(err)}`),
    );
  }

  append(chunk: string): void {
    const bytes = Buffer.from(chunk, "utf8");
    const room = MAX_BACKGROUND_OUTPUT_BYTES - this.written;
    const kept = room >= bytes.length ? bytes : bytes.subarray(0, Math.max(0, room));
    this.dropped += bytes.length - kept.length;
    this.written += kept.length;
    if (kept.length > 0) this.write(kept);
  }

  /** Every write made, the dropped line said, the file closed. */
  async close(): Promise<void> {
    if (this.dropped > 0) {
      this.write(Buffer.from(`\n… [${this.dropped} bytes dropped: this file keeps the first ${MAX_BACKGROUND_OUTPUT_BYTES} bytes] …\n`, "utf8"));
    }
    await this.writing;
    await this.handle?.close().catch(() => undefined);
  }

  private write(bytes: Buffer): void {
    this.writing = this.writing.then(() => this.handle?.write(bytes)).catch(() => undefined);
  }
}

/** One invocation's background commands (the module header). */
export class BackgroundCommands {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  private closed = false;
  private reminded = false;
  private prior: PriorStop = "interrupted";

  constructor(private readonly hear: BackgroundListeners = {}) {}

  /** Start `request` (its command runs on after this returns); never throws. */
  start(request: BackgroundStartRequest): BackgroundStartAnswer {
    if (this.closed) return { kind: "closed" };
    const running = this.running().map((command) => command.id);
    if (running.length >= MAX_RUNNING_BACKGROUND_COMMANDS) return { kind: "full", running };

    const entry = new Entry(request.id, request.command, request.timeoutSeconds);
    this.entries.set(request.id, entry);
    const file = request.outputPath === undefined ? undefined : new OutputFile(request.outputPath);
    this.hear.onStarted?.(entry.view());
    entry.done = request
      .run({
        signal: entry.controller.signal,
        onOutput: (chunk) => {
          file?.append(chunk);
          this.hear.onOutput?.(entry.id, chunk);
        },
        onSpawn: (processGroupId) => (entry.processGroupId = processGroupId),
      })
      .then(async (result) => {
        await file?.close();
        entry.result = result;
        this.hear.onEnded?.(entry.view());
        for (const listener of [...this.listeners]) listener();
      });
    return { kind: "started" };
  }

  get(id: string): BackgroundCommand | undefined {
    return this.entries.get(id)?.view();
  }

  /** Every command started in this invocation, in start order. */
  all(): BackgroundCommand[] {
    return [...this.entries.values()].map((entry) => entry.view());
  }

  running(): BackgroundCommand[] {
    return this.all().filter((command) => command.result === undefined);
  }

  /**
   * Stop command `id` at the agent's request (by its stop call's id) or a
   * person's, and resolve with it once every process in its group has gone;
   * as it is when it had already ended; undefined when this invocation
   * started no such command.
   */
  async stop(id: string, by: { readonly agent: string } | "person"): Promise<BackgroundCommand | undefined> {
    const entry = this.entries.get(id);
    if (entry === undefined) return undefined;
    if (entry.result === undefined) {
      entry.stoppedBy ??= by === "person" ? { by: "person" } : { by: "agent", callId: by.agent };
      await this.end(entry);
    }
    return entry.view();
  }

  /**
   * Stop every command, and refuse every later start; resolves once every
   * group has gone and every ending was heard (the header). `why` names
   * what stopped the ones still running.
   */
  async stopAll(why: InvocationEnd = "turn"): Promise<void> {
    this.closed = true;
    for (const entry of this.entries.values()) {
      if (entry.result === undefined) entry.stoppedBy ??= { by: why };
    }
    await Promise.all([...this.entries.values()].map((entry) => this.end(entry)));
  }

  /**
   * Resolves once any command of `ids` has ended (at once when one already
   * has), or when `signal` aborts.
   */
  whenAnyEnds(ids: readonly string[], signal: AbortSignal): Promise<void> {
    const ended = (): boolean => ids.some((id) => this.entries.get(id)?.result !== undefined);
    if (ended() || signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = (): void => {
        this.listeners.delete(listener);
        signal.removeEventListener("abort", finish);
        resolve();
      };
      const listener = (): void => {
        if (ended()) finish();
      };
      this.listeners.add(listener);
      signal.addEventListener("abort", finish, { once: true });
    });
  }

  /** True the first time it is asked in this invocation: the round-end reminder is given once. */
  takeReminder(): boolean {
    if (this.reminded) return false;
    this.reminded = true;
    return true;
  }

  /** This invocation resumes the person's approval decisions: the commands it finds stopped were stopped at that pause. */
  resumesApproval(): void {
    this.prior = "approval";
  }

  /** Why the commands an earlier invocation started were stopped. */
  priorStop(): PriorStop {
    return this.prior;
  }

  private async end(entry: Entry): Promise<void> {
    entry.controller.abort();
    await entry.done;
    if (entry.processGroupId !== undefined) await stopProcessGroup(entry.processGroupId);
  }
}
