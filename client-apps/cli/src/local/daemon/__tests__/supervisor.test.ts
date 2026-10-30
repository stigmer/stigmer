import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../../logger.js";
import type { HealthState } from "../../state/health-state.js";
import { readPidFile } from "../../state/pidfile.js";
import { MAX_RESTARTS, ProcessSupervisor } from "../supervisor.js";
import type { ChildHandle, Clock, ComponentSpec, ExitInfo, ProcessHost, ReadinessGate, SpawnRequest } from "../types.js";

const silent: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

// A controllable fake child: the test triggers its exit/readiness and inspects
// the signals it received.
interface FakeChild {
  request: SpawnRequest;
  handle: ChildHandle;
  signals: NodeJS.Signals[];
  termExits: boolean;
  /** What the child has written to stderr, as the host's tail holds it. */
  stderr: string[];
  triggerExit(info?: ExitInfo): void;
  triggerReady(): void;
}

class FakeHost implements ProcessHost {
  readonly children: FakeChild[] = [];
  readonly killOrder: string[] = [];
  private nextPid = 1000;

  spawn(request: SpawnRequest): ChildHandle {
    let exited: ExitInfo | null = null;
    let exitCb: ((info: ExitInfo) => void) | null = null;
    let readyCb: (() => void) | null = null;
    const signals: NodeJS.Signals[] = [];
    const pid = this.nextPid++;
    const order = this.killOrder;

    const child: FakeChild = {
      request,
      signals,
      termExits: true,
      stderr: [],
      triggerExit: (info = { code: 1, signal: null }) => {
        if (exited === null) {
          exited = info;
          exitCb?.(info);
        }
      },
      triggerReady: () => readyCb?.(),
      handle: {
        pid,
        hasExited: () => exited !== null,
        exitInfo: () => exited,
        stderrTail: () => child.stderr,
        onExit: (cb) => {
          exitCb = cb;
        },
        onReady: (cb) => {
          readyCb = cb;
        },
        kill: (signal) => {
          signals.push(signal);
          order.push(request.command);
          if (signal === "SIGKILL" || (signal === "SIGTERM" && child.termExits)) {
            if (exited === null) {
              exited = { code: null, signal };
              exitCb?.(exited);
            }
          }
        },
      },
    };
    this.children.push(child);
    return child.handle;
  }

  /** The most-recently-spawned child for a component command. */
  latest(command: string): FakeChild {
    const matches = this.children.filter((c) => c.request.command === command);
    return matches[matches.length - 1];
  }

  countOf(command: string): number {
    return this.children.filter((c) => c.request.command === command).length;
  }
}

class FakeClock implements Clock {
  t = 1_000_000;
  now(): number {
    return this.t;
  }
  sleep(): Promise<void> {
    return Promise.resolve();
  }
}

const okGate: ReadinessGate = { description: "ok", wait: async () => {} };
const failGate: ReadinessGate = {
  description: "fail",
  wait: async () => {
    throw new Error("did not become ready");
  },
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stigmer-sup-"));
});

function spec(name: string, opts: { critical?: boolean; marker?: string; gate?: ReadinessGate } = {}): ComponentSpec {
  return {
    name,
    pidFile: join(dir, `${name}.pid`),
    critical: opts.critical ?? false,
    resolve: () => ({ name, command: name, args: [], env: {}, logFile: join(dir, `${name}.log`), readinessMarker: opts.marker }),
    gate: opts.gate,
  };
}

function emptyHealth(): HealthState {
  return { daemon_pid: 1, started_at: "", components: {} };
}

function makeSupervisor(
  specs: ComponentSpec[],
  extras: { probe?: (port: number) => Promise<boolean> } = {},
): { sup: ProcessSupervisor; host: FakeHost; clock: FakeClock; hs: HealthState } {
  const host = new FakeHost();
  const clock = new FakeClock();
  const hs = emptyHealth();
  const sup = new ProcessSupervisor(specs, { host, clock, healthState: hs, persist: () => {}, log: silent, probe: extras.probe });
  return { sup, host, clock, hs };
}

describe("startAll", () => {
  it("starts components in order, writes PID files, and gates the server", async () => {
    const { sup, host, hs } = makeSupervisor([spec("stigmer-server", { critical: true, gate: okGate }), spec("runner", { marker: "ready" })]);
    const result = await sup.startAll();

    expect(result.ok).toBe(true);
    expect(hs.components["stigmer-server"].state).toBe("running");
    expect(hs.components.runner.state).toBe("running");
    expect(readPidFile(join(dir, "stigmer-server.pid"))).toBe(host.latest("stigmer-server").handle.pid);
    expect(readPidFile(join(dir, "runner.pid"))).toBe(host.latest("runner").handle.pid);
  });

  it("aborts when a critical component fails its gate", async () => {
    const { sup, hs } = makeSupervisor([spec("stigmer-server", { critical: true, gate: failGate }), spec("runner")]);
    const result = await sup.startAll();

    expect(result.ok).toBe(false);
    expect(result.failedCritical).toBe("stigmer-server");
    expect(hs.components["stigmer-server"].state).toBe("failed");
    // The runner is registered up front but never started after the abort.
    expect(hs.components.runner.state).toBe("stopped");
  });

  // stigmer#1845: the record says why, in the child's own words, so `up` and
  // `status` can say it too.
  it("records the gate's error and the child's last stderr lines when the server exits before ready", async () => {
    const exitGate: ReadinessGate = {
      description: "exits",
      wait: async (handle) => {
        host.latest("stigmer-server").stderr = ["boot failed: schema version 14 is newer than this server supports"];
        host.latest("stigmer-server").triggerExit({ code: 1, signal: null });
        throw new Error(`the server exited with code ${handle.exitInfo()?.code} before it was ready`);
      },
    };
    const { sup, host, hs } = makeSupervisor([spec("stigmer-server", { critical: true, gate: exitGate })]);
    const result = await sup.startAll();

    expect(result.failedCritical).toBe("stigmer-server");
    expect(hs.components["stigmer-server"]).toMatchObject({
      state: "failed",
      last_error: "the server exited with code 1 before it was ready",
      last_output: ["boot failed: schema version 14 is newer than this server supports"],
    });
  });

  it("records the last stderr lines of a server that hangs past its gate", async () => {
    const { sup, host, hs } = makeSupervisor([spec("stigmer-server", { critical: true, gate: failGate })]);
    const started = sup.startAll();
    host.latest("stigmer-server").stderr = ["waiting for the database…"];
    await started;

    expect(hs.components["stigmer-server"].last_error).toBe("did not become ready");
    expect(hs.components["stigmer-server"].last_output).toEqual(["waiting for the database…"]);
  });

  it("records no output for a component that could not be spawned", async () => {
    const broken: ComponentSpec = {
      ...spec("stigmer-server", { critical: true }),
      resolve: () => {
        throw new Error("server entry not found");
      },
    };
    const { sup, hs } = makeSupervisor([broken]);
    await sup.startAll();

    expect(hs.components["stigmer-server"].last_error).toBe("server entry not found");
    expect(hs.components["stigmer-server"].last_output).toBeUndefined();
  });
});

// stigmer#1175: a stop asked for while a component is still starting is
// honoured at once, by the supervisor that owns the child, and is not a failure.
describe("startAll, stopped while starting", () => {
  // A gate like the server's: it fails as soon as its child exits, and
  // otherwise gives up after a short deadline.
  const exitWatchingGate: ReadinessGate = {
    description: "exit-watching",
    wait: async (handle) => {
      const deadline = Date.now() + 500;
      while (Date.now() < deadline) {
        if (handle.hasExited()) throw new Error("the server exited before it was ready");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("did not become ready");
    },
  };

  it("stops the child its gate waits on, starts nothing more, and records no failure", async () => {
    const { sup, host, hs } = makeSupervisor([
      spec("stigmer-server", { critical: true, gate: exitWatchingGate }),
      spec("runner"),
    ]);
    const stop = new AbortController();
    const started = sup.startAll(stop.signal);
    stop.abort();
    const result = await started;

    expect(result).toEqual({ ok: false, stopped: true });
    expect(host.latest("stigmer-server").signals).toEqual(["SIGTERM"]);
    expect(host.countOf("runner")).toBe(0);
    expect(hs.components["stigmer-server"].state).toBe("stopped");
    expect(hs.components["stigmer-server"].last_error).toBeUndefined();
    expect(readPidFile(join(dir, "stigmer-server.pid"))).toBeNull();
  });

  it("escalates to SIGKILL for a gated child that ignores SIGTERM, before it resolves", async () => {
    const { sup, host } = makeSupervisor([spec("stigmer-server", { critical: true, gate: exitWatchingGate })]);
    const stop = new AbortController();
    const started = sup.startAll(stop.signal);
    host.latest("stigmer-server").termExits = false;
    stop.abort();

    expect(await started).toEqual({ ok: false, stopped: true });
    expect(host.latest("stigmer-server").signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("stops a child whose gate passes as the stop arrives, and starts nothing after it", async () => {
    const stop = new AbortController();
    const passesAsStopped: ReadinessGate = {
      description: "passes",
      wait: async () => {
        stop.abort();
      },
    };
    const { sup, host, hs } = makeSupervisor([spec("stigmer-server", { critical: true, gate: passesAsStopped }), spec("runner")]);

    expect(await sup.startAll(stop.signal)).toEqual({ ok: false, stopped: true });
    expect(host.latest("stigmer-server").signals).toEqual(["SIGTERM"]);
    expect(host.countOf("runner")).toBe(0);
    expect(hs.components["stigmer-server"].state).toBe("stopped");
  });

  it("stops a gated child when the stop arrives during its own spawn", async () => {
    const stop = new AbortController();
    const server = spec("stigmer-server", { critical: true, gate: exitWatchingGate });
    const abortingSpawn: ComponentSpec = {
      ...server,
      resolve: () => {
        stop.abort();
        return server.resolve();
      },
    };
    const { sup, host } = makeSupervisor([abortingSpawn, spec("runner")]);

    expect(await sup.startAll(stop.signal)).toEqual({ ok: false, stopped: true });
    expect(host.latest("stigmer-server").signals).toEqual(["SIGTERM"]);
    expect(host.countOf("runner")).toBe(0);
  });

  it("starts nothing when the stop came first", async () => {
    const { sup, host, hs } = makeSupervisor([spec("stigmer-server", { critical: true, gate: okGate }), spec("runner")]);

    expect(await sup.startAll(AbortSignal.abort())).toEqual({ ok: false, stopped: true });
    expect(host.children).toEqual([]);
    expect(hs.components["stigmer-server"].state).toBe("stopped");
  });
});

describe("readiness marker", () => {
  it("flips ready false -> true when the child announces it", async () => {
    const { sup, host, hs } = makeSupervisor([spec("runner", { marker: "ready" })]);
    await sup.startAll();
    expect(hs.components.runner.ready).toBe(false);
    host.latest("runner").triggerReady();
    expect(hs.components.runner.ready).toBe(true);
  });
});

describe("settleCheck", () => {
  it("marks a component that crashed during startup as failed", async () => {
    const { sup, host, hs } = makeSupervisor([spec("runner")]);
    await sup.startAll();
    host.latest("runner").stderr = ["Error: Cannot find module 'x'"];
    host.latest("runner").triggerExit({ code: 1, signal: null });
    sup.settleCheck();
    expect(hs.components.runner.state).toBe("failed");
    expect(hs.components.runner.last_error).toBe("crashed during startup (exited with code 1)");
    expect(hs.components.runner.last_output).toEqual(["Error: Cannot find module 'x'"]);
  });
});

describe("restart policy", () => {
  it("restarts a crashed component that ran longer than the rapid-crash window", async () => {
    const { sup, host, clock, hs } = makeSupervisor([spec("runner")]);
    await sup.startAll();
    clock.t += 10_000; // 10s uptime
    host.latest("runner").stderr = ["lost the queue"];
    host.latest("runner").triggerExit();
    await sup.tick();

    expect(hs.components.runner.restart_count).toBe(1);
    expect(hs.components.runner.state).toBe("running");
    // A fresh start clears the last failure's record.
    expect(hs.components.runner.last_output).toBeUndefined();
    expect(host.countOf("runner")).toBe(2);
  });

  it("marks a rapid-crashing component failed without retry", async () => {
    const { sup, host, clock, hs } = makeSupervisor([spec("runner")]);
    await sup.startAll();
    clock.t += 1_000; // 1s uptime — inside the rapid-crash window
    host.latest("runner").stderr = ["fatal: bad config"];
    host.latest("runner").triggerExit({ code: null, signal: "SIGABRT" });
    await sup.tick();

    expect(hs.components.runner.state).toBe("failed");
    expect(hs.components.runner.last_error).toMatch(/^crashed immediately after start \(was stopped by SIGABRT\)/);
    expect(hs.components.runner.last_output).toEqual(["fatal: bad config"]);
    expect(host.countOf("runner")).toBe(1); // not respawned
  });

  it("marks a component failed, with no stale output, when its respawn cannot be resolved", async () => {
    let resolves = 0;
    const flaky: ComponentSpec = {
      ...spec("runner"),
      resolve: () => {
        resolves += 1;
        if (resolves > 1) throw new Error("runner entry not found");
        return spec("runner").resolve();
      },
    };
    const { sup, host, clock, hs } = makeSupervisor([flaky]);
    await sup.startAll();
    clock.t += 10_000;
    host.latest("runner").stderr = ["from the run before"];
    host.latest("runner").triggerExit();
    await sup.tick();

    expect(hs.components.runner.state).toBe("failed");
    expect(hs.components.runner.last_error).toBe("runner entry not found");
    expect(hs.components.runner.last_output).toBeUndefined();
  });

  it("stops retrying after the max-restart ceiling", async () => {
    const { sup, host, clock, hs } = makeSupervisor([spec("runner")]);
    await sup.startAll();
    hs.components.runner.restart_count = MAX_RESTARTS;
    clock.t += 10_000;
    host.latest("runner").stderr = ["out of memory"];
    host.latest("runner").triggerExit();
    await sup.tick();

    expect(hs.components.runner.state).toBe("failed");
    expect(hs.components.runner.last_error).toMatch(/max restarts/);
    expect(hs.components.runner.last_output).toEqual(["out of memory"]);
    expect(host.countOf("runner")).toBe(1);
  });
});

describe("server health probe", () => {
  it("escalates to kill+restart after the unhealthy threshold, then recovers", async () => {
    let healthy = false;
    const { sup, host, clock, hs } = makeSupervisor([spec("stigmer-server", { critical: true, gate: okGate })], {
      probe: async () => healthy,
    });
    await sup.startAll();
    clock.t += 10_000;

    await sup.tick(); // 1 unhealthy
    await sup.tick(); // 2 unhealthy
    expect(hs.components["stigmer-server"].state).toBe("unhealthy");
    await sup.tick(); // 3 -> kill + restart

    expect(hs.components["stigmer-server"].restart_count).toBe(1);
    expect(host.countOf("stigmer-server")).toBe(2);

    healthy = true;
    await sup.tick();
    expect(hs.components["stigmer-server"].state).toBe("running");
  });

  it("clears the recorded error and output when an unhealthy server answers again", async () => {
    let healthy = false;
    const { sup, clock, hs } = makeSupervisor([spec("stigmer-server", { critical: true, gate: okGate })], {
      probe: async () => healthy,
    });
    await sup.startAll();
    clock.t += 10_000;
    await sup.tick();
    hs.components["stigmer-server"].last_output = ["stale"];

    healthy = true;
    await sup.tick();

    expect(hs.components["stigmer-server"].state).toBe("running");
    expect(hs.components["stigmer-server"].last_error).toBeUndefined();
    expect(hs.components["stigmer-server"].last_output).toBeUndefined();
  });
});

describe("shutdown", () => {
  it("stops components in reverse order, removing PID files", async () => {
    const { sup, host, hs } = makeSupervisor([spec("stigmer-server", { critical: true, gate: okGate }), spec("runner")]);
    await sup.startAll();
    await sup.shutdown();

    expect(host.killOrder).toEqual(["runner", "stigmer-server"]);
    expect(hs.components.runner.state).toBe("stopped");
    expect(hs.components["stigmer-server"].state).toBe("stopped");
    expect(readPidFile(join(dir, "runner.pid"))).toBeNull();
    expect(readPidFile(join(dir, "stigmer-server.pid"))).toBeNull();
  });

  it("escalates to SIGKILL when a child ignores SIGTERM", async () => {
    const { sup, host } = makeSupervisor([spec("runner")]);
    await sup.startAll();
    host.latest("runner").termExits = false; // ignores SIGTERM
    await sup.shutdown();

    expect(host.latest("runner").signals).toContain("SIGTERM");
    expect(host.latest("runner").signals).toContain("SIGKILL");
  });

  it("stops a server that failed its gate while still running, keeping its failed state", async () => {
    const { sup, host, hs } = makeSupervisor([spec("stigmer-server", { critical: true, gate: failGate })]);
    await sup.startAll();
    await sup.shutdown();

    expect(host.latest("stigmer-server").signals).toEqual(["SIGTERM"]);
    expect(hs.components["stigmer-server"].state).toBe("failed");
    expect(readPidFile(join(dir, "stigmer-server.pid"))).toBeNull();
  });
});
