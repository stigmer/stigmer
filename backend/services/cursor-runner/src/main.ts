#!/usr/bin/env node

/**
 * Entry point for the cursor-runner service.
 *
 * IMPORTANT: The fetch interceptor MUST be installed before any module that
 * imports @cursor/sdk. The SDK captures a reference to fetch() at import
 * time, so the interceptor must be in place first. This is why we load
 * config and install the interceptor before the dynamic import of worker.
 *
 * Mirrors the Python agent-runner's __main__.py pattern.
 */

import { loadConfig, CURSOR_QUEUE_SUFFIX } from "./config.js";
import { installFetchInterceptor } from "./proxy/fetch-interceptor.js";
import { startIdleWatchdog } from "./idle-watchdog.js";

// The Cursor SDK fires background promises (API key exchange, telemetry,
// heartbeats) that can reject outside any async context our activity code
// controls. Without these handlers, a single transient network blip inside
// the SDK kills the entire Temporal worker process — cascading to every
// queued activity on this runner.
//
// Strategy: log aggressively, but keep the process alive. The Temporal
// worker itself handles activity-level failures via retry policies; the
// worst outcome of swallowing here is a single activity timeout rather
// than a full worker crash.
process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  console.error(
    "[cursor-runner] Unhandled promise rejection (process kept alive):",
    err.message,
  );
  if (err.stack) console.error(err.stack);
  if ("cause" in err && err.cause) console.error("Cause:", err.cause);
});

process.on("uncaughtException", (err, origin) => {
  console.error(
    `[cursor-runner] Uncaught exception (origin: ${origin}):`,
    err.message,
  );
  if (err.stack) console.error(err.stack);
  // uncaughtException from a throw (not a rejection) may leave the process
  // in an undefined state. We log but do NOT exit — the Temporal worker's
  // own health checks will detect a wedged worker and stop polling.
});

let shutdownRequested = false;

async function main(): Promise<void> {
  const config = loadConfig();

  // Install the fetch interceptor BEFORE importing the worker module,
  // which transitively imports @cursor/sdk. In proxy mode, all outbound
  // Cursor SDK requests are rewritten to route through Stigmer's proxy.
  installFetchInterceptor({
    proxyEndpoint: config.proxyEndpoint ?? undefined,
    stigmerToken: config.stigmerToken ?? undefined,
  });

  // Dynamic import: worker.ts → execute-cursor.ts → @cursor/sdk.
  // The SDK captures global.fetch at module evaluation time, so the
  // interceptor above must already be installed.
  const { startWorker } = await import("./worker.js");

  console.log("=".repeat(60));
  console.log(`Stigmer Cursor Runner - ${config.mode.toUpperCase()} Mode`);
  console.log("=".repeat(60));
  console.log(`Task Queue: ${config.taskQueue}${CURSOR_QUEUE_SUFFIX}`);
  console.log(`Temporal: ${config.temporalAddress} (namespace: ${config.temporalNamespace})`);
  console.log(`Backend: ${config.stigmerBackendEndpoint}`);
  console.log(`Workspace: ${config.workspaceRootDir}`);
  if (config.proxyEndpoint) {
    console.log(`Proxy: ${config.proxyEndpoint} (credential-free mode)`);
  } else {
    console.log(`Proxy: disabled (direct Cursor API key)`);
  }
  console.log("=".repeat(60));

  const worker = await startWorker(config);

  // Idle watchdog: self-terminate after sustained inactivity. Serves as
  // a safety net for ephemeral cloud runners and orphaned processes.
  // Disabled for local runners (idleTimeoutSeconds is null when the env
  // var is not set).
  let stopIdleWatchdog: (() => void) | undefined;
  if (config.idleTimeoutSeconds != null && config.idleTimeoutSeconds > 0) {
    stopIdleWatchdog = startIdleWatchdog(worker, config.idleTimeoutSeconds);
  }

  const shutdown = async (signal: string) => {
    if (shutdownRequested) {
      console.warn("Shutdown already in progress, ignoring duplicate signal");
      return;
    }
    shutdownRequested = true;
    console.log(`Received ${signal}, stopping worker gracefully...`);
    stopIdleWatchdog?.();
    worker.shutdown();
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  console.log("Worker ready, polling for tasks...");
  await worker.run();
  console.log("Worker stopped");
}

main().catch((err) => {
  console.error("Fatal error in cursor-runner:", err);
  process.exit(1);
});
