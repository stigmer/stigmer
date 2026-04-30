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

import { loadConfig } from "./config.js";
import { installFetchInterceptor } from "./proxy/fetch-interceptor.js";

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
  console.log(`Task Queue: ${config.taskQueue}`);
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

  const shutdown = async (signal: string) => {
    if (shutdownRequested) {
      console.warn("Shutdown already in progress, ignoring duplicate signal");
      return;
    }
    shutdownRequested = true;
    console.log(`Received ${signal}, stopping worker gracefully...`);
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
