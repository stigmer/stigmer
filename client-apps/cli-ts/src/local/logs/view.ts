// Multi-component log viewing for `stigmer logs`: print a tail snapshot and,
// optionally, follow appended lines live.
//
// Divergence from the Go CLI (documented, not drift): the Go `--all` view merges
// components by parsing each line's timestamp. That parse is fragile across the
// server's and runner's different log formats and silently misorders lines it
// cannot parse. The TS view instead prefixes every line with its component name
// (kubectl-style), which is robust without any format coupling and reads clearly
// in both snapshot and follow modes.

import { join } from "node:path";
import { type FollowHandle, followFile, tailLines } from "./tail.js";

export interface LogComponent {
  readonly name: string;
  readonly file: string;
}

/** The components whose logs the daemon writes, in dependency order. */
export function allComponents(logDir: string): LogComponent[] {
  return [
    { name: "stigmer-server", file: join(logDir, "stigmer-server.log") },
    { name: "runner", file: join(logDir, "runner.log") },
    { name: "temporal", file: join(logDir, "temporal.log") },
  ];
}

/** One component by name, or undefined if not a known component. */
export function componentByName(logDir: string, name: string): LogComponent | undefined {
  return allComponents(logDir).find((component) => component.name === name);
}

export interface Sink {
  write(chunk: string): unknown;
}

function format(line: string, name: string, prefix: boolean): string {
  return prefix ? `[${name}] ${line}\n` : `${line}\n`;
}

/** Print the last `tail` lines of each component (grouped by component). */
export function printTail(components: LogComponent[], tail: number, out: Sink): void {
  const prefix = components.length > 1;
  for (const component of components) {
    for (const line of tailLines(component.file, tail)) {
      out.write(format(line, component.name, prefix));
    }
  }
}

/**
 * Follow appended lines from each component until the returned handle is
 * stopped. New lines only (the caller prints the tail snapshot first).
 */
export function followAll(components: LogComponent[], out: Sink): FollowHandle {
  const prefix = components.length > 1;
  const handles = components.map((component) =>
    followFile(component.file, (line) => out.write(format(line, component.name, prefix))),
  );
  return {
    stop(): void {
      for (const handle of handles) handle.stop();
    },
  };
}
