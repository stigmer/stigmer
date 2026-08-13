import { mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type HealthState, loadHealthState, writeHealthState } from "./health-state.js";
import { acquireLock } from "./lock.js";
import { cleanupOldLogs, rotateLogs } from "./log-rotation.js";
import { readPidFile, removePidFile, writePidFile } from "./pidfile.js";
import { isProcessAlive } from "./proc.js";
import { loadStartupConfig, removeStartupConfig, saveStartupConfig, type StartupConfig } from "./startup-config.js";

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

describe("isProcessAlive", () => {
  it("is true for the current process and false for a dead PID", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(DEAD_PID)).toBe(false);
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
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

  it("loads files written by older CLIs carrying since-removed fields (e.g. the llm_* trio)", () => {
    // The lenient-load contract oss#314 leans on: no migration for on-disk
    // files — extra keys simply come along and nothing consumes them.
    const dir = tempDir("stigmer-startup-");
    const legacy = {
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
    writeFileSync(join(dir, "startup-config.json"), JSON.stringify(legacy));
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

  it("release is idempotent and only removes our own lock", () => {
    const path = join(tempDir("stigmer-lock-"), "temporal.lock");
    const lock = acquireLock(path);
    lock?.release();
    lock?.release(); // no throw
    expect(acquireLock(path)).not.toBeNull();
  });
});
