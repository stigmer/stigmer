// Pins the local stack's stop request: it is aborted by the first SIGTERM or
// SIGINT after it is armed, and its handlers are `once`, so a second signal
// meets Node's default handler (the "press Ctrl-C again to force" contract).
// The handlers are called directly rather than signals emitted, so the test
// runner's own signal handling is never reached.

import { afterEach, describe, expect, it } from "vitest";
import { shutdownOnSignals } from "../signals.js";

type Listener = (...args: unknown[]) => void;
const added: Array<{ signal: NodeJS.Signals; listener: Listener }> = [];

// Arm the stop request and return it with the one handler it added per signal.
function arm(): { stop: AbortSignal; handlers: Record<"SIGTERM" | "SIGINT", Listener> } {
  const before = { SIGTERM: process.listeners("SIGTERM"), SIGINT: process.listeners("SIGINT") };
  const stop = shutdownOnSignals();
  const handlers = {} as Record<"SIGTERM" | "SIGINT", Listener>;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    const fresh = process.listeners(signal).filter((l) => !before[signal].includes(l)) as Listener[];
    expect(fresh).toHaveLength(1);
    handlers[signal] = fresh[0];
    added.push({ signal, listener: fresh[0] });
  }
  return { stop, handlers };
}

afterEach(() => {
  for (const { signal, listener } of added.splice(0)) process.removeListener(signal, listener);
});

describe("shutdownOnSignals", () => {
  it.each(["SIGTERM", "SIGINT"] as const)("is aborted by %s, and not before", (signal) => {
    const { stop, handlers } = arm();
    expect(stop.aborted).toBe(false);

    handlers[signal]();

    expect(stop.aborted).toBe(true);
  });

  it("installs once-handlers, so a second signal is not caught", () => {
    const { handlers } = arm();
    const once = process.rawListeners("SIGTERM").filter((raw) => (raw as { listener?: unknown }).listener === handlers.SIGTERM);
    expect(once).toHaveLength(1);
  });
});
