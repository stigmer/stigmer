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
 *  - shutting down a harness that was never booted touches nothing;
 *  - a call from the host for a turn the runner is not running is refused;
 *  - the production starter runs this build's entry in its agent-host mode
 *    under the runner's own Node, from source under tsx; a host that cannot
 *    be spawned closes its channel instead of throwing;
 *  - hosting replaces exactly the hosted harnesses' adapters with remote
 *    ones and leaves the rest as they are.
 */

import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEEP_AGENT_CAPABILITIES } from "../../activities/execute-deep-agent/deep-agent-capabilities.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import type { HarnessAdapter } from "../../harness/types.js";
import { RUNNER_ENTRY_URL } from "../../runner-entry.js";
import { Peer, loopbackChannels } from "../channel.js";
import { hostHarnesses } from "../hosting.js";
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

  it("touches nothing when a harness that was never booted shuts down", async () => {
    const hosts = inProcessHosts();
    const supervisor = new AgentHostSupervisor({ proxy: PROXY, start: hosts.start, log: () => {} });
    await supervisor.shutdown("cursor");
    expect(hosts.hosts).toEqual([]);
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
    const { command, args } = agentHostCommand();
    expect(command).toBe(process.execPath);
    expect(args).toEqual(["--import", "tsx", fileURLToPath(RUNNER_ENTRY_URL), AGENT_HOST_MODE_ARG]);
    expect(fileURLToPath(RUNNER_ENTRY_URL).endsWith("main.ts")).toBe(true);
  });

  it("starts a real host that announces itself, and ends it when the runner is done", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const supervisor = new AgentHostSupervisor({ proxy: PROXY, start: processHostStarter(() => ({ ...process.env })), log: () => {} });
    const peer = await supervisor.connection();
    expect(peer.closed).toBe(false);
    peer.close();
    await new Promise<void>((resolve) => peer.onClose(() => resolve()));
  });

  it("closes the channel of a host that cannot be spawned instead of throwing", async () => {
    const { started } = spawnHostProcess("/nonexistent/node-for-the-agent-host", [], {});
    const reason = await new Promise<Error>((resolve) => started.channel.onClose(resolve));
    expect(reason.message).toMatch(/ENOENT/);
    started.kill();
  });
});

describe("hosting the table", () => {
  it("replaces exactly the hosted harnesses' adapters, and closes its proxy", async () => {
    const adapter = (name: string): HarnessAdapter => ({
      name,
      capabilities: DEEP_AGENT_CAPABILITIES,
      boot: async () => {},
      shutdown: async () => {},
      releaseSession: async () => {},
      runTurn: async () => ({ kind: "completed" }),
    });
    const native = adapter("native");
    const cursor = adapter("cursor");
    const hosted = await hostHarnesses(
      [
        { harness: "cursor", adapter: cursor },
        { harness: "deep-agent", adapter: native },
      ],
      testConfig(),
      { start: inProcessHosts().start },
    );

    expect(hosted.rows[0]!.adapter, "the Cursor harness still runs in the runner").toBe(cursor);
    expect(hosted.rows[1]!.adapter, "the native harness is hosted").not.toBe(native);
    expect(hosted.rows[1]!.adapter.name).toBe("native");
    expect(hosted.rows[1]!.adapter.capabilities).toBe(native.capabilities);
    await hosted.close();
  });
});
