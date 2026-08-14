#!/usr/bin/env node

/**
 * CLI entry point for the unified runner service.
 *
 * Three modes of operation:
 *
 * 1. Static mode (default): Reads configuration from environment variables,
 *    initializes OTel, creates a single-queue runner. Used by CLI daemon and
 *    customer deployments.
 *
 * 2. Manager mode (STIGMER_RUNNER_MODE=manager): Reads JSON commands from
 *    stdin, manages per-session Workers dynamically. Used by the desktop app
 *    via the IPC protocol. Responses go to stdout; logs go to stderr.
 *
 * 3. Pool mode (STIGMER_POOL_MEMBER_ID set): A warm-pool cloud sandbox. Boots
 *    the runner manager, then serves whatever its Secret-injected credential
 *    says it is: a pool_sandbox token means "blank member" (poll the
 *    sandbox:{memberId} control queue for a claim), a session token means
 *    "claimed member that restarted" (go straight to that session's queue).
 *    See pool-member.ts for the identity model.
 *
 * OTel is initialized here (not in the factory) because it mutates
 * global state that the consumer should control when embedding the
 * runner as a library.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { createInterface } from "node:readline";
import { preflightNodeRuntime } from "./preflight.js";
import { markBoot, emitRunnerBootTiming } from "./shared/cold-start-timing.js";
import { loadConfig } from "./config.js";
import {
  captureRunnerSecrets,
  getRunnerSecret,
} from "./shared/runner-credential-store.js";
import { initTracing, initMetrics } from "./otel.js";
import { createStigmerRunner } from "./runner.js";
import { createStigmerRunnerManager } from "./runner-manager.js";
import type { StigmerRunnerManager } from "./runner-manager.js";
import { decidePoolBoot, registerPoolMemberContext } from "./pool-member.js";
import { buildReadyMessage } from "./ipc-protocol.js";
import type { IpcCommand, IpcResponse } from "./ipc-protocol.js";

import { handleUnhandledRejection, setExecutionContextRef } from "./activities/execute-cursor/rejection-capture.js";
import { installProcessPipeGuards, reportFatal } from "./pipe-safety.js";

// Guard the host pipes before anything writes to them. A dropped stderr/stdout
// reader otherwise turns the next write into an uncaught EPIPE loop that starves
// Temporal heartbeats and kills the in-flight execution (issue #177).
const { writeStdout, writeStderr } = installProcessPipeGuards();

process.on("unhandledRejection", (reason) => {
  handleUnhandledRejection(reason);
});

process.on("uncaughtException", (err) => {
  reportFatal(writeStderr, "Uncaught exception in runner:", err);
});

// ─── IPC Helpers ─────────────────────────────────────────────────────────────

function sendIpc(msg: IpcResponse): void {
  writeStdout(JSON.stringify(msg) + "\n");
}

// ─── Manager Mode ────────────────────────────────────────────────────────────

async function runManagerMode(config: import("./config.js").Config): Promise<void> {
  // In manager mode, redirect console.log to stderr so stdout is reserved for IPC
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    writeStderr(args.map(String).join(" ") + "\n");
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
      executionMode: config.mode,
    });
  } catch (err) {
    sendIpc({
      type: "error",
      message: `Failed to initialize runner manager: ${err}`,
      fatal: true,
    });
    process.exit(1);
  }

  sendIpc(buildReadyMessage());

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

// ─── Pool Mode ───────────────────────────────────────────────────────────────

async function runPoolMode(
  config: import("./config.js").Config,
  memberId: string,
): Promise<void> {
  const otelShutdown = await initTracing("stigmer-runner");
  const metricsShutdown = await initMetrics("stigmer-runner");

  // The Secret-injected credential is the single source of truth for what this
  // process serves (the control plane rewrites the Secret at claim time, and
  // secretKeyRef env is read only at pod start — so a restart lands here with
  // the post-claim identity). Decide before any expensive boot work.
  const intent = decidePoolBoot(config.stigmerToken);
  if (intent.kind === "invalid") {
    throw new Error(`Pool member ${memberId} cannot boot: ${intent.reason}`);
  }

  const manager = await createStigmerRunnerManager({
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
    executionMode: config.mode,
  });

  // Sandbox credential self-renewal (see sandbox-token-renewal.ts). Watches
  // the credential store because manager.updateToken keeps it in lockstep
  // with the manager's internal ref: a blank member's pool_sandbox token
  // parks the loop, the claim's updateToken swaps in a renewable session
  // token, and from then on renewal applies fresh tokens back through the
  // same updateToken (which also cascades to the proxy-credential
  // coordinator).
  const { startSandboxTokenRenewal } = await import("./sandbox-token-renewal.js");
  const { StigmerClient } = await import("./client/stigmer-client.js");
  const renewalClient = new StigmerClient({
    endpoint: config.stigmerBackendEndpoint,
    token: null,
  });
  const tokenRenewal = startSandboxTokenRenewal({
    getToken: () => getRunnerSecret("STIGMER_TOKEN") ?? null,
    renew: (currentToken) =>
      renewalClient.getRunnerScopedToken({ renewal: true }, currentToken),
    applyToken: (token) => manager.updateToken(token),
  });

  let taskQueue: string;
  if (intent.kind === "pool-control") {
    registerPoolMemberContext({
      memberId,
      poolToken: config.stigmerToken!,
      manager,
    });
    await manager.addPoolControl(memberId);
    taskQueue = `sandbox:${memberId}`;
  } else {
    // Claimed member after a restart: the pool row is gone and nothing will
    // dispatch on the control queue again, so no pool context, no control
    // worker — just serve the session this pod already belongs to.
    console.warn(
      `[pool-member] ${memberId} restarted post-claim; ` +
      `resuming session ${intent.sessionId}`,
    );
    await manager.addSession(intent.sessionId);
    taskQueue = `session:${intent.sessionId}`;
  }

  // The boot window the pool exists to hide from users: emitted with pool
  // context so the baseline harness can separate member pre-boots (background,
  // free) from user-facing boots.
  markBoot("worker_polling");
  emitRunnerBootTiming({
    task_queue: taskQueue,
    mode: config.mode,
    pool_member_id: memberId,
    pool_rehydrated: intent.kind === "claimed-session",
  });

  console.warn(`[pool-member] ${memberId} ready (queue=${taskQueue})`);

  // Idle-time warm-up (issue #209): pay the Cursor SDK's per-process SQLite
  // cost now, while the member waits for a claim, instead of inside the
  // claimed session's first resolve_agent. Fire-and-forget by design —
  // pool-control members only (a claimed-session restart serves immediately
  // and must not compete with its own executions).
  if (intent.kind === "pool-control") {
    const { warmCursorSdkStateStores } = await import("./activities/execute-cursor/sdk-warmup.js");
    void warmCursorSdkStateStores().then((result) => {
      if (result.warmed) {
        console.log(`[pool-member] Cursor SDK state stores warmed in ${result.durationMs}ms`);
      } else {
        console.warn(
          `[pool-member] Cursor SDK warm-up skipped (non-fatal): ${result.error} ` +
          `(${result.durationMs}ms)`,
        );
      }
    });
  }

  // Park until terminated; the workers poll in the background. Unlike manager
  // mode there is no stdin driver — Kubernetes signals are the only exit.
  await new Promise<void>((resolve) => {
    let shutdownRequested = false;
    const shutdown = (signal: string) => {
      if (shutdownRequested) {
        console.warn("Shutdown already in progress, ignoring duplicate signal");
        return;
      }
      shutdownRequested = true;
      console.warn(`[pool-member] Received ${signal}, shutting down gracefully...`);
      tokenRenewal.stop();
      void manager.shutdown().then(resolve, (err) => {
        console.error("[pool-member] Shutdown failed:", err);
        resolve();
      });
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  });

  if (metricsShutdown) {
    await metricsShutdown();
  }
  if (otelShutdown) {
    await otelShutdown();
  }
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
    // Honor the operator's MODE env (resolved into config.mode) instead of
    // re-deriving execution location from the proxy. This keeps static mode
    // consistent with manager mode, which already passes config.mode.
    executionMode: config.mode,
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

// ─── Build Fingerprint Check ─────────────────────────────────────────────────

/**
 * Compares the dist/.build-fingerprint against the current src/ hash.
 * Exits the process if the runner binary is stale — silently running
 * old code causes structured output failures, naming mismatches, and
 * hours of wasted debugging time.
 *
 * If the fingerprint file is missing (first build, CI, integration
 * tests using tsx), the check is skipped gracefully.
 */
function checkBuildFreshness(): void {
  try {
    const runnerRoot = new URL("../", import.meta.url).pathname;
    const fpPath = join(runnerRoot, "dist", ".build-fingerprint");

    let stored: { hash: string; builtAt: string };
    try {
      stored = JSON.parse(readFileSync(fpPath, "utf-8"));
    } catch {
      return;
    }

    const srcDir = join(runnerRoot, "src");
    const tsFiles = collectTsFiles(srcDir).sort();
    const hash = createHash("sha256");
    for (const file of tsFiles) {
      hash.update(relative(runnerRoot, file));
      hash.update(readFileSync(file));
    }
    const currentHash = hash.digest("hex").slice(0, 16);

    if (currentHash !== stored.hash) {
      console.error(
        `\n` +
        `!!! STALE RUNNER BUILD — REFUSING TO START !!!\n` +
        `    dist/ was built at ${stored.builtAt} (hash ${stored.hash})\n` +
        `    src/ has changed since (current hash ${currentHash})\n` +
        `\n` +
        `    Run 'make build-runner' or 'make desktop-dev' to rebuild.\n`,
      );
      process.exit(78);
    }
  } catch {
    // Missing fingerprint (tsx, CI, first build) — allow startup
  }
}

function collectTsFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      collectTsFiles(fullPath, files);
    } else if (entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Runtime capability gate FIRST: everything below (config load, manager /
  // static init) eventually imports node:sqlite via the checkpointer chain,
  // and the raw ERR_UNKNOWN_BUILTIN_MODULE from that import is inscrutable.
  // In manager mode the host reads the first stdout line as the handshake, so
  // a fatal IPC error here surfaces verbatim in the host's UI (see
  // negotiate_ready in crates/stigmer-runner-host/src/host.rs).
  const preflightError = preflightNodeRuntime();
  if (preflightError !== null) {
    if (process.env.STIGMER_RUNNER_MODE === "manager") {
      sendIpc({ type: "error", message: preflightError, fatal: true });
    } else {
      writeStderr(`${preflightError}\n`);
    }
    process.exit(1);
  }
  // Cold-start timeline: this first mark's span covers Node startup +
  // entrypoint module loading + preflight (origin = process start).
  markBoot("node_start_and_preflight");

  checkBuildFreshness();

  // Take custody of runner secrets before the config load reads them (#508).
  // The factories capture too (they are the library boot doors); doing it
  // here as well keeps main.ts's own late readers store-only from the start.
  captureRunnerSecrets();

  const config = loadConfig();
  markBoot("config_loaded");

  // Route ALL Cursor SDK traffic through the Stigmer proxy in proxy mode.
  //
  // CURSOR_BACKEND_URL controls:
  //   1. connect-node Connect RPC transport (AgentService/Run BiDi stream)
  //   2. Token exchange (fetch to ${baseUrl}/auth/exchange_user_api_key)
  //   3. CloudApiClient REST (fetch to ${baseUrl}/v1/models, agent CRUD)
  //
  // Setting it to proxyEndpoint makes connect-node send the BiDi stream to
  // the proxy, where path routing (Caddy/Istio) dispatches /agent.v1* to the
  // Netty BiDi proxy on port 8082.
  //
  // Side-effect: REST calls (#2, #3) also target proxyEndpoint via fetch.
  // The fetch interceptor detects these (proxy-endpoint host, non-Connect path)
  // and rewrites them to /v1/proxy/cursor/{upstream_host}{path} for Tomcat.
  //
  // CURSOR_API_BASE_URL is also set for completeness — older SDK versions
  // may read it for token exchange instead of CURSOR_BACKEND_URL.
  if (config.proxyEndpoint) {
    const proxyBase = config.proxyEndpoint.replace(/\/+$/, "");
    process.env.CURSOR_BACKEND_URL = proxyBase;
    process.env.CURSOR_API_BASE_URL = proxyBase;
  }

  const poolMemberId = process.env.STIGMER_POOL_MEMBER_ID?.trim() || undefined;
  const runnerMode =
    process.env.STIGMER_RUNNER_MODE === "manager" ? "manager"
    : poolMemberId ? "pool"
    : "static";
  console.warn(
    `[runner] mode=${runnerMode}, proxy=${config.proxyEndpoint ?? "none"}, ` +
    `hasToken=${!!config.stigmerToken}, workspace=${config.workspaceRootDir}, ` +
    `taskQueue=${config.taskQueue}`,
  );

  if (runnerMode === "manager") {
    await runManagerMode(config);
    // Manager mode is driven by the host over stdin. Once it returns — via the IPC `shutdown`
    // command or stdin EOF when the host process dies — exit deterministically so a stray open
    // handle can't keep a shut-down runner alive as an orphan (issue #177). Static mode is left
    // to exit naturally so its OTel flush completes.
    process.exit(0);
  }

  if (runnerMode === "pool") {
    await runPoolMode(config, poolMemberId!);
    return;
  }

  await runStaticMode(config);
}

main().catch((err) => {
  reportFatal(writeStderr, "Fatal error in runner:", err);
  process.exit(1);
});
