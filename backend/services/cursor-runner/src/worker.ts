/**
 * Temporal worker setup for the cursor-runner service.
 *
 * Connects to Temporal, registers the ExecuteCursor activity, and polls the
 * runner's task queue. Mirrors the Python agent-runner's worker.py pattern.
 *
 * Polyglot Architecture:
 * - Go workflow (stigmer-server) orchestrates on "agent_execution_stigmer" queue
 * - Python worker (agent-runner) registers ExecuteGraphton on the runner queue
 * - This TypeScript worker registers ExecuteCursor on the SAME runner queue
 * - Temporal routes by activity type name, not by language
 */

import { NativeConnection, Worker } from "@temporalio/worker";
import type { Config } from "./config.js";
import { createActivities } from "./activity/execute-cursor.js";

export async function startWorker(config: Config): Promise<Worker> {
  const connection = await NativeConnection.connect({
    address: config.temporalAddress,
  });

  const activities = createActivities(config);

  const worker = await Worker.create({
    connection,
    namespace: config.temporalNamespace,
    taskQueue: config.taskQueue,
    activities,
    maxConcurrentActivityTaskExecutions: config.maxConcurrentActivities,
  });

  return worker;
}
