import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { freePort } from "../../../__test-utils__/ports.js";
import { temporalPidFile } from "../../paths.js";
import { writePidFile } from "../../state/pidfile.js";
import { isProcessAlive } from "../../state/proc.js";
import { TemporalManager } from "../manager.js";

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

  // stigmer#1175: stopped means the process has exited, not only that its port
  // closed; the dev server goes on writing its database for a moment after.
  it("returns from stop only once the Temporal process itself has exited", async () => {
    const home = tempHome();
    // Named like the dev server, in its own process group, and slow to exit.
    const child = spawn(
      process.execPath,
      ["-e", `process.on("SIGTERM", () => setTimeout(() => process.exit(0), 300)); process.stdout.write("ready\\n"); setInterval(() => {}, 1000);`, "temporal", "server", "start-dev"],
      { detached: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    await new Promise<void>((resolve) => child.stdout.once("data", () => resolve()));
    const pid = child.pid!;
    writePidFile(temporalPidFile(home), pid);
    try {
      const manager = TemporalManager.forHome(home);
      await manager.stop();

      expect(isProcessAlive(pid)).toBe(false);
      expect(manager.getPid()).toBeNull();
    } finally {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  });

  // stigmer#2750: stop signals Temporal's whole process group, so the record
  // is checked first; a PID the OS gave to another program is never signalled.
  describe("beside a record that is not our Temporal", () => {
    async function detachedProcess(argv: string[]): Promise<number> {
      const child = spawn(process.execPath, ["-e", `process.stdout.write("ready\\n"); setInterval(() => {}, 1000);`, ...argv], {
        detached: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
      await new Promise<void>((resolve) => child.stdout.once("data", () => resolve()));
      return child.pid!;
    }

    async function expectStopLeavesAlone(home: string, pid: number): Promise<void> {
      try {
        const manager = TemporalManager.forHome(home);
        await manager.stop();
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(isProcessAlive(pid)).toBe(true);
        expect(manager.getPid()).toBeNull();
        expect(await manager.isRunning()).toBe(false);
      } finally {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }

    it("leaves a Temporal-shaped process recorded with another start time alone", async () => {
      const home = tempHome();
      const pid = await detachedProcess(["temporal", "server", "start-dev"]);
      mkdirSync(dirname(temporalPidFile(home)), { recursive: true });
      writeFileSync(temporalPidFile(home), `${pid}\nstarted=another life\n`);
      await expectStopLeavesAlone(home, pid);
    });

    // A stand-in `temporal` binary: it listens on the --port it is given,
    // as the dev server's frontend does, and its command line names Temporal.
    function fakeTemporal(dir: string): string {
      const bin = join(dir, "temporal");
      writeFileSync(
        bin,
        `#!${process.execPath}\nconst args = process.argv.slice(2);\nrequire("node:net").createServer().listen(Number(args[args.indexOf("--port") + 1]), "127.0.0.1");\n`,
      );
      chmodSync(bin, 0o755);
      return bin;
    }

    it("starts its own server beside a record naming another program now, leaving that program alone", async () => {
      const home = tempHome();
      const stranger = await detachedProcess(["temporal", "server", "start-dev"]);
      const pidFile = join(home, "temporal.pid");
      writeFileSync(pidFile, `${stranger}\nstarted=another life\n`);
      const manager = new TemporalManager({
        binPath: fakeTemporal(home),
        dataDir: join(home, "temporal-data"),
        logFile: join(home, "logs", "temporal.log"),
        pidFile,
        lockFile: join(home, "temporal.lock"),
        port: await freePort(),
        uiPort: await freePort(),
      });
      try {
        await manager.start();
        const started = manager.getPid();
        expect(started).not.toBeNull();
        expect(started).not.toBe(stranger);
        expect(await manager.isRunning()).toBe(true);
        expect(isProcessAlive(stranger)).toBe(true);

        await manager.stop();
        // Our own child: gone once this process has reaped it.
        await expect.poll(() => isProcessAlive(started!)).toBe(false);
        expect(isProcessAlive(stranger)).toBe(true);
      } finally {
        await manager.stop();
        try {
          process.kill(-stranger, "SIGKILL");
        } catch {
          // already gone
        }
      }
    });

    it("leaves a process that is not Temporal alone, even recorded with its own start time", async () => {
      const home = tempHome();
      const pid = await detachedProcess([]);
      writePidFile(temporalPidFile(home), pid);
      await expectStopLeavesAlone(home, pid);
    });
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
