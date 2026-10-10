/**
 * The agent host process's logic (`agent-host/entry.ts`
 * `runAgentHostProcess`), driven in-process: the runner's side is a peer on
 * a loopback channel, the adapters are probes.
 *
 * Pinned:
 *  - at the first boot the host routes the model registry through the
 *    runner's proxy, points the Cursor SDK at the Cursor lane, and on a
 *    runner that calls providers directly installs the provider lanes;
 *  - a running turn signs its approval receipts with the key the runner
 *    handed, not one of the host's own;
 *  - when the channel closes, every booted adapter is shut down in reverse
 *    boot order (a failing one logged, the rest still run), telemetry is
 *    flushed, and the process exits 0, bounded by the grace when an adapter
 *    hangs.
 */

import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";
import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";

import { DEEP_AGENT_CAPABILITIES } from "../../activities/execute-deep-agent/deep-agent-capabilities.js";
import { turnInputFixture } from "../../__test-utils__/turn-input-fixture.js";
import type { HarnessRow } from "../../harness/registry.js";
import type { HarnessAdapter } from "../../harness/types.js";
import { TimingRecorder } from "../../shared/cold-start-timing.js";
import { executionFingerprintKey } from "../../shared/fingerprint-secret.js";
import { modelLanes, resetModelLanesForTests } from "../../shared/model-lanes.js";
import { resetRegistryRouteForTests, resolveRegistryBaseUrl } from "../../shared/registry-endpoint.js";
import { Peer, loopbackChannels } from "../channel.js";
import { encodeMessage, encodeTurnInput } from "../codec.js";
import { runAgentHostProcess } from "../entry.js";
import { AGENT_HOST_PROTOCOL_VERSION, type HostCalls, type HostConfigWire, type HostNotices, type RunnerCalls, type RunnerNotices } from "../protocol.js";

const CONFIG: HostConfigWire = {
  mode: "local",
  workspaceRootDir: "/tmp/ws",
  primaryModel: "m",
  maxConcurrentActivities: 1,
  cloudModeEnabled: false,
  checkpointerType: "sqlite",
  mcpBridgeEndpoint: null,
  mcpPublicEndpoint: null,
  cursorStreamStallTimeoutMs: 1,
  agentResolveTimeoutMs: 1,
  workspaceLockTimeoutMs: 1,
  proxyEndpoint: "http://127.0.0.1:4321",
  cursorEndpoint: "https://127.0.0.1:4322",
  token: "host-token",
  platformProxied: false,
};

function probe(name: string, events: string[], behaviour: Partial<HarnessAdapter> = {}): HarnessAdapter {
  return {
    name,
    capabilities: DEEP_AGENT_CAPABILITIES,
    boot: async () => void events.push(`boot ${name}`),
    shutdown: async () => void events.push(`shutdown ${name}`),
    releaseSession: async () => {},
    runTurn: async () => ({ kind: "completed" }),
    ...behaviour,
  };
}

function hostProcess(rows: readonly HarnessRow[], shutdownGraceMs?: number) {
  const [runnerEnd, hostEnd] = loopbackChannels();
  const runner = new Peer<HostCalls, RunnerCalls, RunnerNotices, HostNotices>(runnerEnd, "runner");
  const log: string[] = [];
  const exits: number[] = [];
  let flushed = 0;
  const done = runAgentHostProcess({
    channel: hostEnd,
    rows,
    initTelemetry: async () => async () => {
      flushed += 1;
    },
    exit: (code) => void exits.push(code),
    log: (message) => void log.push(message),
    ...(shutdownGraceMs !== undefined ? { shutdownGraceMs } : {}),
  });
  return { runner, runnerEnd, log, exits, done, flushed: () => flushed };
}

const cursorBackend = process.env.CURSOR_BACKEND_URL;
afterEach(() => {
  if (cursorBackend === undefined) delete process.env.CURSOR_BACKEND_URL;
  else process.env.CURSOR_BACKEND_URL = cursorBackend;
});

describe("the agent host process", () => {
  it("routes the registry and the Cursor SDK, and installs the provider lanes, at the first boot", async () => {
    resetRegistryRouteForTests();
    resetModelLanesForTests();
    const events: string[] = [];
    const { runner, runnerEnd, done } = hostProcess([{ harness: "deep-agent", adapter: probe("native", events) }]);

    expect(await runner.receivedHello(1_000)).toBe(AGENT_HOST_PROTOCOL_VERSION);
    await runner.call("boot", { harness: "deep-agent", config: CONFIG });

    expect(resolveRegistryBaseUrl()).toBe(CONFIG.proxyEndpoint);
    expect(process.env.CURSOR_BACKEND_URL).toBe(CONFIG.cursorEndpoint);
    expect(modelLanes()).toEqual({ endpoint: CONFIG.proxyEndpoint, token: CONFIG.token });
    runnerEnd.close();
    await done;
    resetRegistryRouteForTests();
    resetModelLanesForTests();
  });

  it("installs no lanes on a runner behind the platform's proxy", async () => {
    resetModelLanesForTests();
    const { runner, runnerEnd, done } = hostProcess([{ harness: "deep-agent", adapter: probe("native", []) }]);
    await runner.receivedHello(1_000);
    await runner.call("boot", { harness: "deep-agent", config: { ...CONFIG, platformProxied: true } });

    expect(modelLanes()).toBeUndefined();
    runnerEnd.close();
    await done;
    resetRegistryRouteForTests();
  });

  it("signs a running turn's receipts with the key the runner handed", async () => {
    const handed = Buffer.from("k".repeat(32));
    let seen: Buffer | undefined;
    const adapter = probe("native", [], {
      runTurn: async (input) => {
        seen = executionFingerprintKey(input.executionId);
        return { kind: "completed" };
      },
    });
    const { runner, runnerEnd, done } = hostProcess([{ harness: "deep-agent", adapter }]);
    await runner.receivedHello(1_000);
    await runner.call("boot", { harness: "deep-agent", config: CONFIG });
    await runner.call("runTurn", {
      turnId: "t1",
      harness: "deep-agent",
      input: encodeTurnInput(turnInputFixture()),
      status: encodeMessage(RunStatusSchema, create(RunStatusSchema)),
      timing: new TimingRecorder().toWire(),
      fingerprintKey: handed.toString("base64"),
      stopped: null,
    });

    expect(seen?.equals(handed)).toBe(true);
    runnerEnd.close();
    await done;
    resetRegistryRouteForTests();
    resetModelLanesForTests();
  });

  it("shuts every booted adapter down in reverse order when the channel closes, flushes telemetry and exits 0", async () => {
    const events: string[] = [];
    const failing = probe("cursor-probe", events, {
      shutdown: async () => {
        events.push("shutdown cursor-probe");
        throw new Error("would not let go");
      },
    });
    const { runner, runnerEnd, log, exits, done, flushed } = hostProcess([
      { harness: "deep-agent", adapter: probe("native", events) },
      { harness: "cursor", adapter: failing },
    ]);
    await runner.receivedHello(1_000);
    await runner.call("boot", { harness: "deep-agent", config: CONFIG });
    await runner.call("boot", { harness: "cursor", config: CONFIG });

    runnerEnd.close(new Error("the runner is gone"));
    await done;

    expect(events).toEqual(["boot native", "boot cursor-probe", "shutdown cursor-probe", "shutdown native"]);
    expect(log).toEqual([
      "[agent-host] channel closed (the runner is gone); shutting down",
      "[agent-host] cursor-probe shutdown failed: would not let go",
    ]);
    expect(flushed()).toBe(1);
    expect(exits).toEqual([0]);
    resetRegistryRouteForTests();
    resetModelLanesForTests();
  });

  it("exits within the grace when an adapter's shutdown hangs", async () => {
    const hanging = probe("native", [], { shutdown: () => new Promise<void>(() => {}) });
    const { runner, runnerEnd, exits, done } = hostProcess([{ harness: "deep-agent", adapter: hanging }], 20);
    await runner.receivedHello(1_000);
    await runner.call("boot", { harness: "deep-agent", config: CONFIG });

    runnerEnd.close();
    await done;
    expect(exits).toEqual([0]);
    resetRegistryRouteForTests();
    resetModelLanesForTests();
  });
});
