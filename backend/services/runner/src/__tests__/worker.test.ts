/**
 * Pins what startWorker hands Temporal: an ACTIVITY worker only (no
 * workflow code at all), the run credential's activity interceptor on every
 * worker (the dispatch's input key is the credential's one channel) and
 * OpenTelemetry's beside it when traces export, the lane's connection
 * options (temporal-lane.ts) with a fixed poll count behind the server, and
 * the heartbeat throttle a cancellation is delivered within
 * (`shared/heartbeat.ts`). NativeConnection and Worker are mocked; the
 * connection and worker the SDK returns are handed back unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  connection: { kind: "connection" },
  worker: { kind: "worker" },
  connect: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@temporalio/worker", () => ({
  NativeConnection: { connect: sdk.connect },
  Worker: { create: sdk.create },
}));

import type { Config } from "../config.js";
import { runCredentialActivityInterceptor } from "../interceptors/run-credential-activity.js";
import { CANCELLATION_PULSE_MS } from "../shared/heartbeat.js";
import { startWorker, type WorkerActivities } from "../worker.js";
import { resetTelemetrySettingsForTests } from "../otel-export.js";
import { THROUGH_SERVER_ACTIVITY_POLLS, type TemporalLane } from "../temporal-lane.js";

const direct: TemporalLane = { kind: "direct", connection: {} };

const config = {
  temporalAddress: "127.0.0.1:7233",
  temporalConnection: {},
  temporalNamespace: "default",
  taskQueue: "stigmer_runner",
  maxConcurrentActivities: 4,
} as unknown as Config;

const activities: WorkerActivities = {
  ExecuteClaude: async () => ({}),
  ExecuteDeepAgent: async () => ({}),
};

describe("startWorker", () => {
  let otelEndpoint: string | undefined;

  beforeEach(() => {
    otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    resetTelemetrySettingsForTests();
    sdk.connect.mockReset().mockResolvedValue(sdk.connection);
    sdk.create.mockReset().mockResolvedValue(sdk.worker);
  });

  afterEach(() => {
    if (otelEndpoint === undefined)
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = otelEndpoint;
  });

  it("adds OpenTelemetry's activity interceptor when the settings export traces", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:4318";
    resetTelemetrySettingsForTests();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await startWorker({ config, activities, lane: direct });
    const options = sdk.create.mock.calls[0]![0] as { interceptors: { activity: unknown[] } };
    expect(options.interceptors.activity).toHaveLength(2);
    resetTelemetrySettingsForTests();
  });

  it("registers the run credential's activity interceptor alone without OpenTelemetry", async () => {
    const started = await startWorker({ config, activities, lane: direct });

    expect(sdk.connect).toHaveBeenCalledWith({ address: "127.0.0.1:7233" });
    expect(sdk.create).toHaveBeenCalledTimes(1);
    const options = sdk.create.mock.calls[0]![0];
    expect(options.interceptors).toEqual({
      activity: [runCredentialActivityInterceptor],
    });
    expect(options.dataConverter).toBeUndefined();
    expect(started).toEqual({ worker: sdk.worker, connection: sdk.connection });
  });

  it("serves activities only, on the configured queue, with the codec chain", async () => {
    const codec = { encode: async () => [], decode: async () => [] };
    await startWorker({ config, activities, payloadCodecs: [codec], lane: direct });

    const options = sdk.create.mock.calls[0]![0];
    expect(options.workflowBundle).toBeUndefined();
    expect(options.workflowsPath).toBeUndefined();
    expect(options.maxConcurrentActivityTaskPolls).toBeUndefined();
    expect(options.taskQueue).toBe("stigmer_runner");
    expect(options.namespace).toBe("default");
    expect(options.maxConcurrentActivityTaskExecutions).toBe(4);
    expect(options.activities).toBe(activities);
    expect(options.dataConverter).toEqual({ payloadCodecs: [codec] });
  });

  it("sends a heartbeat within the cancellation pulse, so a pause reaches a running turn in seconds", async () => {
    await startWorker({ config, activities, lane: direct });

    const options = sdk.create.mock.calls[0]![0];
    expect(options.maxHeartbeatThrottleInterval).toBe(CANCELLATION_PULSE_MS);
  });

  it("connects with the lane's options and polls a fixed few behind the server", async () => {
    await startWorker({
      config,
      activities,
      lane: { kind: "through-server", connection: { apiKey: "tok", tls: false } },
    });
    expect(sdk.connect).toHaveBeenCalledWith({ address: "127.0.0.1:7233", apiKey: "tok", tls: false });
    const options = sdk.create.mock.calls[0]![0];
    expect(options.maxConcurrentActivityTaskPolls).toBe(THROUGH_SERVER_ACTIVITY_POLLS);
  });
});
