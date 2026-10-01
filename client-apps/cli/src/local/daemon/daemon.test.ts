import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../logger.js";
import { RUNNER_READY_MARKER, SERVER_PORT } from "../constants.js";
import { isProcessAlive } from "../state/proc.js";
import { loadHealthState, type HealthState } from "../state/health-state.js";
import { readPidFile } from "../state/pidfile.js";
import type { DaemonConfig } from "./env.js";
import { NodeProcessHost } from "./host.js";
import { runInternalDaemon, type TemporalControl } from "./process.js";
import type { ChildHandle, Clock, ExitInfo, ProcessHost, SpawnRequest } from "./types.js";

const silent: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "stigmer-int-"));
}

// ---- Integration 1: the real ProcessHost spawns, tees logs, detects the
// readiness marker, and stops a real child. ----
describe("NodeProcessHost (real spawn)", () => {
  it("pipes logs, detects the readiness marker, and stops the child", async () => {
    const dir = tempDir();
    const script = join(dir, "fake-child.cjs");
    writeFileSync(
      script,
      `process.stdout.write(${JSON.stringify(`${RUNNER_READY_MARKER}\n`)});\n` +
        `process.on("SIGTERM", () => process.exit(0));\n` +
        `setInterval(() => {}, 1000);\n`,
    );
    const logFile = join(dir, "child.log");

    const host = new NodeProcessHost();
    const request: SpawnRequest = {
      name: "runner",
      command: process.execPath,
      args: [script],
      env: process.env,
      logFile,
      readinessMarker: RUNNER_READY_MARKER,
    };
    const handle = host.spawn(request);

    const ready = new Promise<void>((resolve) => handle.onReady(resolve));
    const exited = new Promise<void>((resolve) => handle.onExit(() => resolve()));

    await ready;
    expect(isProcessAlive(handle.pid)).toBe(true);
    // The readiness marker is detected on the stdout stream, but the tee to the
    // log file is a buffered write that may not have flushed to disk yet — poll
    // the file rather than reading it once to avoid a race.
    await expect.poll(() => readFileSync(logFile, "utf8")).toContain(RUNNER_READY_MARKER);

    handle.kill("SIGTERM");
    await exited;
    expect(handle.hasExited()).toBe(true);
  });

  // The foreground launcher's window into the children: every complete line,
  // tagged with the component, in order within a stream; a partial trailing
  // line is delivered at exit; the log file still receives the same bytes.
  it("mirrors complete lines tagged with the component, flushing the tail at exit", async () => {
    const dir = tempDir();
    const script = join(dir, "chatty-child.cjs");
    writeFileSync(
      script,
      // Two writes that split a line across chunks, one stderr line, and a
      // final line with no newline.
      `process.stdout.write("first li");\n` +
        `process.stdout.write("ne\\nsecond line\\n");\n` +
        `process.stderr.write("a warning\\n");\n` +
        `process.stdout.write("tail without newline");\n` +
        `setTimeout(() => process.exit(0), 50);\n`,
    );
    const logFile = join(dir, "child.log");
    const mirrored: string[] = [];
    const host = new NodeProcessHost({ mirror: (component, line) => mirrored.push(`${component}|${line}`) });

    const handle = host.spawn({ name: "stigmer-server", command: process.execPath, args: [script], env: process.env, logFile });
    await new Promise<void>((resolve) => handle.onExit(() => resolve()));

    expect(mirrored.filter((l) => l !== "stigmer-server|a warning")).toEqual([
      "stigmer-server|first line",
      "stigmer-server|second line",
      "stigmer-server|tail without newline",
    ]);
    expect(mirrored).toContain("stigmer-server|a warning");
    await expect.poll(() => readFileSync(logFile, "utf8")).toContain("first line\nsecond line\n");
  });
});

// ---- Integration 2: the full daemon body, with a fake process host + fake
// Temporal, but a real TCP listener satisfying the server's gRPC gate. ----

// Minimal fake host whose children exit on SIGTERM.
class FakeHost implements ProcessHost {
  private nextPid = 2000;
  readonly killed: NodeJS.Signals[] = [];
  spawn(_request: SpawnRequest): ChildHandle {
    let exited = false;
    let exitCb: ((info: ExitInfo) => void) | null = null;
    const pid = this.nextPid++;
    return {
      pid,
      hasExited: () => exited,
      onExit: (cb) => {
        exitCb = cb;
      },
      onReady: () => {},
      kill: (signal) => {
        this.killed.push(signal);
        if (!exited) {
          exited = true;
          exitCb?.({ code: null, signal });
        }
      },
    };
  }
}

const fastClock: Clock = { now: () => Date.now(), sleep: () => Promise.resolve() };

function fakeTemporal(): TemporalControl {
  return {
    address: "127.0.0.1:7233",
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    isRunning: vi.fn(async () => true),
    getPid: () => 4242,
    startSupervisor: vi.fn(),
    stopSupervisor: vi.fn(),
  };
}

function listenOn(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

let gateServer: Server | null = null;
afterEach(async () => {
  if (gateServer !== null) {
    await new Promise<void>((resolve) => gateServer?.close(() => resolve()));
    gateServer = null;
  }
});

describe("runInternalDaemon (full body with fakes)", () => {
  it("brings the stack up, writes a health snapshot, and tears down on shutdown", async () => {
    const data = join(tempDir(), ".stigmer", "data");
    const config: DaemonConfig = {
      dataDir: data,
      logDir: join(data, "logs"),
      temporalManaged: true,
      temporalAddress: "127.0.0.1:7233",
      serverOnly: false,
      noWeb: true,
      server: { nodeBin: "node-cmd", entryPath: join(data, "server-entry.js"), appDir: data },
      runner: { nodeBin: "node-cmd", entryPath: join(data, "entry.js"), appDir: data },
    };

    // Satisfy the server's gRPC readiness gate with a real listener.
    try {
      gateServer = await listenOn(SERVER_PORT);
    } catch {
      // Port busy (a real daemon?) — the gate will still connect to whatever is
      // listening, which is all this test needs.
    }

    const host = new FakeHost();
    const temporal = fakeTemporal();
    const healthPath = join(data, "health-state.json");

    let snapshot: HealthState | null = null;
    let resolveShutdown!: () => void;
    const shutdown = new Promise<void>((resolve) => {
      resolveShutdown = resolve;
    });

    const code = await runInternalDaemon({
      config,
      host,
      clock: fastClock,
      temporal,
      log: silent,
      waitForShutdown: () => shutdown,
      onStarted: () => {
        snapshot = loadHealthState(healthPath);
        resolveShutdown();
      },
    });

    expect(code).toBe(0);
    expect(temporal.start).toHaveBeenCalledOnce();
    expect(temporal.stop).toHaveBeenCalledOnce();

    // The snapshot captured while up shows the whole stack.
    expect(snapshot).not.toBeNull();
    const components = snapshot as unknown as HealthState;
    expect(components.daemon_pid).toBe(process.pid);
    expect(Object.keys(components.components).sort()).toEqual(["runner", "stigmer-server", "temporal", "web-console"]);
    expect(components.components["stigmer-server"].state).toBe("running");
    expect(components.components.runner.state).toBe("running");

    // Children were signaled, and the daemon cleaned up after shutdown.
    expect(host.killed).toContain("SIGTERM");
    expect(readPidFile(join(data, "daemon.pid"))).toBeNull();
    expect(loadHealthState(healthPath)).toBeNull();
  });
});
