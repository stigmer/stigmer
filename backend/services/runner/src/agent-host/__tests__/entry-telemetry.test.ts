/**
 * The agent host's telemetry (`agent-host/entry.ts`), driven in-process:
 * the runner's side is a peer on a loopback channel, the adapter a probe,
 * telemetry's start a spy.
 *
 * Pinned:
 *  - the host reads no telemetry setting of its own: before the runner's
 *    configuration arrives it exports nothing, whatever `OTEL_` variables
 *    its environment holds;
 *  - at the first boot it adopts the runner's settings as they came and
 *    starts telemetry once, through the runner's local proxy with the
 *    host's own token;
 *  - a telemetry start that fails is logged and never refuses the boot;
 *  - the flush runs when the channel closes.
 */

import { afterEach, describe, expect, it } from "vitest";

import { DEEP_AGENT_CAPABILITIES } from "../../activities/execute-deep-agent/deep-agent-capabilities.js";
import type { HarnessRow } from "../../harness/registry.js";
import type { HarnessAdapter } from "../../harness/types.js";
import {
  TELEMETRY_OFF,
  resetTelemetrySettingsForTests,
  telemetrySettings,
  type TelemetryLane,
  type TelemetrySettings,
} from "../../otel-export.js";
import { resetModelLanesForTests } from "../../shared/model-lanes.js";
import { resetRegistryRouteForTests } from "../../shared/registry-endpoint.js";
import { Peer, loopbackChannels } from "../channel.js";
import { runAgentHostProcess } from "../entry.js";
import type { HostCalls, HostConfigWire, HostNotices, RunnerCalls, RunnerNotices } from "../protocol.js";

const SETTINGS: TelemetrySettings = {
  traces: { enabled: true, protocol: "http/json" },
  metrics: { enabled: false, protocol: "http/protobuf" },
  content: true,
  batchSize: 32,
};

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
  platformProxied: true,
  telemetry: SETTINGS,
};

function probe(): HarnessAdapter {
  return {
    name: "stigmer",
    capabilities: DEEP_AGENT_CAPABILITIES,
    boot: async () => {},
    shutdown: async () => {},
    releaseSession: async () => {},
    runTurn: async () => ({ kind: "completed" }),
  };
}

function hostProcess(initTelemetry: (lane: TelemetryLane) => Promise<(() => Promise<void>) | null>) {
  const [runnerEnd, hostEnd] = loopbackChannels();
  const runner = new Peer<HostCalls, RunnerCalls, RunnerNotices, HostNotices>(runnerEnd, "runner");
  const log: string[] = [];
  const rows: readonly HarnessRow[] = [{ harness: "stigmer", adapter: probe() }];
  const done = runAgentHostProcess({
    channel: hostEnd,
    rows,
    initTelemetry,
    exit: () => {},
    log: (message) => void log.push(message),
  });
  return { runner, runnerEnd, log, done };
}

const ENV_NAMES = ["OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"] as const;
const savedEnv = new Map(ENV_NAMES.map((name) => [name, process.env[name]] as const));

afterEach(() => {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetTelemetrySettingsForTests();
  resetRegistryRouteForTests();
  resetModelLanesForTests();
});

describe("the agent host's telemetry", () => {
  it("exports nothing before the runner's configuration, whatever its environment says", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://collector.example:4318";
    process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = "true";
    const lanes: TelemetryLane[] = [];
    const { runner, runnerEnd, done } = hostProcess(async (lane) => {
      lanes.push(lane);
      return null;
    });
    await runner.receivedHello(1_000);

    expect(telemetrySettings()).toEqual(TELEMETRY_OFF);
    expect(lanes).toEqual([]);
    runnerEnd.close();
    await done;
  });

  it("adopts the runner's settings at the first boot and starts telemetry once, through the local proxy", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://collector.example:4318";
    const lanes: TelemetryLane[] = [];
    const { runner, runnerEnd, done } = hostProcess(async (lane) => {
      lanes.push(lane);
      return null;
    });
    await runner.receivedHello(1_000);
    await runner.call("boot", { harness: "stigmer", config: CONFIG });
    await runner.call("boot", { harness: "stigmer", config: { ...CONFIG, telemetry: TELEMETRY_OFF } });

    expect(telemetrySettings(), "the first boot's settings, never re-read").toEqual(SETTINGS);
    expect(lanes).toEqual([{ endpoint: CONFIG.proxyEndpoint, token: CONFIG.token }]);
    runnerEnd.close();
    await done;
  });

  it("logs a telemetry start that fails and still boots", async () => {
    const { runner, runnerEnd, log, done } = hostProcess(async () => {
      throw new Error("no exporter");
    });
    await runner.receivedHello(1_000);
    await expect(runner.call("boot", { harness: "stigmer", config: CONFIG })).resolves.toBeNull();

    expect(log).toContain("[agent-host] telemetry not started: no exporter");
    runnerEnd.close();
    await done;
  });

  it("flushes telemetry when the channel closes", async () => {
    let flushed = 0;
    const { runner, runnerEnd, done } = hostProcess(async () => async () => {
      flushed += 1;
    });
    await runner.receivedHello(1_000);
    await runner.call("boot", { harness: "stigmer", config: CONFIG });
    expect(flushed).toBe(0);

    runnerEnd.close();
    await done;
    expect(flushed).toBe(1);
  });
});
