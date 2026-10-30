// A terminal for tests that need Ink's real output, not ink-testing-library's
// debug frames (which repeat the whole history in every frame): a TTY stdout
// of a set size that keeps every byte Ink writes and can be resized, and a
// TTY stdin. With them, `render` takes the path a person's terminal does:
// history written once through <Static>, the live region erased and redrawn
// in place, and the clear Ink writes when the live region outgrows the screen.
import { EventEmitter } from "node:events";
import type { ReactElement } from "react";
import { render, type Instance } from "ink";

/** A fake TTY output stream: its size, and everything written to it. */
export class FakeStdout extends EventEmitter {
  readonly isTTY = true;
  columns: number;
  rows: number;
  /** Every chunk written, in order. */
  readonly chunks: string[] = [];

  constructor(columns: number, rows: number) {
    super();
    this.columns = columns;
    this.rows = rows;
  }

  write = (chunk: string): boolean => {
    this.chunks.push(chunk);
    return true;
  };

  /** Everything written so far, escape codes included. */
  output(): string {
    return this.chunks.join("");
  }

  /** Changes the size, as a window resize does, and says so. */
  resize(columns: number, rows: number): void {
    this.columns = columns;
    this.rows = rows;
    this.emit("resize");
  }
}

/** A fake TTY input stream that Ink can read keys from. */
export class FakeStdin extends EventEmitter {
  readonly isTTY = true;
  private data: string | null = null;
  write(data: string): void {
    this.data = data;
    this.emit("readable");
    this.emit("data", data);
  }
  read = (): string | null => {
    const { data } = this;
    this.data = null;
    return data;
  };
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
}

/** What clears a terminal and its scrollback (ansi-escapes' clearTerminal), which Ink writes when a frame outgrows the screen. */
export const CLEAR_TERMINAL = /\u001b\[2J|\u001b\[3J/;

/** Renders `node` on a fake terminal of `columns` × `rows`, as a live screen. */
export function renderOnTerminal(node: ReactElement, columns = 80, rows = 24): { instance: Instance; stdout: FakeStdout; stdin: FakeStdin } {
  const stdout = new FakeStdout(columns, rows);
  const stdin = new FakeStdin();
  const instance = render(node, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: new FakeStdout(columns, rows) as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    interactive: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { instance, stdout, stdin };
}

/** Waits for Ink's throttled render to write. */
export function settle(ms = 60): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
