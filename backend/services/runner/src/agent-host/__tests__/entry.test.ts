/**
 * The agent host process's logic (`agent-host/entry.ts`
 * `runAgentHostProcess`), driven in-process: the runner's side is a peer on
 * a loopback channel, the adapters are probes.
 *
 * Pinned:
 *  - at the first boot the host routes the model registry through the
 *    runner's proxy, and on a runner that calls providers directly installs
 *    the provider lanes;
 *  - a running turn signs its approval receipts with the key the runner
 *    handed, not one of the host's own;
 *  - when the channel closes, every booted adapter is shut down in reverse
 *    boot order (a failing one logged, the rest still run), telemetry is
 *    flushed, and the process exits 0, bounded by the grace when an adapter
 *    hangs.
 */

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";

import { DEEP_AGENT_CAPABILITIES } from "../../activities/execute-deep-agent/deep-agent-capabilities.js";
import { TELEMETRY_OFF } from "../../otel-export.js";
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
import { TurnRowsSchema } from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

const CONFIG: HostConfigWire = {
  mode: "local",
  workspaceRootDir: "/tmp/ws",
  primaryModel: "m",
  maxConcurrentActivities: 1,
  checkpointerType: "sqlite",
  mcpBridgeEndpoint: null,
  mcpPublicEndpoint: null,
  cursorStreamStallTimeoutMs: 1,
  openOperationMaxMs: 1,
  shellTimeoutMaxSeconds: 1,
  shellBackgroundEnabled: true,
  workspaceLockTimeoutMs: 1,
  proxyEndpoint: "http://127.0.0.1:4321",
  token: "host-token",
  platformProxied: false,
  telemetry: TELEMETRY_OFF,
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

describe("the agent host process", () => {
  it("routes the registry, and installs the provider lanes, at the first boot", async () => {
    resetRegistryRouteForTests();
    resetModelLanesForTests();
    const events: string[] = [];
    const { runner, runnerEnd, done } = hostProcess([{ harness: "stigmer", adapter: probe("stigmer", events) }]);

    expect(await runner.receivedHello(1_000)).toBe(AGENT_HOST_PROTOCOL_VERSION);
    await runner.call("boot", { harness: "stigmer", config: CONFIG });

    expect(resolveRegistryBaseUrl()).toBe(CONFIG.proxyEndpoint);
    expect(modelLanes()).toEqual({ endpoint: CONFIG.proxyEndpoint, token: CONFIG.token });
    runnerEnd.close();
    await done;
    resetRegistryRouteForTests();
    resetModelLanesForTests();
  });

  it("installs no lanes on a runner behind the platform's proxy", async () => {
    resetModelLanesForTests();
    const { runner, runnerEnd, done } = hostProcess([{ harness: "stigmer", adapter: probe("stigmer", []) }]);
    await runner.receivedHello(1_000);
    await runner.call("boot", { harness: "stigmer", config: { ...CONFIG, platformProxied: true } });

    expect(modelLanes()).toBeUndefined();
    runnerEnd.close();
    await done;
    resetRegistryRouteForTests();
  });

  it("signs a running turn's receipts with the key the runner handed", async () => {
    const handed = Buffer.from("k".repeat(32));
    let seen: Buffer | undefined;
    const adapter = probe("stigmer", [], {
      runTurn: async (input) => {
        seen = executionFingerprintKey(input.executionId);
        return { kind: "completed" };
      },
    });
    const { runner, runnerEnd, done } = hostProcess([{ harness: "stigmer", adapter }]);
    await runner.receivedHello(1_000);
    await runner.call("boot", { harness: "stigmer", config: CONFIG });
    await runner.call("runTurn", {
      turnId: "t1",
      harness: "stigmer",
      input: encodeTurnInput(turnInputFixture()),
      status: encodeMessage(RunStatusSchema, create(RunStatusSchema)),
      rows: encodeMessage(TurnRowsSchema, create(TurnRowsSchema)),
      timing: new TimingRecorder().toWire(),
      fingerprintKey: handed.toString("base64"),
      stopped: null,
      yielded: false,
      inputPending: false,
      turnKey: "turn-key-test",
      traceparent: null,
    });

    expect(seen?.equals(handed)).toBe(true);
    runnerEnd.close();
    await done;
    resetRegistryRouteForTests();
    resetModelLanesForTests();
  });

  it("shuts every booted adapter down in reverse order when the channel closes, flushes telemetry and exits 0", async () => {
    const events: string[] = [];
    const failing = probe("claude-probe", events, {
      shutdown: async () => {
        events.push("shutdown claude-probe");
        throw new Error("would not let go");
      },
    });
    const { runner, runnerEnd, log, exits, done, flushed } = hostProcess([
      { harness: "stigmer", adapter: probe("stigmer", events) },
      { harness: "claude", adapter: failing },
    ]);
    await runner.receivedHello(1_000);
    await runner.call("boot", { harness: "stigmer", config: CONFIG });
    await runner.call("boot", { harness: "claude", config: CONFIG });

    runnerEnd.close(new Error("the runner is gone"));
    await done;

    expect(events).toEqual(["boot stigmer", "boot claude-probe", "shutdown claude-probe", "shutdown stigmer"]);
    expect(log).toEqual([
      "[agent-host] channel closed (the runner is gone); shutting down",
      "[agent-host] claude-probe shutdown failed: would not let go",
    ]);
    expect(flushed()).toBe(1);
    expect(exits).toEqual([0]);
    resetRegistryRouteForTests();
    resetModelLanesForTests();
  });

  it("exits within the grace when an adapter's shutdown hangs", async () => {
    const hanging = probe("stigmer", [], { shutdown: () => new Promise<void>(() => {}) });
    const { runner, runnerEnd, exits, done } = hostProcess([{ harness: "stigmer", adapter: hanging }], 20);
    await runner.receivedHello(1_000);
    await runner.call("boot", { harness: "stigmer", config: CONFIG });

    runnerEnd.close();
    await done;
    expect(exits).toEqual([0]);
    resetRegistryRouteForTests();
    resetModelLanesForTests();
  });
});
