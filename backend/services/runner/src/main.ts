#!/usr/bin/env node

/**
 * Entry point for the unified runner service.
 *
 * Boot sequence:
 * 1. Load config from environment
 * 2. Initialize OTel tracing (if endpoint set)
 * 3. Install fetch interceptor (for Cursor SDK proxy mode)
 * 4. Import activity factories (after interceptor is in place)
 * 5. Start Temporal Worker with all activities registered
 * 6. Start server heartbeat (if runner ID is set)
 * 7. Listen for shutdown signals
 *
 * The fetch interceptor MUST be installed before any module that imports
 * @cursor/sdk. The SDK captures a reference to fetch() at import time.
 */

import { loadConfig } from "./config.js";
import { initTracing } from "./otel.js";
import { startHeartbeat } from "./heartbeat.js";

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection in runner:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception in runner:", err);
});

let shutdownRequested = false;

async function main(): Promise<void> {
  const config = loadConfig();

  const otelShutdown = await initTracing("stigmer-runner");

  // Install fetch interceptor BEFORE importing cursor-related modules.
  // This patches global.fetch for proxy mode (cloud runners).
  const { installFetchInterceptor } = await import("./activities/execute-cursor/fetch-interceptor.js");
  installFetchInterceptor({
    proxyEndpoint: config.proxyEndpoint ?? undefined,
    stigmerToken: config.stigmerToken ?? undefined,
  });

  // Dynamic imports after interceptor is in place
  const { createCursorActivities } = await import("./activities/execute-cursor/index.js");
  const { createDeepAgentActivities } = await import("./activities/execute-deep-agent/index.js");
  const { startWorker } = await import("./worker.js");

  const cursorActivities = createCursorActivities(config);
  const deepAgentActivities = createDeepAgentActivities(config);

  const allActivities = {
    ...cursorActivities,
    ...deepAgentActivities,
  };

  console.log(
    `[runner] Registered activities: ${Object.keys(allActivities).join(", ")}`,
  );
  console.log(
    `[runner] Task queue: ${config.taskQueue} | ` +
    `Mode: ${config.mode} | ` +
    `Max concurrency: ${config.maxConcurrentActivities}`,
  );

  const worker = await startWorker(config, allActivities);

  const stopHeartbeat = startHeartbeat(config);

  const shutdown = async (signal: string) => {
    if (shutdownRequested) {
      console.warn("Shutdown already in progress, ignoring duplicate signal");
      return;
    }
    shutdownRequested = true;
    console.log(`Received ${signal}, stopping worker gracefully...`);
    stopHeartbeat();
    worker.shutdown();
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  console.log("Worker ready, polling for tasks...");
  await worker.run();

  if (otelShutdown) {
    await otelShutdown();
  }
  console.log("Worker stopped");
}

main().catch((err) => {
  console.error("Fatal error in runner:", err);
  process.exit(1);
});
