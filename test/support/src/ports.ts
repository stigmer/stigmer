// The run's one address nothing can listen on, and the law for every port a
// harness needs.
// Domain: test support (stack spawns).
//
// The law: a listener binds port 0 and reports the port it got, and no
// harness hands a listener a port it probed and released. Between the
// release and the child's bind, any other listener in the run can take that
// port; the child then fails to boot, or the harness talks to the thief
// (stigmer#1469; the same shape failed the server's composed tests in #1353
// and #1362). In-process fakes read `address()` after `listen(0)`
// (mock-llm.ts, fake-llm-upstream.ts); a spawned server prints the ports it
// bound on its ready line (server-process.ts). The Temporal dev server is the
// one exception, because its CLI cannot be told 0; temporal.ts survives the
// loss instead.
//
// isPortReachable and waitForPortRefusal are for a port a harness hands from
// one run to the next (the e2e stack's fixed API port): the next run can only
// trust the port once nothing answers on it.
//
// UNREACHABLE_HOST_PORT is for the opposite need: an address that must stay
// dead for the whole run. Temporal's client counts any gRPC listener as a
// live frontend (its connect probe tolerates UNIMPLEMENTED), so a sibling
// server landing on an engineless server's Temporal address would flip its
// engine to connected (stigmer#1221), and a client meant to fail would reach
// a real server. Port 1 lies below every operating system's ephemeral range
// and is privileged on Linux, so no listen(0) and no sibling this run spawns
// can ever take it; a connect there is refused at once. The server's composed
// tests use the same address.

import * as net from "node:net";

export const UNREACHABLE_HOST_PORT = "127.0.0.1:1";

/**
 * Whether something accepts a TCP connection on `port` at `host` right now: a
 * connect that succeeds within `timeoutMs` is a listener; a refusal, an error
 * or a timeout is none.
 */
export function isPortReachable(port: number, host = "127.0.0.1", timeoutMs = 200): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host, timeout: timeoutMs });
    const done = (reachable: boolean) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
    socket.on("timeout", () => done(false));
  });
}

/**
 * Resolves once nothing accepts connections on `port` at `host`, with how long
 * that took; rejects, naming the port, if something still does after
 * `timeoutMs`. For a harness that hands a fixed port to the next run (the e2e
 * stack's API port), "stopped" then means the port is free, not only that the
 * processes it knew of exited: on 2026-09-30 an e2e teardown reported its
 * stack stopped while `:7234` still answered 4.5 s later, and the next
 * invocation refused to boot (stigmer#1594).
 */
export async function waitForPortRefusal(
  port: number,
  opts: { host?: string; timeoutMs?: number; intervalMs?: number } = {},
): Promise<number> {
  const host = opts.host ?? "127.0.0.1";
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const intervalMs = opts.intervalMs ?? 200;
  const started = Date.now();
  for (;;) {
    if (!(await isPortReachable(port, host))) return Date.now() - started;
    if (Date.now() - started >= timeoutMs) {
      throw new Error(
        `${host}:${port} still accepts connections after ${timeoutMs} ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
