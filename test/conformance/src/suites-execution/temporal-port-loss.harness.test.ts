// Execution-engine harness smoke for the Temporal dev server's lost-port retry.
// Domain: the harness itself (test/support's temporal.ts); not a gRPC
// contract, hence a smoke.
//
// The Temporal CLI cannot be told port 0, so a boot whose port another
// listener took first dies (stigmer#1469), and spawnTemporal retries it on a
// fresh port. Its unit arms pin the classifier on captured output and the loop
// on scripted attempts; what they cannot prove is the real attempt: that the
// pinned CLI's death on a taken port reaches the classifier whole, that the
// loop says so and moves on, and that the next attempt passes the banner and
// SERVING gates on its own port. So this arm hands the real loop a frontend
// port a listener holds, and it belongs where the CLI is: the execution class.
//
// It needs no server. It runs on the targets that boot their own engine
// through this harness (`engineCoordinates()`); the cloud targets, whose
// engine is the service's, report SKIPPED, as runner-ipc.harness.test.ts does.
import { execFile } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import {
  bootTemporal,
  bootTemporalAttempt,
  probeFrontendPort,
  type RunningTemporal,
} from "@stigmer/test-support/temporal";
import { createTarget } from "../targets";

const execFileAsync = promisify(execFile);
const hasEngineCoordinates = createTarget().engineCoordinates !== undefined;

describe.skipIf(!hasEngineCoordinates)("Temporal dev server harness, a boot that loses its port", () => {
  const holder = createServer();
  let temporal: RunningTemporal | undefined;

  afterAll(async () => {
    await temporal?.stop();
    await new Promise<void>((resolve) => holder.close(() => resolve()));
  });

  it("recognises the lost port, says so, and serves on a fresh one", async () => {
    await new Promise<void>((resolve) => holder.listen(0, "127.0.0.1", resolve));
    const held = (holder.address() as AddressInfo).port;
    const handed: number[] = [];
    const warnings: string[] = [];

    temporal = await bootTemporal({
      attempt: bootTemporalAttempt,
      nextPort: async () => {
        const port = handed.length === 0 ? held : await probeFrontendPort();
        handed.push(port);
        return port;
      },
      maxAttempts: 3,
      warn: (line) => warnings.push(line),
    });

    // The fresh port can itself be lost to another listener, the race the
    // retry exists for, so a third attempt is the harness working, not a
    // failure: what must hold is that the held port was tried first and
    // named, every loss was announced, and the server is on the last port.
    expect(handed[0]).toBe(held);
    expect(warnings[0]).toContain(`${held}: bind: address already in use`);
    expect(warnings[0]).toContain("retrying with a fresh port, attempt 2 of 3");
    expect(warnings).toHaveLength(handed.length - 1);
    expect(temporal.hostPort).toBe(`127.0.0.1:${handed.at(-1)}`);

    // Serving on the fresh port, by the CLI's own account.
    const { stdout } = await execFileAsync("temporal", [
      "operator",
      "cluster",
      "health",
      "--address",
      temporal.hostPort,
    ]);
    expect(stdout).toContain("SERVING");
  });
});
