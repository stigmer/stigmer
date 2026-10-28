/**
 * The agent host's supervisor (`agent-host/supervisor.ts`) and the hosting
 * the roots call (`agent-host/hosting.ts`), at the edges the spawned-host
 * and hostile-host tests do not reach.
 *
 * Pinned:
 *  - a host that dies is started again on its own, without waiting for the
 *    next turn, after the backoff; a host that served longer than the
 *    longest delay is restarted after the first delay again; a start that
 *    fails is retried on the same backoff, and the default log says so;
 *  - shutting down a harness that was never booted touches nothing; a host
 *    whose start was under way when the last harness shut down is ended,
 *    not adopted, and nothing restarts it;
 *  - a call from the host for a turn the runner is not running is refused;
 *  - harnesses booted at the same moment, while the host is still starting,
 *    are each booted in it once;
 *  - a separating runner starts setpriv by its absolute path on its own
 *    PATH, never by a name the host's PATH could resolve;
 *  - the production starter runs this build's entry in its agent-host mode
 *    under the runner's own Node (as Node, under an Electron embedder), from
 *    source under tsx; a host that cannot
 *    be spawned closes its channel instead of throwing; the host outlives
 *    the SIGTERM and SIGINT its process group receives (a daemon's stop, a
 *    terminal's Ctrl-C) and exits only when its pipe closes, so a runner
 *    draining its turns keeps its host; a host that has not exited a grace
 *    after it was told to end is killed;
 *  - hosting replaces every harness's adapter with a remote one that keeps
 *    its name and capabilities, and starts no host before a harness boots.
 */

import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEEP_AGENT_CAPABILITIES } from "../../activities/execute-deep-agent/deep-agent-capabilities.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import type { HarnessAdapter } from "../../harness/types.js";
import { RUNNER_ENTRY_URL } from "../../runner-entry.js";
import { Peer, loopbackChannels } from "../channel.js";
import { agentFs, installAgentFs, localAgentFs } from "../../shared/agent-fs.js";
import { serveAgentHost } from "../host.js";
import { handOver, hostHarnesses } from "../hosting.js";
import { AGENT_HOST_MODE_ARG, AGENT_HOST_PROTOCOL_VERSION, type HostCalls, type HostNotices, type RunnerCalls, type RunnerNotices } from "../protocol.js";
import { AgentHostSupervisor, agentHostCommand, processHostStarter, spawnHostProcess, type HostStarter } from "../supervisor.js";

const PROXY = { endpoint: "http://127.0.0.1:9", authorizeHost: () => {} };

type HostSide = Peer<RunnerCalls, HostCalls, HostNotices, RunnerNotices>;

/** A starter of in-process hosts that answer boot; each started host is kept for the test to end. */
function inProcessHosts(): { readonly start: HostStarter; readonly hosts: HostSide[]; failNext: number } {
  const state = {
    hosts: [] as HostSide[],
    failNext: 0,
    start: (() => {
      if (state.failNext > 0) {
        state.failNext -= 1;
        throw new Error("no host for you");
      }
      const [runnerEnd, hostEnd] = loopbackChannels();
      const host: HostSide = new Peer<RunnerCalls, HostCalls, HostNotices, RunnerNotices>(hostEnd, "host");
      host.handle("boot", async () => null);
      host.handle("shutdown", async () => null);
      host.sendHello(AGENT_HOST_PROTOCOL_VERSION);
      state.hosts.push(host);
      return { channel: runnerEnd, kill: () => hostEnd.close() };
    }) as HostStarter,
  };
  return state;
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the supervisor's restarts", () => {
  it("starts a host that died again on its own, and retries a start that failed, with the default log", async () => {
    const warned: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((message: string) => void warned.push(message));
    const hosts = inProcessHosts();
    const supervisor = new AgentHostSupervisor({ proxy: PROXY, start: hosts.start, firstRestartDelayMs: 5, maxRestartDelayMs: 40 });
    await supervisor.boot("deep-agent", testConfig());

    hosts.failNext = 1;
    hosts.hosts[0]!.close(new Error("crashed"));
    await until(() => hosts.hosts.length === 2, "the second host");

    expect(warned).toEqual([
      "[agent-host] the agent host exited (crashed); restarting in 5ms",
      "[agent-host] the agent host could not be started (no host for you); restarting in 10ms",
    ]);
    await supervisor.shutdown("deep-agent");
  });

  it("restarts a host that served longer than the longest delay after the first delay again", async () => {
    const log: string[] = [];
    const hosts = inProcessHosts();
    const supervisor = new AgentHostSupervisor({ proxy: PROXY, start: hosts.start, firstRestartDelayMs: 5, maxRestartDelayMs: 40, log: (m) => void log.push(m) });
    await supervisor.boot("deep-agent", testConfig());

    hosts.hosts[0]!.close(new Error("first"));
    await until(() => hosts.hosts.length === 2, "the second host");
    await new Promise((resolve) => setTimeout(resolve, 60));
    hosts.hosts[1]!.close(new Error("second"));
    await until(() => hosts.hosts.length === 3, "the third host");

    expect(log).toEqual([
      "[agent-host] the agent host exited (first); restarting in 5ms",
      "[agent-host] the agent host exited (second); restarting in 5ms",
    ]);
    await supervisor.shutdown("deep-agent");
  });
});

describe("the supervisor's edges", () => {
  it("cancels the pending restart when a turn starts the host first", async () => {
    const hosts = inProcessHosts();
    const supervisor = new AgentHostSupervisor({ proxy: PROXY, start: hosts.start, firstRestartDelayMs: 20, log: () => {} });
    await supervisor.boot("deep-agent", testConfig());

    hosts.hosts[0]!.close(new Error("crashed"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await supervisor.connection();
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(hosts.hosts, "the turn's start, and no second one from the timer").toHaveLength(2);
    await supervisor.shutdown("deep-agent");
  });

  it("ends a host whose start was under way when the last harness shut down, and restarts nothing", async () => {
    const log: string[] = [];
    const hosts = inProcessHosts();
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let starts = 0;
    const start: HostStarter = async () => {
      starts += 1;
      const started = await hosts.start();
      if (starts === 2) await held;
      return started;
    };
    const supervisor = new AgentHostSupervisor({ proxy: PROXY, start, firstRestartDelayMs: 5, log: (m) => void log.push(m) });
    await supervisor.boot("deep-agent", testConfig());

    hosts.hosts[0]!.close(new Error("crashed"));
    await until(() => hosts.hosts.length === 2, "the restart's host");
    await supervisor.shutdown("deep-agent");
    release();

    await until(() => hosts.hosts[1]!.closed, "the late host to be ended");
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(hosts.hosts, "no further start").toHaveLength(2);
    expect(log).toEqual(["[agent-host] the agent host exited (crashed); restarting in 5ms"]);
  });

  it("touches nothing when a harness that was never booted shuts down", async () => {
    const hosts = inProcessHosts();
    const supervisor = new AgentHostSupervisor({ proxy: PROXY, start: hosts.start, log: () => {} });
    await supervisor.shutdown("claude");
    expect(hosts.hosts).toEqual([]);
  });

  it("boots each harness once in a host that was still starting when they were booted together", async () => {
    const booted: string[] = [];
    const hosts = inProcessHosts();
    const start: HostStarter = async () => {
      const started = await hosts.start();
      const host = hosts.hosts.at(-1)!;
      host.handle("boot", async ({ harness }) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        booted.push(harness);
        return null;
      });
      return started;
    };
    const supervisor = new AgentHostSupervisor({ proxy: PROXY, start, log: () => {} });

    await Promise.all([supervisor.boot("claude", testConfig()), supervisor.boot("deep-agent", testConfig())]);

    expect(booted.sort()).toEqual(["claude", "deep-agent"]);
    expect(hosts.hosts).toHaveLength(1);
    await supervisor.shutdown("claude");
    await supervisor.shutdown("deep-agent");
  });

  it("refuses a host's call for a turn the runner is not running", async () => {
    const hosts = inProcessHosts();
    const supervisor = new AgentHostSupervisor({ proxy: PROXY, start: hosts.start, log: () => {} });
    await supervisor.boot("deep-agent", testConfig());

    await expect(hosts.hosts[0]!.call("reportProgress", { turnId: "nobody", label: "x" })).rejects.toThrow("no turn nobody is running on this runner");
    await supervisor.shutdown("deep-agent");
  });
});

describe("the production starter", () => {
  it("runs this build's entry in agent-host mode under the runner's Node, from source under tsx", () => {
    const { command, args, env } = agentHostCommand();
    expect(command).toBe(process.execPath);
    expect(args).toEqual(["--import", "tsx", fileURLToPath(RUNNER_ENTRY_URL), AGENT_HOST_MODE_ARG]);
    expect(env, "plain Node needs nothing").toEqual({});
    expect(agentHostCommand({ ...process.versions, electron: "33.2.0" }).env, "Electron runs the entry as Node").toEqual({ ELECTRON_RUN_AS_NODE: "1" });
    expect(fileURLToPath(RUNNER_ENTRY_URL).endsWith("main.ts")).toBe(true);
  });

  it("starts setpriv by its absolute path on the runner's own PATH, so a folder the agent writes leading the host's PATH cannot stand in for it", () => {
    const dir = mkdtempSync(join(tmpdir(), "setpriv-path-"));
    writeFileSync(join(dir, "setpriv"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(dir, "setpriv"), 0o755);
    const saved = process.env.PATH;
    process.env.PATH = `${dir}${delimiter}${saved ?? ""}`;
    try {
      const identity = { name: "stigmer-agent", uid: 10001, gid: 10001, home: "/data/agent" };
      expect(agentHostCommand(process.versions, identity).command).toBe(join(dir, "setpriv"));
    } finally {
      process.env.PATH = saved;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to start the host as the agent when the runner's PATH has no setpriv, never by a bare name", () => {
    const identity = { name: "stigmer-agent", uid: 10001, gid: 10001, home: "/data/agent" };
    expect(() => agentHostCommand(process.versions, identity, "/nonexistent")).toThrow(
      "the runner's PATH has no setpriv, so the agent host cannot start as the agent",
    );
  });

  it("starts the host as the agent user through setpriv, with the agent's home, on a separating runner", () => {
    const identity = { name: "stigmer-agent", uid: 10001, gid: 10001, home: "/data/agent" };
    const dir = mkdtempSync(join(tmpdir(), "setpriv-path-"));
    writeFileSync(join(dir, "setpriv"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(dir, "setpriv"), 0o755);
    let started: ReturnType<typeof agentHostCommand>;
    try {
      started = agentHostCommand(process.versions, identity, dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const { command, args, env } = started;
    expect(command).toBe(join(dir, "setpriv"));
    expect(args).toEqual([
      "--reuid=10001",
      "--regid=10001",
      "--clear-groups",
      "--inh-caps=-all",
      "--no-new-privs",
      "--",
      process.execPath,
      "--import",
      "tsx",
      fileURLToPath(RUNNER_ENTRY_URL),
      AGENT_HOST_MODE_ARG,
    ]);
    expect(env).toEqual({ HOME: "/data/agent" });
  });

  // As root on Linux holding the five capabilities (a dev container), the real
  // preparation would add the agent user to this machine's /etc/passwd.
  it.skipIf(process.getuid?.() === 0)("prepares the separation itself by default, and stops when it cannot", async () => {
    const identity = { name: "stigmer-agent", uid: 10001, gid: 10001, home: join(mkdtempSync(join(tmpdir(), "agent-home-")), "agent") };
    const exits: number[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    // This process is not a root runner holding the five capabilities, so the
    // real preparation refuses, as a misconfigured container runner would.
    await expect(hostHarnesses([], testConfig(), { identity, exit: (code) => void exits.push(code) })).rejects.toThrow(/^the runner /);
    expect(exits).toEqual([78]);
  });

  it("hands the agent its files on boot, and turns a failed handover into the refusal", () => {
    const base = mkdtempSync(join(tmpdir(), "hosting-handover-"));
    const identity = { name: "stigmer-agent", uid: 10001, gid: 10001, home: join(base, "agent") };
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(handOver(identity, join(base, "workspace"), join(base, "runner"), { chown: () => {} })).toBeNull();
    expect(
      handOver(identity, join(base, "workspace-2"), join(base, "runner-2"), {
        chown: () => {
          throw new Error("EPERM: operation not permitted");
        },
      }),
    ).toBe("the runner cannot hand the agent user its files: EPERM: operation not permitted");
  });

  it("routes the runtime's file and process operations to the host it starts", async () => {
    const hosted = await hostHarnesses([], testConfig(), {
      identity: null,
      start: async () => {
        const [runnerEnd, hostEnd] = loopbackChannels();
        serveAgentHost(hostEnd, []);
        return { channel: runnerEnd, kill: () => hostEnd.close() };
      },
    });
    expect((await agentFs().stat(tmpdir())).isDirectory()).toBe(true);
    expect((await agentFs().execFile("sh", ["-c", "printf host"])).stdout.toString()).toBe("host");
    await hosted.close();
  });

  it("stops a separating runner that cannot drop to the agent with 78, before any harness boots", async () => {
    const identity = { name: "stigmer-agent", uid: 10001, gid: 10001, home: "/data/agent" };
    const exits: number[] = [];
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let started = 0;
    await expect(
      hostHarnesses([], testConfig(), {
        identity,
        prepareSeparation: () => "the runner cannot start processes as the agent user: setpriv is missing",
        exit: (code) => void exits.push(code),
        start: async () => {
          started += 1;
          throw new Error("never started");
        },
      }),
    ).rejects.toThrow("setpriv is missing");
    expect(exits).toEqual([78]);
    expect(errors).toHaveBeenCalledWith("[agent-host] the runner cannot start processes as the agent user: setpriv is missing");
    expect(started).toBe(0);

    const ready = await hostHarnesses([], testConfig(), { identity, prepareSeparation: () => null, start: inProcessHosts().start });
    try {
      await ready.close();
    } finally {
      // A separating runner refuses the agent's operations once its host has closed; later tests get the local ones back.
      installAgentFs(localAgentFs);
    }
  });

  it("starts a real host that announces itself, and ends it when the runner is done", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const supervisor = new AgentHostSupervisor({ proxy: PROXY, start: processHostStarter(() => ({ ...process.env })), log: () => {} });
    const peer = await supervisor.connection();
    expect(peer.closed).toBe(false);
    peer.close();
    await new Promise<void>((resolve) => peer.onClose(() => resolve()));
  });

  it("outlives the signals its process group receives, and exits when its pipe closes", async () => {
    const { command, args } = agentHostCommand();
    const { started, child } = spawnHostProcess(command, args, { ...process.env });
    const peer = new Peer<HostCalls, RunnerCalls, RunnerNotices, HostNotices>(started.channel, "runner");
    expect(await peer.receivedHello(30_000)).toBe(AGENT_HOST_PROTOCOL_VERSION);

    child.kill("SIGTERM");
    child.kill("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(child.exitCode, "still running after the signals").toBeNull();
    expect(child.signalCode).toBeNull();
    expect(peer.closed).toBe(false);

    const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
    peer.close();
    expect(await exited).toBe(0);
  }, 60_000);

  it("starts a real host by default, with the lane's trust file, and boots a harness in it", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const hosted = await hostHarnesses([{ harness: "deep-agent", adapter: probeAdapter("native") }], testConfig());
    await hosted.rows[0]!.adapter.boot(testConfig());
    await hosted.rows[0]!.adapter.shutdown();
    await hosted.close();
  }, 60_000);

  it("kills a host that has not exited a grace after it was told to end", async () => {
    const wedged = 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);';
    const { started, child } = spawnHostProcess(process.execPath, ["-e", wedged], { ...process.env }, 200);
    const exited = new Promise<NodeJS.Signals | null>((resolve) => child.once("exit", (_code, signal) => resolve(signal)));
    await new Promise((resolve) => setTimeout(resolve, 100));
    started.kill();
    started.kill();
    expect(await exited).toBe("SIGKILL");
    started.kill();
  });

  it("closes the channel of a host that cannot be spawned instead of throwing", async () => {
    const { started } = spawnHostProcess("/nonexistent/node-for-the-agent-host", [], {});
    const reason = await new Promise<Error>((resolve) => started.channel.onClose(resolve));
    expect(reason.message).toMatch(/ENOENT/);
    started.kill();
  });
});

/** An adapter that does nothing, for a hosted row. */
function probeAdapter(name: string): HarnessAdapter {
  return {
    name,
    capabilities: DEEP_AGENT_CAPABILITIES,
    boot: async () => {},
    shutdown: async () => {},
    releaseSession: async () => {},
    runTurn: async () => ({ kind: "completed" }),
  };
}

describe("hosting the table", () => {
  it("replaces every harness's adapter, keeps its name and capabilities, starts no host before a boot, and closes its proxy", async () => {
    const hosts = inProcessHosts();
    const adapter = (name: string): HarnessAdapter => ({
      name,
      capabilities: DEEP_AGENT_CAPABILITIES,
      boot: async () => {},
      shutdown: async () => {},
      releaseSession: async () => {},
      runTurn: async () => ({ kind: "completed" }),
    });
    const native = adapter("native");
    const claude = adapter("claude");
    const hosted = await hostHarnesses(
      [
        { harness: "claude", adapter: claude },
        { harness: "deep-agent", adapter: native },
      ],
      testConfig(),
      { start: hosts.start },
    );

    expect(hosted.rows[0]!.adapter, "the Claude harness is hosted").not.toBe(claude);
    expect(hosted.rows[1]!.adapter, "the native harness is hosted").not.toBe(native);
    expect(hosted.rows.map((row) => row.adapter.name)).toEqual(["claude", "native"]);
    expect(hosted.rows[1]!.adapter.capabilities).toBe(native.capabilities);
    expect(hosts.hosts, "nothing booted, so no host is started").toEqual([]);
    await hosted.close();
  });
});
