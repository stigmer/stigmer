import { mkdtempSync } from "node:fs";
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
});
