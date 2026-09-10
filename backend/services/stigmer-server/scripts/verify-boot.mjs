#!/usr/bin/env node

/**
 * Boots a compiled server entry with plain `node` and verifies the full
 * lifecycle: bind → "listening" log → SIGTERM → clean exit 0.
 *
 * Why this gate exists (the runner's #399 lesson): vitest/tsx module
 * interop tolerates ESM/CJS import shapes that Node's real loader rejects,
 * so an import-time boot crash can pass typecheck AND the whole test suite.
 * This is the only gate that executes the artifact the way the CLI daemon
 * will.
 *
 * `--require-workers` (stigmer-cloud 20260910.04): additionally require
 * "All Temporal workers started" before the SIGTERM. Without Temporal the
 * workers never start, so the runtime workflow bundling — each worker
 * webpack-bundles its workflows entry from the compiled tree on boot —
 * never executes. That is the one posture a consumer installing the
 * published library exercises differently from this checkout: the entry
 * lives under node_modules/@stigmer/server/dist with the dependencies
 * hoisted beside it, not nested. The consumer-install smoke passes this
 * flag; it expects a Temporal dev server on TEMPORAL_HOST_PORT (default
 * 127.0.0.1:7233). The markers, timeouts and the hint text are
 * verify-slim-artifact.mjs's — the same doctrine for a different artifact.
 *
 * Usage: node scripts/verify-boot.mjs <entry> [--require-workers]
 *        <entry> is relative to the package (dist/main.js,
 *        dist-slim/main.js) or absolute (a staged install's main.js).
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const requireWorkers = args.includes("--require-workers");
const entry = args.find((arg) => !arg.startsWith("--"));
if (entry === undefined) {
  console.error("verify-boot: missing entry argument (e.g. dist/main.js)");
  process.exit(1);
}

const serverRoot = fileURLToPath(new URL("..", import.meta.url));
// Worker start waits on a real Temporal round-trip plus the webpack bundle
// of three workflow entries; the plain transport boot needs a fraction.
const BOOT_TIMEOUT_MS = requireWorkers ? 60_000 : 15_000;
// After the markers: the shutdown gets its own deadline — a wedged worker
// drain is exactly the class of bug this gate exists to find, and must
// fail the job, not hang it to the CI job timeout.
const SHUTDOWN_TIMEOUT_MS = 20_000;
const WORKERS_MARKER = "All Temporal workers started";
const temporalHostPort = process.env.TEMPORAL_HOST_PORT ?? "127.0.0.1:7233";

// Every filesystem-touching stage gets a throwaway root: the boot check
// must never write the operator's ~/.stigmer. STORAGE_PATH matters beyond
// hygiene — the skill domain WIPES {STORAGE_PATH}/skills-staging at boot
// (crash recovery, #8), which against the real default would clear a
// running server's in-flight uploads.
const scratch = mkdtempSync(join(tmpdir(), "verify-boot-"));

const child = spawn(process.execPath, [resolve(serverRoot, entry)], {
  env: {
    ...process.env,
    GRPC_PORT: "0",
    LOG_LEVEL: "info",
    ENV: "ci",
    ...(requireWorkers ? { TEMPORAL_HOST_PORT: temporalHostPort } : {}),
    DB_PATH: join(scratch, "stigmer.db"),
    STORAGE_PATH: join(scratch, "storage"),
    ARTIFACT_LOCAL_BASE_PATH: join(scratch, "artifacts"),
  },
  stdio: ["ignore", "inherit", "pipe"],
});

let stderr = "";
let sawListening = false;
let sawWorkers = !requireWorkers;
let shutdownTimer = null;

const timer = setTimeout(() => {
  console.error(
    `verify-boot: markers not seen within ${BOOT_TIMEOUT_MS}ms ` +
      `(listening=${sawListening}, workers=${sawWorkers})\n${stderr}\n` +
      (requireWorkers && !sawWorkers
        ? `hint: the workers marker requires a reachable Temporal dev server on ` +
          `TEMPORAL_HOST_PORT (${temporalHostPort}) — is it running?`
        : ""),
  );
  child.kill("SIGKILL");
  process.exit(1);
}, BOOT_TIMEOUT_MS);

child.on("error", (err) => {
  clearTimeout(timer);
  console.error(`verify-boot: failed to spawn ${process.execPath}: ${err}`);
  process.exit(1);
});

child.stderr.on("data", (chunk) => {
  stderr += String(chunk);
  if (!sawListening && stderr.includes("listening")) sawListening = true;
  if (!sawWorkers && stderr.includes(WORKERS_MARKER)) sawWorkers = true;
  if (sawListening && sawWorkers && shutdownTimer === null) {
    clearTimeout(timer);
    shutdownTimer = setTimeout(() => {
      console.error(
        `verify-boot: shutdown did not complete within ${SHUTDOWN_TIMEOUT_MS}ms\n${stderr}`,
      );
      child.kill("SIGKILL");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    child.kill("SIGTERM");
  }
});

child.on("exit", (code, signal) => {
  clearTimeout(timer);
  if (shutdownTimer !== null) clearTimeout(shutdownTimer);
  if (sawListening && sawWorkers && code === 0) {
    console.log(
      `verify-boot: ${entry} booted, served${requireWorkers ? ", started all workers" : ""}, and shut down cleanly`,
    );
    process.exit(0);
  }
  console.error(
    `verify-boot: ${entry} failed (listening=${sawListening}, workers=${sawWorkers}, code=${code}, signal=${signal})\n${stderr}`,
  );
  process.exit(1);
});
