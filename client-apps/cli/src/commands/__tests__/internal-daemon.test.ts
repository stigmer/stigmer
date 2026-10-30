// Pins `stigmer internal-daemon`: the stop request is armed before the daemon
// body is even imported (a `stigmer down` that lands while the module loads
// must not end the process unhandled, stigmer#1175), handed to the body, and
// the body's exit code is the process's. The body is replaced; nothing boots.

import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InternalDaemonDeps } from "../../local/daemon/process.js";
import { registerInternalDaemon } from "../internal-daemon.js";

const body = vi.hoisted(() => ({
  baseline: process.listenerCount("SIGTERM"),
  sigtermHandlersAtImport: -1,
  calls: [] as InternalDaemonDeps[],
}));

vi.mock("../../local/daemon/process.js", () => {
  body.sigtermHandlersAtImport = process.listenerCount("SIGTERM");
  return {
    runInternalDaemon: async (deps: InternalDaemonDeps): Promise<number> => {
      body.calls.push(deps);
      return 3;
    },
  };
});

const before = { SIGTERM: process.listeners("SIGTERM"), SIGINT: process.listeners("SIGINT") };
afterEach(() => {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    for (const l of process.listeners(signal)) if (!before[signal].includes(l)) process.removeListener(signal, l);
  }
  vi.restoreAllMocks();
});

describe("internal-daemon", () => {
  it("arms the stop request before loading the body, hands it over, and exits with the body's code", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const program = new Command();
    registerInternalDaemon(program);

    await program.parseAsync(["internal-daemon"], { from: "user" });

    expect(body.sigtermHandlersAtImport).toBe(body.baseline + 1);
    expect(body.calls).toHaveLength(1);
    const { shutdown } = body.calls[0];
    expect(shutdown.aborted).toBe(false);
    const handler = process.listeners("SIGTERM").find((l) => !before.SIGTERM.includes(l)) as () => void;
    handler();
    expect(shutdown.aborted).toBe(true);
    expect(exit).toHaveBeenCalledWith(3);
  });
});
