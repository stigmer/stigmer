/**
 * Temporal worker setup for the unified runner service.
 *
 * Registers both activities and workflows on a single queue.
 *
 * Workflows:
 * - "stigmer/mcp-server/connect" — ConnectMcpServerWorkflow (discover + classify)
 * - "stigmer/mcp-server/discover" — Legacy discover-only workflow
 *
 * Architecture:
 * - Java backend starts connect workflows on the runner's task queue
 * - This TypeScript worker handles both workflow and activity tasks
 * - Activities are dispatched by name within the same queue
 */

import { fileURLToPath } from "node:url";
import { NativeConnection, Worker, type ActivityInterceptorsFactory } from "@temporalio/worker";
import type { Config } from "./config.js";

export interface WorkerActivities {
  [key: string]: (...args: any[]) => Promise<unknown>;
}

export async function startWorker(
  config: Config,
  activities: WorkerActivities,
): Promise<Worker> {
  const connection = await NativeConnection.connect({
    address: config.temporalAddress,
  });

  const activityInterceptors: ActivityInterceptorsFactory[] = [];
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const { OpenTelemetryActivityInboundInterceptor } = await import(
      "@temporalio/interceptors-opentelemetry"
    );
    activityInterceptors.push(
      (ctx) => ({ inbound: new OpenTelemetryActivityInboundInterceptor(ctx) }),
    );
    console.log("Temporal OpenTelemetry activity interceptor enabled");
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
    interceptors: activityInterceptors.length > 0
      ? { activity: activityInterceptors }
      : undefined,
  });

  return worker;
}
