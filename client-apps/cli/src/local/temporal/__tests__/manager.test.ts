import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { freePort } from "../../../__test-utils__/ports.js";
import { temporalPidFile } from "../../paths.js";
import { writePidFile } from "../../state/pidfile.js";
import { isProcessAlive } from "../../state/proc.js";
import { DEFAULT_TEMPORAL_VERSION, installedTemporalVersion, type TarballInstall, type TemporalDownloadTarget } from "../download.js";
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

    // A stand-in `temporal` binary: it reports the pinned version, so the
    // manager keeps it; it listens on the --port it is given, as the dev
    // server's frontend does; and its command line names Temporal.
    function fakeTemporal(dir: string): string {
      const bin = join(dir, "temporal");
      writeFileSync(
        bin,
        `#!${process.execPath}\nconst args = process.argv.slice(2);\n` +
          `if (args[0] === "--version") { console.log("temporal version ${DEFAULT_TEMPORAL_VERSION} (Server 1.32.2, UI 2.56.1)"); process.exit(0); }\n` +
          `require("node:net").createServer().listen(Number(args[args.indexOf("--port") + 1]), "127.0.0.1");\n`,
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

  // stigmer#1319: a pin bump reaches a laptop that already has a binary only if
  // `up` asks that binary its version. The installer is injected, so these cases
  // replace binaries without the network; the fakes print the line the real CLI
  // prints (`temporal version 1.10.0 (Server 1.32.2, UI 2.56.1)`).
  describe("installing", () => {
    const PIN = DEFAULT_TEMPORAL_VERSION;

    function fakeTemporal(binPath: string, versionLine: string | null): void {
      mkdirSync(dirname(binPath), { recursive: true });
      const body = versionLine === null ? "#!/bin/sh\nexit 0\n" : `#!/bin/sh\necho '${versionLine}'\n`;
      writeFileSync(binPath, body, { mode: 0o755 });
      chmodSync(binPath, 0o755);
    }

    function versionLine(version: string): string {
      return `temporal version ${version} (Server 1.32.2, UI 2.56.1)`;
    }

    // An installer that writes a fake binary of the requested version and records each call.
    function recordingInstaller(): { install: (t: TemporalDownloadTarget) => Promise<TarballInstall>; calls: TemporalDownloadTarget[] } {
      const calls: TemporalDownloadTarget[] = [];
      const install = async (target: TemporalDownloadTarget): Promise<TarballInstall> => {
        calls.push(target);
        fakeTemporal(target.binPath, versionLine(target.version));
        return { source: "network", cache: "unused" };
      };
      return { install, calls };
    }

    function homeBin(home: string): string {
      return join(home, ".stigmer", "bin", "temporal");
    }

    // The lines the CLI's logger writes to stderr while `fn` runs.
    async function stderrOf(fn: () => Promise<void>): Promise<string[]> {
      const lines: string[] = [];
      vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
        lines.push(String(chunk).trimEnd());
        return true;
      });
      await fn();
      return lines;
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("keeps an installed binary that reports the pinned version, installing nothing", async () => {
      const home = tempHome();
      fakeTemporal(homeBin(home), versionLine(PIN));
      const installer = recordingInstaller();

      await TemporalManager.forHome(home, {}, { install: installer.install }).ensureInstalled();

      expect(installer.calls).toEqual([]);
    });

    it("replaces an installed binary of another version with the pinned one", async () => {
      const home = tempHome();
      fakeTemporal(homeBin(home), versionLine("1.5.1"));
      const installer = recordingInstaller();

      const lines = await stderrOf(() => TemporalManager.forHome(home, {}, { install: installer.install }).ensureInstalled());

      expect(installer.calls).toEqual([{ version: PIN, binPath: homeBin(home) }]);
      expect(installedTemporalVersion(homeBin(home))).toBe(PIN);
      expect(lines).toContain(`info replacing Temporal CLI from=1.5.1 to=${PIN}`);
    });

    it("replaces an installed binary that does not say its version", async () => {
      const home = tempHome();
      fakeTemporal(homeBin(home), null);
      const installer = recordingInstaller();

      const lines = await stderrOf(() => TemporalManager.forHome(home, {}, { install: installer.install }).ensureInstalled());

      expect(installer.calls).toEqual([{ version: PIN, binPath: homeBin(home) }]);
      expect(lines).toContain(`info replacing Temporal CLI from=unknown to=${PIN}`);
    });

    it("installs the pinned version when no binary is present", async () => {
      const home = tempHome();
      const installer = recordingInstaller();

      const lines = await stderrOf(() => TemporalManager.forHome(home, {}, { install: installer.install }).ensureInstalled());

      expect(installer.calls).toEqual([{ version: PIN, binPath: homeBin(home) }]);
      expect(lines).toContain(`info downloading Temporal CLI version=${PIN}`);
    });

    it("keeps a STIGMER_TEMPORAL_BIN binary of another version, and starts it as configured", async () => {
      const home = tempHome();
      const binPath = join(tempHome(), "opt", "temporal");
      fakeTemporal(binPath, versionLine("1.5.1"));
      const installer = recordingInstaller();

      const lines = await stderrOf(() =>
        TemporalManager.forHome(home, { STIGMER_TEMPORAL_BIN: binPath }, { install: installer.install }).ensureInstalled(),
      );

      expect(installer.calls).toEqual([]);
      expect(installedTemporalVersion(binPath)).toBe("1.5.1");
      expect(lines).toContain(`warn Temporal CLI at ${binPath} is 1.5.1, stigmer expects ${PIN}; starting it as configured`);
    });

    it("installs to a STIGMER_TEMPORAL_BIN path that holds no binary yet", async () => {
      const home = tempHome();
      const binPath = join(tempHome(), "opt", "temporal");
      const installer = recordingInstaller();

      await TemporalManager.forHome(home, { STIGMER_TEMPORAL_BIN: binPath }, { install: installer.install }).ensureInstalled();

      expect(installer.calls).toEqual([{ version: PIN, binPath }]);
    });
  });
});
