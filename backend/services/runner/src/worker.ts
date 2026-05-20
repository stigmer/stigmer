/**
 * Temporal worker setup for the unified runner service.
 *
 * Registers both activities and workflows on a single queue.
 *
 * Workflows:
 * - "stigmer/mcp-server/connect" — ConnectMcpServerWorkflow (discover + classify)
 * - "stigmer/mcp-server/discover" — Legacy discover-only workflow
 * - "stigmer/workflow/execute" — CNCF Serverless Workflow execution
 *
 * Architecture:
 * - Java backend starts connect workflows on the runner's task queue
 * - This TypeScript worker handles both workflow and activity tasks
 * - Activities are dispatched by name within the same queue
 */

import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { NativeConnection, Worker, type ActivityInterceptorsFactory, type InjectedSinks } from "@temporalio/worker";
import type { PayloadCodec } from "@temporalio/common";
import type { Config } from "./config.js";

export interface WorkerActivities {
  [key: string]: (...args: any[]) => Promise<unknown>;
}

export interface StartWorkerOptions {
  config: Config;
  activities: WorkerActivities;
  payloadCodec?: PayloadCodec;
}

export async function startWorker(opts: StartWorkerOptions): Promise<Worker> {
  const { config, activities, payloadCodec } = opts;

  const connection = await NativeConnection.connect({
    address: config.temporalAddress,
  });

  const { createWorkflowMetricsSinks } = await import("./interceptors/workflow-metrics-sink.js");

  const activityInterceptors: ActivityInterceptorsFactory[] = [];
  let sinks: InjectedSinks<any> = { ...createWorkflowMetricsSinks() };
  const workflowInterceptorModules: string[] = [];

  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const {
      OpenTelemetryActivityInboundInterceptor,
      makeWorkflowExporter,
    } = await import("@temporalio/interceptors-opentelemetry");
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-grpc");
    const { resourceFromAttributes } = await import("@opentelemetry/resources");

    activityInterceptors.push(
      (ctx) => ({ inbound: new OpenTelemetryActivityInboundInterceptor(ctx) }),
    );

    const resource = resourceFromAttributes({ "service.name": "stigmer-runner" });
    const exporter = new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    });
    // Type assertion needed due to OTel SDK version mismatch between
    // @temporalio/interceptors-opentelemetry's bundled types and ours.
    // Runtime types are compatible — this is a pure type-system issue.
    const otelSinks = makeWorkflowExporter(exporter as any, resource as any) as unknown as InjectedSinks<any>;
    sinks = { ...sinks, ...otelSinks };

    const esmRequire = createRequire(import.meta.url);
    workflowInterceptorModules.push(
      esmRequire.resolve("@temporalio/interceptors-opentelemetry/lib/workflow-interceptors"),
    );

    console.log("Temporal OpenTelemetry interceptors enabled (activity + workflow)");
  }

  const workflowsPath = fileURLToPath(
    new URL("./workflows/index.js", import.meta.url),
  );

  const worker = await Worker.create({
    connection,
    namespace: config.temporalNamespace,
    taskQueue: config.taskQueue,
    activities,
    workflowsPath,
    maxConcurrentActivityTaskExecutions: config.maxConcurrentActivities,
    dataConverter: payloadCodec
      ? { payloadCodecs: [payloadCodec] }
      : undefined,
    sinks,
    interceptors: {
      ...(activityInterceptors.length > 0 ? { activity: activityInterceptors } : {}),
      ...(workflowInterceptorModules.length > 0 ? { workflowModules: workflowInterceptorModules } : {}),
    },
  });

  return worker;
}
