import { mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type HealthState, loadHealthState, writeHealthState } from "../health-state.js";
import { acquireLock } from "../lock.js";
import { cleanupOldLogs, rotateLogs } from "../log-rotation.js";
import { readPidFile, readPidRecord, recordedLiveProcess, removePidFile, writePidFile } from "../pidfile.js";
import { isOtherLiveProcess, isProcessAlive, processCommand, processStartTime } from "../proc.js";
import { loadStartupConfig, removeStartupConfig, saveStartupConfig, type StartupConfig } from "../startup-config.js";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// A PID that is exceedingly unlikely to belong to a live process.
const DEAD_PID = 2 ** 31 - 1;

describe("pidfile", () => {
  it("writes, reads, and removes a PID", () => {
    const path = join(tempDir("stigmer-pid-"), "daemon.pid");
    writePidFile(path, 4321);
    expect(readPidFile(path)).toBe(4321);
    removePidFile(path);
    expect(readPidFile(path)).toBeNull();
  });

  it("returns null for a missing file", () => {
    expect(readPidFile(join(tempDir("stigmer-pid-"), "absent.pid"))).toBeNull();
  });

  it("reads only the first line of a multi-line (Temporal-style) PID file", () => {
    const path = join(tempDir("stigmer-pid-"), "temporal.pid");
    writeFileSync(path, "1234\ntemporal server start-dev\n2026-06-13T00:00:00Z\n");
    expect(readPidFile(path)).toBe(1234);
  });

  it("returns null for a non-numeric first line", () => {
    const path = join(tempDir("stigmer-pid-"), "bad.pid");
    writeFileSync(path, "not-a-pid\n");
    expect(readPidFile(path)).toBeNull();
  });
});

// stigmer#2750: a PID file names one process, not whichever program the OS
// later gives the number to.
describe("pidfile (the process's start time)", () => {
  it("records the start time beside the PID, and reads both back", () => {
    const path = join(tempDir("stigmer-pid-"), "daemon.pid");
    writePidFile(path, process.ppid);
    const started = processStartTime(process.ppid);
    expect(started).not.toBeNull();
    expect(readFileSync(path, "utf8")).toBe(`${process.ppid}\nstarted=${started}\n`);
    expect(readPidRecord(path)).toEqual({ pid: process.ppid, started });
    expect(readPidFile(path)).toBe(process.ppid);
  });

  it("writes the bare PID when the process's start cannot be read", () => {
    const path = join(tempDir("stigmer-pid-"), "runner.pid");
    writePidFile(path, DEAD_PID);
    expect(readFileSync(path, "utf8")).toBe(`${DEAD_PID}\n`);
    expect(readPidRecord(path)).toEqual({ pid: DEAD_PID, started: null });
  });

  it("answers with a live process only while it is the process recorded", () => {
    const path = join(tempDir("stigmer-pid-"), "daemon.pid");
    writePidFile(path, process.ppid);
    expect(recordedLiveProcess(path)).toBe(process.ppid);

    // The same number, started at another time: another program now.
    writeFileSync(path, `${process.ppid}\nstarted=another life\n`);
    expect(recordedLiveProcess(path)).toBeNull();
  });

  // A file from a CLI before the start-time line is trusted as it was, so an
  // upgrade never forgets a running stack.
  it("trusts a file with no start time on liveness alone", () => {
    const path = join(tempDir("stigmer-pid-"), "daemon.pid");
    writeFileSync(path, `${process.ppid}\n`);
    expect(recordedLiveProcess(path)).toBe(process.ppid);
  });

  it("never answers with this process, a dead one, or a missing file", () => {
    const dir = tempDir("stigmer-pid-");
    writePidFile(join(dir, "own.pid"), process.pid);
    expect(recordedLiveProcess(join(dir, "own.pid"))).toBeNull();
    writePidFile(join(dir, "dead.pid"), DEAD_PID);
    expect(recordedLiveProcess(join(dir, "dead.pid"))).toBeNull();
    expect(recordedLiveProcess(join(dir, "absent.pid"))).toBeNull();
  });
});

describe("isProcessAlive", () => {
  it("is true for the current process and false for a dead PID", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(DEAD_PID)).toBe(false);
  });
});

describe("isOtherLiveProcess", () => {
  // A recorded PID equal to our own is a leftover from a previous life of this
  // PID (a restarted container's fresh PID namespace, a laptop after reboot),
  // never a live peer — the distinction every stale-state reader needs.
  it("is false for the current process, true for its parent, false for a dead PID", () => {
    expect(isOtherLiveProcess(process.pid)).toBe(false);
    expect(isOtherLiveProcess(process.ppid)).toBe(true);
    expect(isOtherLiveProcess(DEAD_PID)).toBe(false);
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
  });
});

describe("processStartTime", () => {
  it("reads the same token for a live process every time, and null for a dead PID", () => {
    const first = processStartTime(process.pid);
    expect(first).not.toBeNull();
    expect(processStartTime(process.pid)).toBe(first);
    expect(processStartTime(DEAD_PID)).toBeNull();
    expect(processStartTime(0)).toBeNull();
  });

  // The daemon writes the token in the environment `up` handed it; a later
  // `down` reads it from another shell, maybe in another zone and locale.
  it("reads the same token through ps whatever the caller's zone and locale", () => {
    const plain = processStartTime(process.ppid, { procRoot: null });
    expect(plain).not.toBeNull();
    const saved = { TZ: process.env.TZ, LC_ALL: process.env.LC_ALL };
    try {
      process.env.TZ = "Asia/Kolkata";
      process.env.LC_ALL = "fr_FR.UTF-8";
      expect(processStartTime(process.ppid, { procRoot: null })).toBe(plain);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  describe("the procfs reader", () => {
    // A /proc/<pid>/stat line whose command name holds ") (": fields are
    // counted after the last ")", so field 22 (start ticks) is still found.
    function procRoot(options: { bootId?: string } = {}): string {
      const root = tempDir("stigmer-proc-");
      mkdirSync(join(root, "4242"));
      const afterName = ["S", ...Array.from({ length: 18 }, (_, i) => String(i + 4)), "987654", "123", "456"];
      writeFileSync(join(root, "4242", "stat"), `4242 (we) (ird) ${afterName.join(" ")}\n`);
      if (options.bootId !== undefined) {
        mkdirSync(join(root, "sys", "kernel", "random"), { recursive: true });
        writeFileSync(join(root, "sys", "kernel", "random", "boot_id"), `${options.bootId}\n`);
      }
      return root;
    }

    it("reads the boot id and the start ticks", () => {
      expect(processStartTime(4242, { procRoot: procRoot({ bootId: "b0b-1d" }) })).toBe("b0b-1d:987654");
    });

    it("reads the ticks alone where the boot id is hidden", () => {
      expect(processStartTime(4242, { procRoot: procRoot() })).toBe("987654");
    });

    it("falls back to ps for a PID it cannot read", () => {
      expect(processStartTime(DEAD_PID, { procRoot: procRoot() })).toBeNull();
      expect(processStartTime(process.pid, { procRoot: procRoot() })).toBe(processStartTime(process.pid, { procRoot: null }));
    });

    it("refuses a malformed stat line", () => {
      const root = tempDir("stigmer-proc-");
      mkdirSync(join(root, String(DEAD_PID)));
      writeFileSync(join(root, String(DEAD_PID), "stat"), `${DEAD_PID} (short) S 1 2\n`);
      expect(processStartTime(DEAD_PID, { procRoot: root })).toBeNull();
      writeFileSync(join(root, String(DEAD_PID), "stat"), "no name at all\n");
      expect(processStartTime(DEAD_PID, { procRoot: root })).toBeNull();
    });
  });
});

describe("processCommand", () => {
  // Names the holder of a port `stigmer up` refuses to start beside.
  it("reads a live process's command line, and null for a dead PID", () => {
    expect(processCommand(process.pid)).toContain(process.execPath.split("/").pop() ?? "node");
    expect(processCommand(DEAD_PID)).toBeNull();
  });
});

describe("health-state", () => {
  it("round-trips an atomic write/read", () => {
    const path = join(tempDir("stigmer-health-"), "health-state.json");
    const state: HealthState = {
      daemon_pid: 100,
      started_at: "2026-06-13T10:00:00.000Z",
      components: {
        "stigmer-server": { pid: 101, state: "running", started_at: "2026-06-13T10:00:01.000Z", restart_count: 0 },
        runner: { pid: 102, state: "unhealthy", started_at: "2026-06-13T10:00:02.000Z", restart_count: 1, last_error: "boom" },
      },
    };
    writeHealthState(path, state);
    expect(loadHealthState(path)).toEqual(state);
  });

  it("returns null for a missing or corrupt file", () => {
    const dir = tempDir("stigmer-health-");
    expect(loadHealthState(join(dir, "absent.json"))).toBeNull();
    const corrupt = join(dir, "corrupt.json");
    writeFileSync(corrupt, "{not json");
    expect(loadHealthState(corrupt)).toBeNull();
  });
});

describe("startup-config", () => {
  it("saves, loads, and removes", () => {
    const dir = tempDir("stigmer-startup-");
    const config: StartupConfig = {
      data_dir: dir,
      log_dir: join(dir, "logs"),
      temporal_addr: "127.0.0.1:7233",
      execution_mode: "local",
      sandbox_image: "",
      sandbox_auto_pull: false,
      sandbox_cleanup: true,
      sandbox_ttl: 0,
      stigmer_server_pid: 999,
      server_only: false,
    };
    saveStartupConfig(dir, config);
    expect(loadStartupConfig(dir)).toEqual(config);
    removeStartupConfig(dir);
    expect(loadStartupConfig(dir)).toBeNull();
  });

  it("loads a file carrying fields this CLI does not read (e.g. an llm_* trio)", () => {
    // The lenient-load contract oss#314 leans on: extra keys simply come
    // along and nothing consumes them.
    const dir = tempDir("stigmer-startup-");
    const onDisk = {
      data_dir: dir,
      log_dir: join(dir, "logs"),
      temporal_addr: "127.0.0.1:7233",
      llm_provider: "anthropic",
      llm_model: "claude",
      llm_base_url: "",
      execution_mode: "local",
      sandbox_image: "",
      sandbox_auto_pull: false,
      sandbox_cleanup: true,
      sandbox_ttl: 0,
      stigmer_server_pid: 999,
      server_only: false,
    };
    writeFileSync(join(dir, "startup-config.json"), JSON.stringify(onDisk));
    expect(loadStartupConfig(dir)).toMatchObject({ temporal_addr: "127.0.0.1:7233", stigmer_server_pid: 999 });
  });
});

describe("log-rotation", () => {
  it("rotates non-empty logs and leaves empty ones in place", () => {
    const dir = tempDir("stigmer-logs-");
    writeFileSync(join(dir, "daemon.log"), "some output\n");
    writeFileSync(join(dir, "runner.log"), ""); // empty — skipped
    const now = new Date("2026-06-13T14:15:02");

    const rotated = rotateLogs(dir, { now });

    expect(rotated).toBe(1);
    expect(() => statSync(join(dir, "daemon.log"))).toThrow(); // renamed away
    expect(statSync(join(dir, "daemon.log.2026-06-13-141502")).size).toBeGreaterThan(0);
    expect(statSync(join(dir, "runner.log")).size).toBe(0); // untouched
  });

  it("prunes archives older than the retention window but keeps recent ones", () => {
    const dir = tempDir("stigmer-logs-");
    const now = new Date("2026-06-13T00:00:00");

    const old = join(dir, "daemon.log.2026-05-01-000000");
    const recent = join(dir, "runner.err.2026-06-12-000000");
    writeFileSync(old, "old");
    writeFileSync(recent, "recent");
    const eightDaysAgo = now.getTime() / 1000 - 8 * 86400;
    utimesSync(old, eightDaysAgo, eightDaysAgo);

    const deleted = cleanupOldLogs(dir, 7, now);

    expect(deleted).toBe(1);
    expect(() => statSync(old)).toThrow();
    expect(statSync(recent).size).toBeGreaterThan(0);
  });
});

describe("lock", () => {
  it("grants the lock once and refuses a second live acquirer", () => {
    const path = join(tempDir("stigmer-lock-"), "temporal.lock");
    const first = acquireLock(path);
    expect(first).not.toBeNull();
    expect(readFileSync(path, "utf8").trim()).toBe(String(process.pid));

    // A second acquire while we (a live process) hold it must fail.
    expect(acquireLock(path)).toBeNull();

    first?.release();
    expect(acquireLock(path)).not.toBeNull();
  });

  it("reclaims a lock left behind by a dead process", () => {
    const path = join(tempDir("stigmer-lock-"), "temporal.lock");
    writeFileSync(path, `${DEAD_PID}\n`);
    const lock = acquireLock(path);
    expect(lock).not.toBeNull();
    expect(readFileSync(path, "utf8").trim()).toBe(String(process.pid));
  });

  // The container case: after an unclean stop the lock file on the volume names
  // the PID the daemon had last time — and a fresh PID namespace hands the
  // restarted daemon that same PID. We are not holding a lock we are trying to
  // acquire, so an owner equal to ourselves is stale by construction.
  it("reclaims a lock whose recorded owner is this very process (a previous life of the PID)", () => {
    const path = join(tempDir("stigmer-lock-"), "temporal.lock");
    writeFileSync(path, `${process.pid}\n`);
    const lock = acquireLock(path);
    expect(lock).not.toBeNull();
    lock?.release();
    expect(acquireLock(path)).not.toBeNull();
  });

  it("release is idempotent and only removes our own lock", () => {
    const path = join(tempDir("stigmer-lock-"), "temporal.lock");
    const lock = acquireLock(path);
    lock?.release();
    lock?.release(); // no throw
    expect(acquireLock(path)).not.toBeNull();
  });
});
