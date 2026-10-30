import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../../logger.js";
import { RUNNER_READY_MARKER, SERVER_PORT } from "../../constants.js";
import { tcpConnects } from "../../net/tcp.js";
import { isProcessAlive } from "../../state/proc.js";
import { loadHealthState, type HealthState } from "../../state/health-state.js";
import { readPidFile } from "../../state/pidfile.js";
import type { DaemonConfig } from "../env.js";
import { NodeProcessHost } from "../host.js";
import { runInternalDaemon, type TemporalControl } from "../process.js";
import { SETTLE_DELAY_MS } from "../supervisor.js";
import type { ChildHandle, Clock, ExitInfo, ProcessHost, SpawnRequest } from "../types.js";

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

// Minimal fake host whose children exit on SIGTERM, each with the stderr tail
// the test gives its component; `onSpawn` lets a test act the moment a
// component starts.
class FakeHost implements ProcessHost {
  private nextPid = 2000;
  readonly killed: NodeJS.Signals[] = [];
  readonly spawned: string[] = [];
  /** The components signalled, in order. */
  readonly stopped: string[] = [];
  onSpawn: (name: string) => void = () => {};
  constructor(private readonly stderr: Record<string, string[]> = {}) {}
  spawn(request: SpawnRequest): ChildHandle {
    let exited: ExitInfo | null = null;
    let exitCb: ((info: ExitInfo) => void) | null = null;
    const pid = this.nextPid++;
    this.spawned.push(request.name);
    this.onSpawn(request.name);
    return {
      pid,
      hasExited: () => exited !== null,
      exitInfo: () => exited,
      stderrTail: () => this.stderr[request.name] ?? [],
      onExit: (cb) => {
        exitCb = cb;
      },
      onReady: () => {},
      kill: (signal) => {
        this.killed.push(signal);
        this.stopped.push(request.name);
        if (exited === null) {
          exited = { code: null, signal };
          exitCb?.(exited);
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

// The listeners' open connections, dropped before closing: a probe cut short
// can leave one behind, and close() would wait for it.
const openSockets = new Set<Socket>();

function listenOn(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => {
      openSockets.add(socket);
      socket.once("close", () => openSockets.delete(socket));
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function stackConfig(serverOnly: boolean): DaemonConfig {
  const data = join(tempDir(), ".stigmer", "data");
  return {
    dataDir: data,
    logDir: join(data, "logs"),
    temporalManaged: true,
    temporalAddress: "127.0.0.1:7233",
    serverOnly,
    noWeb: true,
    server: { nodeBin: "node-cmd", entryPath: join(data, "server-entry.js"), appDir: data },
    ...(serverOnly ? {} : { runner: { nodeBin: "node-cmd", entryPath: join(data, "entry.js"), appDir: data } }),
  };
}

// Nothing the daemon wrote is left once it has stopped.
function expectNothingLeft(data: string): void {
  for (const file of ["daemon.pid", "stigmer-server.pid", "runner.pid"]) expect(readPidFile(join(data, file))).toBeNull();
  expect(loadHealthState(join(data, "health-state.json"))).toBeNull();
}

let gateServer: Server | null = null;
afterEach(async () => {
  if (gateServer !== null) {
    for (const socket of openSockets) socket.destroy();
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
    const stop = new AbortController();

    const code = await runInternalDaemon({
      config,
      host,
      clock: fastClock,
      temporal,
      log: silent,
      shutdown: stop.signal,
      onStarted: () => {
        snapshot = loadHealthState(healthPath);
        // Asked for once the body is waiting, as a later `stigmer down` is.
        setTimeout(() => stop.abort(), 10);
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

// stigmer#1845: a server that never opens its port fails the gate while still
// running. The daemon stops it before giving up, so nothing is left holding the
// port, and leaves the snapshot saying why, for `stigmer up` to print.
const serverPortBusy = await tcpConnects(SERVER_PORT, "127.0.0.1", 300);

describe.skipIf(serverPortBusy)("runInternalDaemon (a server that hangs past its gate)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops the hung server, keeps it failed with its last lines, and stops Temporal", async () => {
    const data = join(tempDir(), ".stigmer", "data");
    const config: DaemonConfig = {
      dataDir: data,
      logDir: join(data, "logs"),
      temporalManaged: true,
      temporalAddress: "127.0.0.1:7233",
      serverOnly: true,
      noWeb: true,
      server: { nodeBin: "node-cmd", entryPath: join(data, "server-entry.js"), appDir: data },
    };
    const host = new FakeHost({ "stigmer-server": ["waiting for the database…"] });
    const temporal = fakeTemporal();

    // Only the clock the gate's deadline reads is faked: the gate polls the
    // real (closed) port, and the clock jumps past its deadline meanwhile.
    vi.useFakeTimers({ toFake: ["Date"] });
    setTimeout(() => vi.setSystemTime(Date.now() + 60_000), 300);

    const code = await runInternalDaemon({ config, host, clock: fastClock, temporal, log: silent, shutdown: new AbortController().signal });

    expect(code).toBe(1);
    expect(host.spawned).toEqual(["stigmer-server"]);
    expect(host.killed).toEqual(["SIGTERM"]);
    expect(temporal.stop).toHaveBeenCalledOnce();
    expect(readPidFile(join(data, "stigmer-server.pid"))).toBeNull();
    expect(loadHealthState(join(data, "health-state.json"))?.components["stigmer-server"]).toMatchObject({
      state: "failed",
      last_error: "the server did not become ready within 30000ms",
      last_output: ["waiting for the database…"],
    });
  });
});

describe("runInternalDaemon (Temporal does not start)", () => {
  it("records Temporal failed with its error's own message, starting nothing else", async () => {
    const data = join(tempDir(), ".stigmer", "data");
    const config: DaemonConfig = {
      dataDir: data,
      logDir: join(data, "logs"),
      temporalManaged: true,
      temporalAddress: "127.0.0.1:7233",
      serverOnly: true,
      noWeb: true,
      server: { nodeBin: "node-cmd", entryPath: join(data, "server-entry.js"), appDir: data },
    };
    const host = new FakeHost();
    const temporal = fakeTemporal();
    temporal.start = vi.fn(async () => {
      throw new Error("temporal dev server exited with code 1 before it was ready");
    });

    const code = await runInternalDaemon({ config, host, clock: fastClock, temporal, log: silent, shutdown: new AbortController().signal });

    expect(code).toBe(1);
    expect(host.spawned).toEqual([]);
    expect(loadHealthState(join(data, "health-state.json"))?.components.temporal).toMatchObject({
      state: "failed",
      last_error: "temporal dev server exited with code 1 before it was ready",
    });
  });
});

// stigmer#1175: a stop asked for while the stack is still starting is honoured
// at once: whatever started is stopped in reverse, nothing is left behind, the
// stop is not a failure, and the stack is never reported started.
describe("runInternalDaemon (stopped while starting)", () => {
  it("starts nothing when the stop came before Temporal", async () => {
    const config = stackConfig(false);
    const host = new FakeHost();
    const temporal = fakeTemporal();

    const code = await runInternalDaemon({ config, host, clock: fastClock, temporal, log: silent, shutdown: AbortSignal.abort() });

    expect(code).toBe(0);
    expect(temporal.start).not.toHaveBeenCalled();
    expect(temporal.stop).not.toHaveBeenCalled();
    expect(host.spawned).toEqual([]);
    expectNothingLeft(config.dataDir);
  });

  it("stops Temporal, starting nothing else, when the stop comes while Temporal starts", async () => {
    const config = stackConfig(false);
    const host = new FakeHost();
    const temporal = fakeTemporal();
    const stop = new AbortController();
    temporal.start = vi.fn(async () => {
      stop.abort();
    });

    const code = await runInternalDaemon({ config, host, clock: fastClock, temporal, log: silent, shutdown: stop.signal });

    expect(code).toBe(0);
    expect(host.spawned).toEqual([]);
    expect(temporal.stop).toHaveBeenCalledOnce();
    expectNothingLeft(config.dataDir);
  });

  it("still finishes the teardown when Temporal does not stop cleanly", async () => {
    const config = stackConfig(true);
    try {
      gateServer = await listenOn(SERVER_PORT);
    } catch {
      // Port busy: the gate connects to whatever listens, which is all it needs.
    }
    const host = new FakeHost();
    const temporal = fakeTemporal();
    temporal.stop = vi.fn(async () => {
      throw new Error("temporal did not exit");
    });
    const log: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const stop = new AbortController();

    // The stop lands while the started stack is being reported (a Ctrl-C as
    // the foreground card renders).
    const code = await runInternalDaemon({ config, host, clock: fastClock, temporal, log, shutdown: stop.signal, onStarted: () => stop.abort() });

    expect(code).toBe(0);
    expect(log.warn).toHaveBeenCalledWith("failed to stop managed Temporal cleanly", { error: "Error: temporal did not exit" });
    expect(host.stopped).toEqual(["stigmer-server"]);
    expectNothingLeft(config.dataDir);
  });

  it("stops every child in reverse during the settle, never reporting started", async () => {
    const config = stackConfig(false);
    try {
      gateServer = await listenOn(SERVER_PORT);
    } catch {
      // Port busy: the gate connects to whatever listens, which is all it needs.
    }
    const host = new FakeHost();
    const temporal = fakeTemporal();
    const stop = new AbortController();
    const settleClock: Clock = {
      now: () => Date.now(),
      sleep: (ms) => {
        if (ms === SETTLE_DELAY_MS) stop.abort();
        return Promise.resolve();
      },
    };
    const onStarted = vi.fn();

    const code = await runInternalDaemon({ config, host, clock: settleClock, temporal, log: silent, shutdown: stop.signal, onStarted });

    expect(code).toBe(0);
    expect(onStarted).not.toHaveBeenCalled();
    expect(host.stopped).toEqual(["runner", "stigmer-server"]);
    expect(temporal.stopSupervisor).toHaveBeenCalledOnce();
    expect(temporal.stop).toHaveBeenCalledOnce();
    expectNothingLeft(config.dataDir);
  });
});

describe.skipIf(serverPortBusy)("runInternalDaemon (stopped while the server's gate waits)", () => {
  it("stops the server within a poll, starts no runner, stops Temporal and records no failure", async () => {
    const config = stackConfig(false);
    const host = new FakeHost();
    const temporal = fakeTemporal();
    const stop = new AbortController();
    host.onSpawn = (name) => {
      if (name === "stigmer-server") setTimeout(() => stop.abort(), 50);
    };
    const log: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const started = Date.now();

    const code = await runInternalDaemon({ config, host, clock: fastClock, temporal, log, shutdown: stop.signal });

    expect(code).toBe(0);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(host.spawned).toEqual(["stigmer-server"]);
    expect(host.killed).toEqual(["SIGTERM"]);
    expect(temporal.stop).toHaveBeenCalledOnce();
    expect(log.error).not.toHaveBeenCalled();
    expectNothingLeft(config.dataDir);
  });

  it("cuts the console probe short, never reporting started", async () => {
    const config = { ...stackConfig(false), noWeb: false };
    // Accepts and never answers, so the probe would wait out its own timeout.
    gateServer = await listenOn(SERVER_PORT);
    const host = new FakeHost();
    const temporal = fakeTemporal();
    const stop = new AbortController();
    const settleClock: Clock = {
      now: () => Date.now(),
      sleep: (ms) => {
        if (ms === SETTLE_DELAY_MS) setTimeout(() => stop.abort(), 50);
        return Promise.resolve();
      },
    };
    const onStarted = vi.fn();
    const started = Date.now();

    const code = await runInternalDaemon({ config, host, clock: settleClock, temporal, log: silent, shutdown: stop.signal, onStarted });

    expect(code).toBe(0);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(onStarted).not.toHaveBeenCalled();
    expect(host.stopped).toEqual(["runner", "stigmer-server"]);
    expectNothingLeft(config.dataDir);
  });
});
