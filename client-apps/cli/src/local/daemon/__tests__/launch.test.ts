// Pins the foreground launcher's contract with the daemon body: the config it
// hands over is the detached shape's, encoded through the same env contract;
// the children inherit that built environment; the post-readiness work (the
// startup record, the caller's onReady, handed the providers the runner
// reaches) runs from onStarted; the daemon's exit code is the launcher's. Resolution is driven through the
// same overrides a container sets (STIGMER_SERVER_DIR, STIGMER_RUNNER_DIR,
// STIGMER_TEMPORAL_BIN), so nothing is downloaded or installed.
//
// And when the stack does not start, the launcher says why (stigmer#1845): the
// failure is read from this daemon's record of it, never an earlier run's;
// the detached wait ends the moment the daemon gives up; and a server port
// another program holds is refused before anything starts, naming the holder.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliExitError } from "../../../errors/cli-exit-error.js";
import { classify } from "../../../errors/classify.js";
import { formatError } from "../../../errors/handle.js";
import { HEALTH_STATE_FILE, SERVER_PORT } from "../../constants.js";
import { tcpConnects } from "../../net/tcp.js";
import { type HealthState, writeHealthState } from "../../state/health-state.js";
import { writePidFile } from "../../state/pidfile.js";
import { isProcessAlive } from "../../state/proc.js";
import { loadStartupConfig } from "../../state/startup-config.js";
import { DaemonEnvVar } from "../env.js";
import { type UpReport, down, startupFailure, upForeground, waitForStack } from "../launch.js";
import type { InternalDaemonDeps } from "../process.js";

// The launcher refuses to start beside a stack already serving on the server
// port — including a developer's own `stigmer up`. Report SKIPPED rather than
// a false failure in that case.
const serverPortBusy = await tcpConnects(SERVER_PORT, "127.0.0.1", 300);

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// A built package in the shape the resolvers accept: package.json + dist/main.js.
function builtPackage(prefix: string): string {
  const dir = tempDir(prefix);
  writeFileSync(join(dir, "package.json"), "{}");
  mkdirSync(join(dir, "dist"));
  writeFileSync(join(dir, "dist", "main.js"), "//");
  return dir;
}

const TOUCHED = [
  "STIGMER_SERVER_DIR",
  "STIGMER_RUNNER_DIR",
  "STIGMER_TEMPORAL_BIN",
  "STIGMER_NODE_BIN",
  "ANTHROPIC_API_KEY",
  // Every other variable the reach rule reads, so the shell's own cannot leak in.
  "ANTHROPIC_BASE_URL",
  "OPENAI_API_KEY",
  "STIGMER_ANTHROPIC_BACKEND",
  "STIGMER_OPENAI_BACKEND",
  "STIGMER_PROXY_ENDPOINT",
] as const;
let saved: Record<string, string | undefined>;


beforeEach(() => {
  saved = {};
  for (const key of TOUCHED) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.STIGMER_SERVER_DIR = builtPackage("stigmer-fg-server-");
  process.env.STIGMER_RUNNER_DIR = builtPackage("stigmer-fg-runner-");
  const temporalBin = join(tempDir("stigmer-fg-temporal-"), "temporal");
  writeFileSync(temporalBin, "#!/bin/sh\n");
  process.env.STIGMER_TEMPORAL_BIN = temporalBin;
});

afterEach(() => {
  for (const key of TOUCHED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe.skipIf(serverPortBusy)("upForeground", () => {
  it("runs the daemon body in-process with the detached shape's config and env, finishing from onStarted", async () => {
    const home = tempDir("stigmer-fg-home-");
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const order: string[] = [];
    let captured: InternalDaemonDeps | null = null;
    let reported: UpReport | null = null;
    const stop = new AbortController();

    const code = await upForeground({ noWeb: true }, home, {
      runDaemon: async (deps) => {
        captured = deps;
        order.push("daemon:started");
        await deps.onStarted?.();
        order.push("daemon:waiting");
        return 0;
      },
      onReady: (report) => {
        order.push("onReady");
        reported = report;
        stop.abort();
      },
      shutdown: stop.signal,
    });

    expect(code).toBe(0);
    expect(order).toEqual(["daemon:started", "onReady", "daemon:waiting"]);

    const deps = captured as unknown as InternalDaemonDeps;
    // The stop request is the caller's, handed through to the body.
    expect(deps.shutdown).toBe(stop.signal);
    // The config is the env contract read back — the detached daemon's view.
    expect(deps.config?.dataDir).toBe(join(home, ".stigmer", "data"));
    expect(deps.config?.temporalManaged).toBe(true);
    expect(deps.config?.noWeb).toBe(true);
    expect(deps.config?.server.entryPath).toBe(join(process.env.STIGMER_SERVER_DIR!, "dist", "main.js"));
    expect(deps.config?.runner?.entryPath).toBe(join(process.env.STIGMER_RUNNER_DIR!, "dist", "main.js"));
    expect(deps.config?.anthropicApiKey).toBe("sk-test");
    // The children inherit the built environment, contract variables included.
    expect(deps.env?.[DaemonEnvVar.DataDir]).toBe(join(home, ".stigmer", "data"));
    expect(deps.env?.[DaemonEnvVar.ServerEntry]).toBe(deps.config?.server.entryPath);
    // The card hears what the runner the daemon builds reaches.
    expect(reported).toEqual({ runnerReach: [{ provider: "anthropic", via: "key" }] });
    // The startup record names this process as the daemon.
    expect(loadStartupConfig(join(home, ".stigmer", "data"))?.stigmer_server_pid).toBe(process.pid);
  });

  it("propagates the daemon's failure exit code without reporting ready", async () => {
    const home = tempDir("stigmer-fg-home-");
    const onReady = vi.fn();

    const code = await upForeground({}, home, {
      // A critical component failed to start: the body returns 1 before onStarted.
      runDaemon: async () => 1,
      onReady,
      shutdown: new AbortController().signal,
    });

    expect(code).toBe(1);
    expect(onReady).not.toHaveBeenCalled();
    expect(loadStartupConfig(join(home, ".stigmer", "data"))).toBeNull();
  });

  it("omits the runner from the contract in server-only mode, and reports none", async () => {
    const home = tempDir("stigmer-fg-home-");
    process.env.OPENAI_API_KEY = "sk-oa";
    let captured: InternalDaemonDeps | null = null;
    const stop = new AbortController();
    const onReady = vi.fn(() => stop.abort());

    await upForeground({ serverOnly: true }, home, {
      runDaemon: async (deps) => {
        captured = deps;
        await deps.onStarted?.();
        return 0;
      },
      onReady,
      shutdown: stop.signal,
    });

    const deps = captured as unknown as InternalDaemonDeps;
    expect(deps.config?.serverOnly).toBe(true);
    expect(deps.config?.runner).toBeUndefined();
    expect(onReady).toHaveBeenCalledWith({ runnerReach: undefined });
  });
});

// ---- stigmer#1845: a stack that does not start says why. ----

// A snapshot as the daemon leaves it after a failed start.
function failedSnapshot(daemonPid: number, overrides: Partial<HealthState["components"]> = {}): HealthState {
  return {
    daemon_pid: daemonPid,
    started_at: "",
    components: {
      temporal: { pid: 4242, state: "running", started_at: "", restart_count: 0 },
      "stigmer-server": {
        pid: 4343,
        state: "failed",
        started_at: "",
        restart_count: 0,
        last_error: "the server exited with code 1 before it was ready",
        last_output: ["boot failed: schema version 14 is newer than this server supports (maximum 13)"],
      },
      runner: { pid: 0, state: "stopped", started_at: "", restart_count: 0 },
      ...overrides,
    },
  };
}

function dataWith(snapshot: HealthState): string {
  const data = tempDir("stigmer-fail-data-");
  writeHealthState(join(data, HEALTH_STATE_FILE), snapshot);
  return data;
}

describe("startupFailure", () => {
  it("names the failed component, how it ended, its last lines and where its log is", () => {
    const failure = startupFailure(dataWith(failedSnapshot(777)), 777);

    expect(failure).toBeInstanceOf(CliExitError);
    expect(failure?.message).toBe("stigmer-server did not start: the server exited with code 1 before it was ready");
    // As the one error exit point prints it.
    expect(formatError(classify(failure)!, false)).toBe(
      "Error: stigmer-server did not start: the server exited with code 1 before it was ready\n" +
        "\n" +
        "  boot failed: schema version 14 is newer than this server supports (maximum 13)\n" +
        "View stigmer-server logs: stigmer logs --component stigmer-server\n",
    );
  });

  it("names Temporal first when it is Temporal that failed", () => {
    const snapshot = failedSnapshot(777, {
      temporal: { pid: 0, state: "failed", started_at: "", restart_count: 0, last_error: "temporal dev server exited with code 1 before it was ready" },
    });
    const failure = startupFailure(dataWith(snapshot), 777);

    expect(failure?.message).toBe("temporal did not start: temporal dev server exited with code 1 before it was ready");
    expect(failure?.hints).toEqual(["View temporal logs: stigmer logs --component temporal"]);
  });

  it("never speaks for another daemon's run, and is silent with no failure or no record", () => {
    expect(startupFailure(dataWith(failedSnapshot(777)), 778)).toBeNull();
    expect(
      startupFailure(dataWith(failedSnapshot(777, { "stigmer-server": { pid: 1, state: "running", started_at: "", restart_count: 0 } })), 777),
    ).toBeNull();
    // A runner failure does not stop the stack, so it is not the reason.
    expect(
      startupFailure(
        dataWith(failedSnapshot(777, {
          "stigmer-server": { pid: 1, state: "running", started_at: "", restart_count: 0 },
          runner: { pid: 0, state: "failed", started_at: "", restart_count: 0, last_error: "x" },
        })),
        777,
      ),
    ).toBeNull();
    expect(startupFailure(tempDir("stigmer-fail-empty-"), 777)).toBeNull();
  });
});

// A real process standing in for the detached daemon, gone after `ms`.
function daemonExitingAfter(ms: number): { pid: number; gone: Promise<void> } {
  const child = spawn(process.execPath, ["-e", `setTimeout(() => process.exit(1), ${ms})`], { stdio: "ignore" });
  const gone = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  return { pid: child.pid!, gone };
}

// A port nothing listens on: bound once to learn a free number, then closed.
async function freePort(): Promise<number> {
  const server = await listen(0);
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function listen(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

describe("waitForStack", () => {
  it("ends the wait as soon as the daemon exits, with the failure it recorded", async () => {
    const daemon = daemonExitingAfter(200);
    const data = dataWith(failedSnapshot(daemon.pid));
    const started = Date.now();

    const waited = waitForStack({ data, logs: data, daemonPid: daemon.pid, port: await freePort(), timeoutMs: 30_000 });

    await expect(waited).rejects.toThrow("stigmer-server did not start: the server exited with code 1 before it was ready");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("says the daemon died, pointing at its log, when it recorded nothing", async () => {
    const daemon = daemonExitingAfter(50);
    await daemon.gone;
    const data = tempDir("stigmer-fail-data-");

    const waited = waitForStack({ data, logs: data, daemonPid: daemon.pid, port: await freePort(), timeoutMs: 30_000 });

    await expect(waited).rejects.toMatchObject({
      message: "daemon process crashed during startup",
      hints: [`Check ${join(data, "daemon.log")} for details.`],
    });
  });

  it("says the wait ran out when the daemon lives on with nothing failed", async () => {
    const data = tempDir("stigmer-fail-data-");

    const waited = waitForStack({ data, logs: data, daemonPid: process.pid, port: await freePort(), timeoutMs: 300 });

    await expect(waited).rejects.toThrow("stigmer-server did not become ready within 300ms");
  });

  it("returns once the server answers", async () => {
    const server = await listen(0);
    const { port } = server.address() as AddressInfo;
    try {
      await waitForStack({ data: tempDir("stigmer-ok-"), logs: "", daemonPid: process.pid, port, timeoutMs: 5_000 });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("upForeground (a held server port)", () => {
  it("refuses before starting anything, naming the holder", async () => {
    const holder = await listen(0);
    const { port } = holder.address() as AddressInfo;
    const runDaemon = vi.fn(async () => 0);
    try {
      const started = upForeground({}, tempDir("stigmer-fg-home-"), { runDaemon, serverPort: port, shutdown: new AbortController().signal });
      // The holder is this very process; `lsof` names it where it can.
      await expect(started).rejects.toThrow(new RegExp(`^port ${port} is already in use( by pid ${process.pid} \\(.+\\))?$`));
    } finally {
      await new Promise<void>((resolve) => holder.close(() => resolve()));
    }
    expect(runDaemon).not.toHaveBeenCalled();
  });
});

// ---- stigmer#1175: nothing outlives a stopped stack, and `up` never touches a
// running one. ----

// A real process standing in for a leftover from a daemon that died without its
// teardown. It is ready once its SIGTERM handler is installed; on SIGTERM it
// exits after a short delay, as a server draining its connections does, or
// ignores it altogether.
const leftovers: number[] = [];
async function leftover(onTerm: "exit-after-a-moment" | "ignore", options: { detached?: boolean } = {}): Promise<number> {
  const handler = onTerm === "ignore" ? "() => {}" : "() => setTimeout(() => process.exit(0), 300)";
  const child = spawn(
    process.execPath,
    ["-e", `process.on("SIGTERM", ${handler}); process.stdout.write("ready\\n"); setInterval(() => {}, 1000);`],
    { stdio: ["ignore", "pipe", "ignore"], detached: options.detached === true },
  );
  await new Promise<void>((resolve) => child.stdout.once("data", () => resolve()));
  leftovers.push(child.pid!);
  return child.pid!;
}

// The PID of a process that has already exited.
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  return child.pid!;
}

afterEach(() => {
  for (const pid of leftovers.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
});

// The ~/.stigmer layout of a home whose daemon is gone, its files left behind.
function homeWithRecords(records: { daemon: number; server?: number; runner?: number; temporal?: number }): { home: string; data: string } {
  const home = tempDir("stigmer-left-home-");
  const data = join(home, ".stigmer", "data");
  mkdirSync(data, { recursive: true });
  writePidFile(join(data, "daemon.pid"), records.daemon);
  if (records.server !== undefined) writePidFile(join(data, "stigmer-server.pid"), records.server);
  if (records.runner !== undefined) writePidFile(join(data, "runner.pid"), records.runner);
  if (records.temporal !== undefined) writePidFile(join(home, ".stigmer", "temporal.pid"), records.temporal);
  return { home, data };
}

describe("down (after a daemon that died without its teardown)", () => {
  it("stops the recorded children and Temporal, and returns only once the children are gone", async () => {
    const server = await leftover("exit-after-a-moment");
    const runner = await leftover("exit-after-a-moment");
    const temporal = await leftover("exit-after-a-moment", { detached: true });
    const { home, data } = homeWithRecords({ daemon: await deadPid(), server, runner, temporal });

    expect(await down(home)).toBe(false);

    expect(isProcessAlive(server)).toBe(false);
    expect(isProcessAlive(runner)).toBe(false);
    await expect.poll(() => isProcessAlive(temporal)).toBe(false);
    for (const file of ["daemon.pid", "stigmer-server.pid", "runner.pid"]) expect(existsSync(join(data, file))).toBe(false);
  });

  it("force-kills a leftover that ignores SIGTERM", async () => {
    const runner = await leftover("ignore");
    const { home } = homeWithRecords({ daemon: await deadPid(), runner });

    await down(home);

    expect(isProcessAlive(runner)).toBe(false);
  });
});

describe("down (a running daemon)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops the daemon and reports it stopped once it has exited", async () => {
    const daemon = await leftover("exit-after-a-moment");
    const { home, data } = homeWithRecords({ daemon });

    expect(await down(home)).toBe(true);

    expect(isProcessAlive(daemon)).toBe(false);
    expect(existsSync(join(data, "daemon.pid"))).toBe(false);
  });

  it("force-kills a daemon that does not stop within its grace", async () => {
    const daemon = await leftover("ignore");
    const { home } = homeWithRecords({ daemon });
    // Only the clock the grace reads is faked; it jumps past the grace.
    vi.useFakeTimers({ toFake: ["Date"] });
    setTimeout(() => vi.setSystemTime(Date.now() + 60_000), 300);

    expect(await down(home)).toBe(true);

    vi.useRealTimers();
    await expect.poll(() => isProcessAlive(daemon)).toBe(false);
  });
});

describe("upForeground (a stack already on record)", () => {
  it("refuses beside a running stack, signalling nothing", async () => {
    const daemon = await leftover("exit-after-a-moment");
    const { home, data } = homeWithRecords({ daemon });
    const runDaemon = vi.fn(async () => 0);

    const started = upForeground({}, home, { runDaemon, serverPort: await freePort(), shutdown: new AbortController().signal });

    await expect(started).rejects.toMatchObject({
      message: `the local Stigmer stack is already running (daemon pid ${daemon})`,
      hints: ["Stop it with: stigmer down"],
    });
    expect(runDaemon).not.toHaveBeenCalled();
    // Long enough for a SIGTERM, had one been sent, to have ended it.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(isProcessAlive(daemon)).toBe(true);
    expect(existsSync(join(data, "daemon.pid"))).toBe(true);
  });

  it("sweeps a dead daemon's leftovers, waiting until they are gone, then starts", async () => {
    const server = await leftover("exit-after-a-moment");
    const { home } = homeWithRecords({ daemon: await deadPid(), server });
    let serverAliveAtStart: boolean | null = null;

    const code = await upForeground({}, home, {
      runDaemon: async () => {
        serverAliveAtStart = isProcessAlive(server);
        return 0;
      },
      serverPort: await freePort(),
      shutdown: new AbortController().signal,
    });

    expect(code).toBe(0);
    expect(serverAliveAtStart).toBe(false);
  });
});
