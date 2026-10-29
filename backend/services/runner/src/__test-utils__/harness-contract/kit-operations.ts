/**
 * The operations a contract subject's `open` steps start, as real shells the
 * kit drives: a subject whose engine runs a shell (the Stigmer harness's
 * `execute`, the Claude engine's host-served `Bash`) runs the command this
 * module hands it, and the kit's long-turn controls (`types.ts`
 * `LongTurnControls`) reach it through here.
 *
 * A shell is opened through a FIFO: the subject's open of the write end
 * completes exactly when the shell opens the read end, so "running" is the
 * kernel's rendezvous, never a poll. Each emitted line is written to the
 * FIFO and the shell prints it; the release line ends the shell. A release
 * covers later openings of the same id too (a reinvocation that re-runs the
 * call), and is safe on one that never ran.
 */

import { execFileSync } from "node:child_process";
import { closeSync, constants, mkdirSync, openSync, rmSync } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

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
export class KitOperations {
  private readonly operations = new Map<string, KitOperation>();
  private readonly waiters = new Map<string, Array<() => void>>();
  private readonly released = new Set<string>();
  /** How many shells began under each id: the moment the shell opened its FIFO. */
  private readonly starts = new Map<string, number>();
  private counter = 0;

  constructor(
    private readonly dir: string,
    /** The subject's name, for a kit bug's message. */
    private readonly subjectName: string,
  ) {}

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
    if (operation === undefined || operation.done) throw new Error(`${this.subjectName}: emit(${toolCallId}) with no shell open (kit bug)`);
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
