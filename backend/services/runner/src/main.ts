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

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { createInterface } from "node:readline";
import { preflightNodeRuntime } from "./preflight.js";
import { markBoot } from "./shared/cold-start-timing.js";
import { loadConfig } from "./config.js";
import { operatorBounds } from "./operator-bounds.js";
import { captureRunnerSecrets } from "./shared/runner-credential-store.js";
import { initTracing, initMetrics, startRunnerTelemetry } from "./otel.js";
import { createStigmerRunner } from "./runner.js";
import { createStigmerRunnerManager } from "./runner-manager.js";
import type { StigmerRunnerManager } from "./runner-manager.js";
import { buildReadyMessage } from "./ipc-protocol.js";
import { AGENT_HOST_MODE_ARG } from "./agent-host/protocol.js";
import type { IpcCommand, IpcResponse } from "./ipc-protocol.js";

import { installProcessPipeGuards, reportFatal } from "./pipe-safety.js";
import { armExitBackstop } from "./exit-backstop.js";

// Guard the host pipes before anything writes to them. A dropped stderr/stdout
// reader otherwise turns the next write into an uncaught EPIPE loop that starves
// Temporal heartbeats and kills the in-flight execution (issue #177).
const { writeStdout, writeStderr } = installProcessPipeGuards();

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection in runner:", reason);
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
  // The manager is the runner's own process (the CLI and the desktop app
  // start it), so it owns its telemetry as static mode does; a setting
  // the standard does not name is the same fatal error as any other.
  /* v8 ignore start -- @preserve: manager mode's process boundary, driven over IPC by test/conformance's runner-ipc harness; startRunnerTelemetry is otel.ts's, tested there; the options become a Config in mapManagerOptionsToConfig, and __tests__/operator-bounds.test.ts reads the bounds spread below off this source */
  let flushTelemetry: (() => Promise<void>) | null = null;
  try {
    flushTelemetry = await startRunnerTelemetry("stigmer-runner");
    manager = await createStigmerRunnerManager({
      temporalAddress: config.temporalAddress,
      temporalNamespace: config.temporalNamespace,
      stigmerEndpoint: config.stigmerBackendEndpoint,
      stigmerToken: config.stigmerTokenRef.current ?? undefined,
      workspaceRootDir: config.workspaceRootDir,
      maxConcurrentActivitiesPerSession: config.maxConcurrentActivities,
      proxyEndpoint: config.proxyEndpoint ?? undefined,
      primaryModel: config.primaryModel,
      checkpointerType: config.checkpointerType,
      checkpointerProxyEndpoint: config.checkpointerProxyEndpoint ?? undefined,
      artifactProxyEndpoint: config.artifactProxyEndpoint ?? undefined,
      executionMode: config.mode,
      ...operatorBounds(config),
    });
    /* v8 ignore stop */
  } catch (err) {
    sendIpc({
      type: "error",
      message: `Failed to initialize runner manager: ${err}`,
      fatal: true,
    });
    process.exit(1);
  }

  /* v8 ignore start -- @preserve: manager mode's process boundary (above) */
  // Every way the manager stops (the shutdown command, stdin closing) flushes
  // its telemetry after its workers have drained.
  const shutdownWorkers = manager.shutdown.bind(manager);
  manager.shutdown = async () => {
    await shutdownWorkers();
    await flushTelemetry?.();
  };
  /* v8 ignore stop */

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

  /* v8 ignore start -- @preserve: static mode's process boundary, booted by the CLI daemon as the execution conformance lanes run it; the options become a Config in mapOptionsToConfig, and __tests__/operator-bounds.test.ts reads the bounds spread below off this source */
  const runner = await createStigmerRunner({
    taskQueue: config.taskQueue,
    temporalAddress: config.temporalAddress,
    temporalNamespace: config.temporalNamespace,
    stigmerEndpoint: config.stigmerBackendEndpoint,
    stigmerToken: config.stigmerTokenRef.current ?? undefined,
    workspaceRootDir: config.workspaceRootDir,
    maxConcurrentActivities: config.maxConcurrentActivities,
    proxyEndpoint: config.proxyEndpoint ?? undefined,
    primaryModel: config.primaryModel,
    checkpointerType: config.checkpointerType,
    checkpointerProxyEndpoint: config.checkpointerProxyEndpoint ?? undefined,
    artifactProxyEndpoint: config.artifactProxyEndpoint ?? undefined,
    // Honor the operator's MODE env (resolved into config.mode) instead of
    // re-deriving execution location from the proxy. This keeps static mode
    // consistent with manager mode, which already passes config.mode.
    executionMode: config.mode,
    drainGraceMs: config.drainGraceMs,
    ...operatorBounds(config),
  });
  /* v8 ignore stop */

  let shutdownRequested = false;
  /* v8 ignore start -- @preserve: static mode's process boundary (signals); the escalation it asks for is runner.ts's shutdown, and the per-queue drain and stop-now signals are shared/worker-shutdown.ts's, tested there */
  const shutdown = (signal: string) => {
    if (shutdownRequested) {
      console.warn(`Received ${signal} again, stopping in-flight turns now; they continue on the next runner`);
      runner.shutdown();
      return;
    }
    shutdownRequested = true;
    console.log(`Received ${signal}, stopping worker gracefully (in-flight turns yield within ${config.drainGraceMs} ms)...`);
    runner.shutdown();
  };
  /* v8 ignore stop */

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
  // The runner's own entry, started by the runner as its agent host
  // (`agent-host/supervisor.ts`): it serves the runner over its pipe and
  // never reaches the config load, the build check or a Temporal worker.
  /* v8 ignore start -- @preserve: the process boundary; runAgentHostProcess is tested in-process and scripts/verify-agent-host-boot.mjs boots this mode under plain Node */
  if (process.argv[2] === AGENT_HOST_MODE_ARG) {
    const { runAgentHost } = await import("./agent-host/entry.js");
    await runAgentHost();
    return;
  }
  /* v8 ignore stop */

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

  /* v8 ignore next -- @preserve: the process boundary; only the runner's own process chooses its mode: the desktop app and test/conformance's runner-ipc harness boot manager mode, the CLI daemon static mode */
  const runnerMode = process.env.STIGMER_RUNNER_MODE === "manager" ? "manager" : "static";
  console.warn(
    `[runner] mode=${runnerMode}, proxy=${config.proxyEndpoint ?? "none"}, ` +
    `hasToken=${!!config.stigmerTokenRef.current}, workspace=${config.workspaceRootDir}, ` +
    `taskQueue=${config.taskQueue}`,
  );

  if (runnerMode === "manager") {
    await runManagerMode(config);
    // Manager mode is driven by the host over stdin. Once it returns — via the IPC `shutdown`
    // command or stdin EOF when the host process dies — exit deterministically so a stray open
    // handle can't keep a shut-down runner alive as an orphan (issue #177).
    process.exit(0);
  }

  // Static mode exits naturally once its shutdown has returned (worker drained, OTel
  // flushed). The backstop is the safety net, not the path: a healthy runner exits in
  // milliseconds and it never fires; a leaked handle gets a named bound and a log line naming
  // it, instead of holding the process for the orchestrator's whole grace (exit-backstop.ts).
  /* v8 ignore next -- @preserve: static mode's process boundary, booted by the CLI daemon as the execution conformance lanes and the from-source smokes run it */
  await runStaticMode(config);
  armExitBackstop();
}

main().catch((err) => {
  reportFatal(writeStderr, "Fatal error in runner:", err);
  process.exit(1);
});
