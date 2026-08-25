#!/usr/bin/env node

/**
 * Deep verification of the slim artifact — the release gate before the
 * server-slim packages publish (the runner's verify-slim-artifact.mjs
 * analogue).
 *
 * verify-boot.mjs proves the transport lifecycle, but WITHOUT Temporal the
 * workers never start, so the slim-only machinery — the pre-built workflow
 * bundles, the per-platform core-bridge dispatch, the patched sandbox
 * worker-thread entry — never executes. This script boots the artifact from
 * an ISOLATED copy (nothing resolves from this checkout's node_modules)
 * against a REAL Temporal dev server and requires, in order:
 *
 *   1. the "listening" transport log,
 *   2. "All Temporal workers started" — all three workers created from the
 *      pre-built bundles through the native bridge,
 *   3. SIGTERM → clean exit 0.
 *
 * Usage: node scripts/verify-slim-artifact.mjs
 *        (expects a Temporal dev server on TEMPORAL_HOST_PORT, default
 *        127.0.0.1:7233, and a built dist-slim/)
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = fileURLToPath(new URL("..", import.meta.url));
const slimDir = join(serverRoot, "dist-slim");
const BOOT_TIMEOUT_MS = 60_000;
// After both markers: the shutdown itself gets a deadline too — a wedged
// worker drain is exactly the class of bug this gate exists to find, and
// must fail the job, not hang it to the CI job timeout.
const SHUTDOWN_TIMEOUT_MS = 20_000;
const WORKERS_MARKER = "All Temporal workers started";

if (!existsSync(join(slimDir, "main.js"))) {
  console.error(
    "verify-slim-artifact: dist-slim/main.js not found — run `npm run build:slim` first",
  );
  process.exit(1);
}

// The isolation is the point: a copy outside the repo cannot accidentally
// resolve @temporalio/* (or anything else) from this checkout's node_modules,
// so a missing staged dependency fails HERE instead of in a user's install.
const isolated = mkdtempSync(join(tmpdir(), "verify-slim-artifact-"));
cpSync(slimDir, isolated, { recursive: true });

const scratch = mkdtempSync(join(tmpdir(), "verify-slim-scratch-"));

const child = spawn(process.execPath, [join(isolated, "main.js")], {
  env: {
    ...process.env,
    GRPC_PORT: "0",
    LOG_LEVEL: "info",
    ENV: "ci",
    TEMPORAL_HOST_PORT: process.env.TEMPORAL_HOST_PORT ?? "127.0.0.1:7233",
    DB_PATH: join(scratch, "stigmer.db"),
    STORAGE_PATH: join(scratch, "storage"),
    ARTIFACT_LOCAL_BASE_PATH: join(scratch, "artifacts"),
  },
  stdio: ["ignore", "inherit", "pipe"],
});

let stderr = "";
let sawListening = false;
let sawWorkers = false;
let shutdownTimer = null;

const timer = setTimeout(() => {
  console.error(
    `verify-slim-artifact: markers not seen within ${BOOT_TIMEOUT_MS}ms ` +
      `(listening=${sawListening}, workers=${sawWorkers})\n${stderr}\n` +
      (sawWorkers
        ? ""
        : `hint: the workers marker requires a reachable Temporal dev server on ` +
          `TEMPORAL_HOST_PORT (${process.env.TEMPORAL_HOST_PORT ?? "127.0.0.1:7233"}) — is it running?`),
  );
  child.kill("SIGKILL");
  process.exit(1);
}, BOOT_TIMEOUT_MS);

child.on("error", (err) => {
  clearTimeout(timer);
  console.error(`verify-slim-artifact: failed to spawn ${process.execPath}: ${err}`);
  process.exit(1);
});

child.stderr.on("data", (chunk) => {
  stderr += String(chunk);
  if (!sawListening && stderr.includes("listening")) sawListening = true;
  if (!sawWorkers && stderr.includes(WORKERS_MARKER)) sawWorkers = true;
  if (sawListening && sawWorkers && shutdownTimer === null) {
    clearTimeout(timer);
    child.kill("SIGTERM");
    shutdownTimer = setTimeout(() => {
      console.error(
        `verify-slim-artifact: shutdown did not complete within ${SHUTDOWN_TIMEOUT_MS}ms after SIGTERM\n${stderr}`,
      );
      child.kill("SIGKILL");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
  }
});

child.on("exit", (code, signal) => {
  clearTimeout(timer);
  if (shutdownTimer !== null) clearTimeout(shutdownTimer);
  if (sawListening && sawWorkers && code === 0) {
    console.log(
      "verify-slim-artifact: isolated slim artifact served, started all workers, and shut down cleanly",
    );
    // Success-path hygiene: each run copies the full slim artifact.
    rmSync(isolated, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
    process.exit(0);
  }
  console.error(
    `verify-slim-artifact: failed (listening=${sawListening}, workers=${sawWorkers}, code=${code}, signal=${signal})\n${stderr}`,
  );
  process.exit(1);
});
