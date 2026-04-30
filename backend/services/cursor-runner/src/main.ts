/**
 * Entry point for the cursor-runner service.
 *
 * Loads configuration from environment variables, starts the Temporal worker,
 * and handles graceful shutdown on SIGTERM/SIGINT.
 *
 * Mirrors the Python agent-runner's __main__.py pattern.
 */

import { loadConfig } from "./config.js";
import { startWorker } from "./worker.js";

let shutdownRequested = false;

async function main(): Promise<void> {
  const config = loadConfig();

  console.log("=".repeat(60));
  console.log(`Stigmer Cursor Runner - ${config.mode.toUpperCase()} Mode`);
  console.log("=".repeat(60));
  console.log(`Task Queue: ${config.taskQueue}`);
  console.log(`Temporal: ${config.temporalAddress} (namespace: ${config.temporalNamespace})`);
  console.log(`Backend: ${config.stigmerBackendEndpoint}`);
  console.log(`Workspace: ${config.workspaceRootDir}`);
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
