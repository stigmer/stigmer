#!/usr/bin/env node

/**
 * CLI entry point for the unified runner service.
 *
 * Two modes of operation:
 *
 * 1. Static mode (default): Reads configuration from environment variables,
 *    initializes OTel, creates a single-queue runner. Used by CLI daemon and
 *    customer deployments.
 *
 * 2. Manager mode (STIGMER_RUNNER_MODE=manager): Reads JSON commands from
 *    stdin, manages per-session Workers dynamically. Used by the desktop app
 *    via the IPC protocol. Responses go to stdout; logs go to stderr.
 *
 * OTel is initialized here (not in the factory) because it mutates
 * global state that the consumer should control when embedding the
 * runner as a library.
 */

import { createInterface } from "node:readline";
import { loadConfig } from "./config.js";
import { initTracing, initMetrics } from "./otel.js";
import { createStigmerRunner } from "./runner.js";
import { createStigmerRunnerManager } from "./runner-manager.js";
import type { StigmerRunnerManager } from "./runner-manager.js";

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection in runner:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception in runner:", err);
});

// ─── IPC Protocol Types ─────────────────────────────────────────────────────

interface IpcAddSession {
  type: "addSession";
  sessionId: string;
}

interface IpcRemoveSession {
  type: "removeSession";
  sessionId: string;
}

interface IpcAddWorkflowExecution {
  type: "addWorkflowExecution";
  executionId: string;
}

interface IpcRemoveWorkflowExecution {
  type: "removeWorkflowExecution";
  executionId: string;
}

interface IpcUpdateToken {
  type: "updateToken";
  token: string | null;
}

interface IpcShutdown {
  type: "shutdown";
}

type IpcCommand =
  | IpcAddSession
  | IpcRemoveSession
  | IpcAddWorkflowExecution
  | IpcRemoveWorkflowExecution
  | IpcUpdateToken
  | IpcShutdown;

interface IpcReady {
  type: "ready";
}

interface IpcSessionAdded {
  type: "sessionAdded";
  sessionId: string;
  taskQueue: string;
}

interface IpcSessionRemoved {
  type: "sessionRemoved";
  sessionId: string;
}

interface IpcWorkflowExecutionAdded {
  type: "workflowExecutionAdded";
  executionId: string;
  taskQueue: string;
}

interface IpcWorkflowExecutionRemoved {
  type: "workflowExecutionRemoved";
  executionId: string;
}

interface IpcError {
  type: "error";
  message: string;
  fatal: boolean;
}

interface IpcTokenUpdated {
  type: "tokenUpdated";
}

interface IpcShutdownComplete {
  type: "shutdownComplete";
}

type IpcResponse =
  | IpcReady
  | IpcSessionAdded
  | IpcSessionRemoved
  | IpcWorkflowExecutionAdded
  | IpcWorkflowExecutionRemoved
  | IpcTokenUpdated
  | IpcError
  | IpcShutdownComplete;

// ─── IPC Helpers ─────────────────────────────────────────────────────────────

function sendIpc(msg: IpcResponse): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

// ─── Manager Mode ────────────────────────────────────────────────────────────

async function runManagerMode(config: import("./config.js").Config): Promise<void> {
  // In manager mode, redirect console.log to stderr so stdout is reserved for IPC
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    process.stderr.write(args.map(String).join(" ") + "\n");
  };

  let manager: StigmerRunnerManager;
  try {
    manager = await createStigmerRunnerManager({
      temporalAddress: config.temporalAddress,
      temporalNamespace: config.temporalNamespace,
      stigmerEndpoint: config.stigmerBackendEndpoint,
      stigmerToken: config.stigmerToken ?? undefined,
      cursorApiKey: config.cursorApiKey || undefined,
      workspaceRootDir: config.workspaceRootDir,
      maxConcurrentActivitiesPerSession: config.maxConcurrentActivities,
      proxyEndpoint: config.proxyEndpoint ?? undefined,
      primaryModel: config.primaryModel,
      checkpointerType: config.checkpointerType,
      checkpointerProxyEndpoint: config.checkpointerProxyEndpoint ?? undefined,
      cloudModeEnabled: config.cloudModeEnabled,
    });
  } catch (err) {
    sendIpc({
      type: "error",
      message: `Failed to initialize runner manager: ${err}`,
      fatal: true,
    });
    process.exit(1);
  }

  sendIpc({ type: "ready" });

  const rl = createInterface({ input: process.stdin });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let cmd: IpcCommand;
    try {
      cmd = JSON.parse(trimmed) as IpcCommand;
    } catch {
      sendIpc({
        type: "error",
        message: `Invalid JSON: ${trimmed}`,
        fatal: false,
      });
      continue;
    }

    try {
      switch (cmd.type) {
        case "addSession": {
          await manager.addSession(cmd.sessionId);
          sendIpc({
            type: "sessionAdded",
            sessionId: cmd.sessionId,
            taskQueue: `session:${cmd.sessionId}`,
          });
          break;
        }
        case "removeSession": {
          await manager.removeSession(cmd.sessionId);
          sendIpc({ type: "sessionRemoved", sessionId: cmd.sessionId });
          break;
        }
        case "addWorkflowExecution": {
          await manager.addWorkflowExecution(cmd.executionId);
          sendIpc({
            type: "workflowExecutionAdded",
            executionId: cmd.executionId,
            taskQueue: `wfexec:${cmd.executionId}`,
          });
          break;
        }
        case "removeWorkflowExecution": {
          await manager.removeWorkflowExecution(cmd.executionId);
          sendIpc({ type: "workflowExecutionRemoved", executionId: cmd.executionId });
          break;
        }
        case "updateToken": {
          manager.updateToken(cmd.token);
          sendIpc({ type: "tokenUpdated" });
          break;
        }
        case "shutdown": {
          await manager.shutdown();
          sendIpc({ type: "shutdownComplete" });
          rl.close();
          return;
        }
        default: {
          sendIpc({
            type: "error",
            message: `Unknown command type: ${(cmd as any).type}`,
            fatal: false,
          });
        }
      }
    } catch (err) {
      sendIpc({
        type: "error",
        message: `Command ${cmd.type} failed: ${err}`,
        fatal: false,
      });
    }
  }

  // stdin closed (parent process died) — shut down gracefully
  await manager.shutdown();
}

// ─── Static Mode ─────────────────────────────────────────────────────────────

async function runStaticMode(config: import("./config.js").Config): Promise<void> {
  const otelShutdown = await initTracing("stigmer-runner");
  const metricsShutdown = await initMetrics("stigmer-runner");

  const runner = await createStigmerRunner({
    taskQueue: config.taskQueue,
    temporalAddress: config.temporalAddress,
    temporalNamespace: config.temporalNamespace,
    stigmerEndpoint: config.stigmerBackendEndpoint,
    stigmerToken: config.stigmerToken ?? undefined,
    cursorApiKey: config.cursorApiKey || undefined,
    workspaceRootDir: config.workspaceRootDir,
    maxConcurrentActivities: config.maxConcurrentActivities,
    proxyEndpoint: config.proxyEndpoint ?? undefined,
    primaryModel: config.primaryModel,
    checkpointerType: config.checkpointerType,
    checkpointerProxyEndpoint: config.checkpointerProxyEndpoint ?? undefined,
    cloudModeEnabled: config.cloudModeEnabled,
  });

  let shutdownRequested = false;
  const shutdown = (signal: string) => {
    if (shutdownRequested) {
      console.warn("Shutdown already in progress, ignoring duplicate signal");
      return;
    }
    shutdownRequested = true;
    console.log(`Received ${signal}, stopping worker gracefully...`);
    runner.shutdown();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  await runner.start();

  if (metricsShutdown) {
    await metricsShutdown();
  }
  if (otelShutdown) {
    await otelShutdown();
  }
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = loadConfig();

  // Set Cursor SDK base URL for proxy mode BEFORE any @cursor/sdk import.
  // The SDK reads CURSOR_API_BASE_URL at module-load time as a top-level
  // constant, so it must be in process.env before activity code is imported.
  //
  // Only CURSOR_API_BASE_URL is set here (Connect RPC transport).
  // CURSOR_BACKEND_URL is intentionally left UNSET so that:
  //   - CloudApiClient defaults to https://api.cursor.com (REST: /v1/models)
  //   - Token exchange defaults to https://api2.cursor.sh (/auth/exchange)
  // Both use globalThis.fetch, which the fetch interceptor rewrites to route
  // through the proxy while preserving the correct upstream host.
  if (config.proxyEndpoint) {
    const proxyBase = config.proxyEndpoint.replace(/\/+$/, "");
    process.env.CURSOR_API_BASE_URL = `${proxyBase}/v1/proxy/cursor/api2.cursor.sh`;
  }

  const runnerMode = process.env.STIGMER_RUNNER_MODE === "manager" ? "manager" : "static";
  console.warn(
    `[runner] mode=${runnerMode}, proxy=${config.proxyEndpoint ?? "none"}, ` +
    `hasToken=${!!config.stigmerToken}, workspace=${config.workspaceRootDir}, ` +
    `taskQueue=${config.taskQueue}`,
  );

  if (runnerMode === "manager") {
    await runManagerMode(config);
  } else {
    await runStaticMode(config);
  }
}

main().catch((err) => {
  console.error("Fatal error in runner:", err);
  process.exit(1);
});
