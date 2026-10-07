/**
 * Pins what startWorker hands Temporal: the run credential's activity
 * interceptor on every worker (the dispatch's input key is the credential's
 * one channel), no workflow-side interceptor module and no sinks unless
 * OpenTelemetry is configured, and the workflow code the source resolves (a
 * pre-built bundle by path). NativeConnection and Worker are mocked; the
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

vi.mock("../workflow-source.js", () => ({
  resolveWorkflowSource: () => ({ kind: "prebuilt", codePath: "/runner/workflow-bundle.js" }),
  OTEL_WORKFLOW_INTERCEPTOR_MODULE: "@temporalio/interceptors-opentelemetry/lib/workflow",
}));

import type { Config } from "../config.js";
import { runCredentialActivityInterceptor } from "../interceptors/run-credential-activity.js";
import { startWorker, type WorkerActivities } from "../worker.js";

const config = {
  temporalAddress: "127.0.0.1:7233",
  temporalConnection: {},
  temporalNamespace: "default",
  taskQueue: "stigmer_runner",
  maxConcurrentActivities: 4,
} as unknown as Config;

const activities: WorkerActivities = {
  ExecuteCursor: async () => ({}),
  ExecuteDeepAgent: async () => ({}),
};

describe("startWorker", () => {
  let otelEndpoint: string | undefined;

  beforeEach(() => {
    otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    sdk.connect.mockReset().mockResolvedValue(sdk.connection);
    sdk.create.mockReset().mockResolvedValue(sdk.worker);
  });

  afterEach(() => {
    if (otelEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = otelEndpoint;
  });

  it("registers the run credential's activity interceptor and nothing workflow-side without OpenTelemetry", async () => {
    const started = await startWorker({ config, activities });

    expect(sdk.connect).toHaveBeenCalledWith({ address: "127.0.0.1:7233" });
    expect(sdk.create).toHaveBeenCalledTimes(1);
    const options = sdk.create.mock.calls[0]![0];
    expect(options.interceptors).toEqual({ activity: [runCredentialActivityInterceptor] });
    expect(options.sinks).toEqual({});
    expect(options.dataConverter).toBeUndefined();
    expect(started).toEqual({ worker: sdk.worker, connection: sdk.connection });
  });

  it("runs the pre-built bundle the source resolves, on the configured queue, with the codec chain", async () => {
    const codec = { encode: async () => [], decode: async () => [] };
    await startWorker({ config, activities, payloadCodecs: [codec] });

    const options = sdk.create.mock.calls[0]![0];
    expect(options.workflowBundle).toEqual({ codePath: "/runner/workflow-bundle.js" });
    expect(options.workflowsPath).toBeUndefined();
    expect(options.taskQueue).toBe("stigmer_runner");
    expect(options.namespace).toBe("default");
    expect(options.maxConcurrentActivityTaskExecutions).toBe(4);
    expect(options.activities).toBe(activities);
    expect(options.dataConverter).toEqual({ payloadCodecs: [codec] });
  });
});
