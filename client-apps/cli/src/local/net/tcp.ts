// TCP readiness probing — the "poll-don't-sleep" pattern shared by the Temporal
// manager and the server gate.
//
// A single short-lived connection attempt tells us whether something is
// listening; waitForTcp loops that probe until a deadline, failing fast (with a
// log tail) if the process under watch exits first. This mirrors
// `test/conformance/src/harness/temporal.ts` so the CLI and the harnesses share
// one readiness model.

import { connect } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

/** Attempt a single TCP connection; resolves true if it connects in time. */
export function tcpConnects(port: number, host = "127.0.0.1", timeoutMs = 200): Promise<boolean> {
  return new Promise((resolveConnected) => {
    const socket = connect({ port, host });
    let settled = false;
    const settle = (connected: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveConnected(connected);
    };
    socket.setTimeout(timeoutMs, () => settle(false));
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
  });
}

export interface WaitForTcpOptions {
  port: number;
  host?: string;
  /** Overall deadline. */
  timeoutMs?: number;
  /** Delay between probes. */
  pollMs?: number;
  /** If provided and it returns non-null, the watched process has exited — fail
   * immediately rather than waiting out the deadline. */
  getExit?: () => { code: number | null; signal: NodeJS.Signals | null } | null;
  /** Diagnostic log tail, appended to the failure message. */
  getLog?: () => string;
  /** Human label for the thing being awaited (used in error text). */
  label?: string;
}

/** Poll a TCP port until it accepts a connection or the deadline passes. */
export async function waitForTcp(options: WaitForTcpOptions): Promise<void> {
  const { port, host = "127.0.0.1", timeoutMs = 30_000, pollMs = 150, getExit, getLog, label = `port ${port}` } = options;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const exit = getExit?.();
    if (exit != null) {
      throw new Error(`${label} exited before becoming ready (code=${exit.code}, signal=${exit.signal})${tail(getLog)}`);
    }
    if (await tcpConnects(port, host)) return;
    await delay(pollMs);
  }
  throw new Error(`${label} did not become ready within ${timeoutMs}ms${tail(getLog)}`);
}

function tail(getLog?: () => string): string {
  const log = getLog?.();
  return log ? `\n--- log tail ---\n${log}` : "";
}
