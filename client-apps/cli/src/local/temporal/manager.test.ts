import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { temporalPidFile } from "../paths.js";
import { writePidFile } from "../state/pidfile.js";
import { TemporalManager } from "./manager.js";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "stigmer-home-"));
}

describe("TemporalManager", () => {
  it("exposes the frontend address", () => {
    const manager = TemporalManager.forHome(tempHome());
    expect(manager.address).toBe("127.0.0.1:7233");
  });

  it("reads the PID from the ~/.stigmer/temporal.pid location", () => {
    const home = tempHome();
    const manager = TemporalManager.forHome(home);
    expect(manager.getPid()).toBeNull();
    writePidFile(temporalPidFile(home), 5151);
    expect(manager.getPid()).toBe(5151);
  });

  it("reports not-running when there is no PID file", async () => {
    const manager = TemporalManager.forHome(tempHome());
    expect(await manager.isRunning()).toBe(false);
  });

  // A stale PID file naming THIS process (the restarted container's fresh PID
  // namespace reused it) can never be a running Temporal.
  it("reports not-running when the PID file names the current process", async () => {
    const home = tempHome();
    writePidFile(temporalPidFile(home), process.pid);
    expect(await TemporalManager.forHome(home).isRunning()).toBe(false);
  });

  describe("STIGMER_TEMPORAL_BIN", () => {
    it("relocates only the binary; data, log, PID and lock stay under the home", async () => {
      const home = tempHome();
      const binPath = join(tempHome(), "opt", "temporal");
      mkdirSync(join(binPath, ".."), { recursive: true });
      writeFileSync(binPath, "#!/bin/sh\n");

      const manager = TemporalManager.forHome(home, { STIGMER_TEMPORAL_BIN: binPath });
      expect(manager.binPath).toBe(binPath);

      // Nothing to download: the pre-installed binary is what ensureInstalled checks for.
      await manager.ensureInstalled();
      expect(existsSync(join(home, ".stigmer", "bin", "temporal"))).toBe(false);
      // State still lives in the home layout.
      writePidFile(temporalPidFile(home), 5151);
      expect(manager.getPid()).toBe(5151);
    });

    it("is ignored when empty, keeping the ~/.stigmer/bin default", () => {
      const home = tempHome();
      const manager = TemporalManager.forHome(home, { STIGMER_TEMPORAL_BIN: "" });
      expect(manager.binPath).toBe(join(home, ".stigmer", "bin", "temporal"));
    });
  });
});
