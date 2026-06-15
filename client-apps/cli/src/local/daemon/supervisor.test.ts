import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../logger.js";
import type { HealthState } from "../state/health-state.js";
import { readPidFile } from "../state/pidfile.js";
import { MAX_RESTARTS, ProcessSupervisor } from "./supervisor.js";
import type { ChildHandle, Clock, ComponentSpec, ExitInfo, ProcessHost, ReadinessGate, SpawnRequest } from "./types.js";

const silent: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

// A controllable fake child: the test triggers its exit/readiness and inspects
// the signals it received.
interface FakeChild {
  request: SpawnRequest;
  handle: ChildHandle;
  signals: NodeJS.Signals[];
  termExits: boolean;
  triggerExit(info?: ExitInfo): void;
  triggerReady(): void;
}

class FakeHost implements ProcessHost {
  readonly children: FakeChild[] = [];
  readonly killOrder: string[] = [];
  private nextPid = 1000;

  spawn(request: SpawnRequest): ChildHandle {
    let exited = false;
    let exitCb: ((info: ExitInfo) => void) | null = null;
    let readyCb: (() => void) | null = null;
    const signals: NodeJS.Signals[] = [];
    const pid = this.nextPid++;
    const order = this.killOrder;

    const child: FakeChild = {
      request,
      signals,
      termExits: true,
      triggerExit: (info = { code: 1, signal: null }) => {
        if (!exited) {
          exited = true;
          exitCb?.(info);
        }
      },
      triggerReady: () => readyCb?.(),
      handle: {
        pid,
        hasExited: () => exited,
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
            if (!exited) {
              exited = true;
              exitCb?.({ code: null, signal });
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
    resolve: () => ({ command: name, args: [], env: {}, logFile: join(dir, `${name}.log`), readinessMarker: opts.marker }),
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
    host.latest("runner").triggerExit();
    sup.settleCheck();
    expect(hs.components.runner.state).toBe("failed");
    expect(hs.components.runner.last_error).toMatch(/crashed during startup/);
  });
});

describe("restart policy", () => {
  it("restarts a crashed component that ran longer than the rapid-crash window", async () => {
    const { sup, host, clock, hs } = makeSupervisor([spec("runner")]);
    await sup.startAll();
    clock.t += 10_000; // 10s uptime
    host.latest("runner").triggerExit();
    await sup.tick();

    expect(hs.components.runner.restart_count).toBe(1);
    expect(hs.components.runner.state).toBe("running");
    expect(host.countOf("runner")).toBe(2);
  });

  it("marks a rapid-crashing component failed without retry", async () => {
    const { sup, host, clock, hs } = makeSupervisor([spec("runner")]);
    await sup.startAll();
    clock.t += 1_000; // 1s uptime — inside the rapid-crash window
    host.latest("runner").triggerExit();
    await sup.tick();

    expect(hs.components.runner.state).toBe("failed");
    expect(host.countOf("runner")).toBe(1); // not respawned
  });

  it("stops retrying after the max-restart ceiling", async () => {
    const { sup, host, clock, hs } = makeSupervisor([spec("runner")]);
    await sup.startAll();
    hs.components.runner.restart_count = MAX_RESTARTS;
    clock.t += 10_000;
    host.latest("runner").triggerExit();
    await sup.tick();

    expect(hs.components.runner.state).toBe("failed");
    expect(hs.components.runner.last_error).toMatch(/max restarts/);
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
});
