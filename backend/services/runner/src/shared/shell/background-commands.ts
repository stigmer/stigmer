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

/** One background command, as read at one moment. */
export interface BackgroundCommand {
  readonly id: string;
  readonly command: string;
  readonly timeoutSeconds: number;
  /** Set once it ended, however it ended. */
  readonly result: CommandResult | undefined;
  /** It was ended by {@link BackgroundCommands.stop}, the agent's own request. */
  readonly stoppedOnRequest: boolean;
}

export type BackgroundStartAnswer =
  | { readonly kind: "started" }
  | { readonly kind: "full"; readonly running: readonly string[] }
  /** The invocation has ended: nothing more starts. */
  | { readonly kind: "closed" };

/** Why the earlier invocation's commands were stopped, as the next one tells the agent. */
export type PriorStop = "approval" | "interrupted";

class Entry {
  result: CommandResult | undefined;
  stoppedOnRequest = false;
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
      stoppedOnRequest: this.stoppedOnRequest,
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

  /** Start `request` (its command runs on after this returns); never throws. */
  start(request: BackgroundStartRequest): BackgroundStartAnswer {
    if (this.closed) return { kind: "closed" };
    const running = this.running().map((command) => command.id);
    if (running.length >= MAX_RUNNING_BACKGROUND_COMMANDS) return { kind: "full", running };

    const entry = new Entry(request.id, request.command, request.timeoutSeconds);
    this.entries.set(request.id, entry);
    const file = request.outputPath === undefined ? undefined : new OutputFile(request.outputPath);
    entry.done = request
      .run({
        signal: entry.controller.signal,
        onOutput: (chunk) => file?.append(chunk),
        onSpawn: (processGroupId) => (entry.processGroupId = processGroupId),
      })
      .then(async (result) => {
        await file?.close();
        entry.result = result;
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
   * Stop command `id` at the agent's request and resolve with it once every
   * process in its group has gone; as it is when it had already ended;
   * undefined when this invocation started no such command.
   */
  async stop(id: string): Promise<BackgroundCommand | undefined> {
    const entry = this.entries.get(id);
    if (entry === undefined) return undefined;
    if (entry.result === undefined) {
      entry.stoppedOnRequest = true;
      await this.end(entry);
    }
    return entry.view();
  }

  /** Stop every command, and refuse every later start; resolves once every group has gone (the header). */
  async stopAll(): Promise<void> {
    this.closed = true;
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
