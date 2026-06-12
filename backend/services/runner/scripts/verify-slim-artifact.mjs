#!/usr/bin/env node

/**
 * Verifies the slim runner artifact (dist-slim/) actually runs.
 *
 * Bundling failures are sneaky: a missed transitive dependency, a misplaced
 * wasm asset, or a broken native-bridge shim all produce an artifact that
 * looks complete but dies at boot — sometimes only after connecting to
 * Temporal (Worker.create is where the native bridge and workflow bundle
 * load). So this verifies against a real Temporal dev server, from an
 * isolated copy of the artifact (nothing can accidentally resolve from the
 * repo's node_modules):
 *
 *   1. Size budget — the artifact's runtime payload (sourcemaps excluded)
 *      stays under SLIM_SIZE_BUDGET_MB (default 120). The whole point of
 *      this artifact is being small (stigmer/stigmer#170); a dependency
 *      creeping past the budget should fail the release, not ship silently.
 *   2. Static mode — boots, creates a Worker (native bridge + pre-built
 *      workflow bundle + sandbox worker thread), reaches RUNNING, and shuts
 *      down gracefully on SIGINT.
 *   3. Manager mode — full IPC lifecycle: ready → addSession → sessionAdded
 *      → shutdown → shutdownComplete, exit 0.
 *
 * Requires a reachable Temporal server (default localhost:7233, override
 * with TEMPORAL_SERVICE_ADDRESS), e.g.:
 *
 *   temporal server start-dev --headless
 *
 * Usage: node scripts/verify-slim-artifact.mjs
 */

import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const distSlimDir = fileURLToPath(new URL("../dist-slim", import.meta.url));
const temporalAddress = process.env.TEMPORAL_SERVICE_ADDRESS ?? "localhost:7233";
const sizeBudgetMb = Number(process.env.SLIM_SIZE_BUDGET_MB ?? 120);

const BOOT_TIMEOUT_MS = 90_000;

function fail(message) {
  console.error(`verify-slim-artifact: FAIL — ${message}`);
  process.exit(1);
}

if (!existsSync(join(distSlimDir, "main.js"))) {
  fail("dist-slim/main.js not found — run `npm run build:slim` first");
}

// ─── 1. Size budget ──────────────────────────────────────────────────────────

function runtimeSize(path) {
  const stat = statSync(path);
  if (!stat.isDirectory()) {
    return path.endsWith(".map") || path.endsWith("meta.json") ? 0 : stat.size;
  }
  let total = 0;
  for (const entry of readdirSync(path)) {
    total += runtimeSize(join(path, entry));
  }
  return total;
}

const sizeMb = runtimeSize(distSlimDir) / 1024 / 1024;
if (sizeMb > sizeBudgetMb) {
  fail(
    `artifact runtime payload is ${sizeMb.toFixed(1)} MB, over the ${sizeBudgetMb} MB budget. ` +
      "A dependency likely grew or escaped the bundle — inspect dist-slim/meta.json before raising the budget.",
  );
}
console.log(`[1/3] size budget OK: ${sizeMb.toFixed(1)} MB <= ${sizeBudgetMb} MB (sourcemaps excluded)`);

// ─── Isolated copy ───────────────────────────────────────────────────────────

const isolatedDir = mkdtempSync(join(tmpdir(), "stigmer-slim-verify-"));
cpSync(distSlimDir, isolatedDir, { recursive: true });
const cleanup = () => rmSync(isolatedDir, { recursive: true, force: true });
process.on("exit", cleanup);

const baseEnv = {
  ...process.env,
  TEMPORAL_SERVICE_ADDRESS: temporalAddress,
  WORKSPACE_ROOT_DIR: join(isolatedDir, "workspace"),
};

function bootRunner(extraEnv) {
  return spawn("node", [join(isolatedDir, "main.js")], {
    cwd: isolatedDir,
    env: { ...baseEnv, ...extraEnv },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// ─── 2. Static mode ──────────────────────────────────────────────────────────

async function verifyStaticMode() {
  return new Promise((resolve, reject) => {
    const proc = bootRunner({});
    let output = "";
    let sawRunning = false;

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`static mode did not reach RUNNING within ${BOOT_TIMEOUT_MS}ms.\n${output.slice(-2000)}`));
    }, BOOT_TIMEOUT_MS);

    const onData = (chunk) => {
      output += chunk;
      if (!sawRunning && /state: 'RUNNING'/.test(output)) {
        sawRunning = true;
        proc.kill("SIGINT");
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);

    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (!sawRunning) {
        reject(new Error(`static mode exited (code ${code}) before reaching RUNNING.\n${output.slice(-2000)}`));
      } else if (code !== 0) {
        reject(new Error(`static mode shutdown was not graceful (exit ${code}).\n${output.slice(-2000)}`));
      } else {
        resolve();
      }
    });
  });
}

// ─── 3. Manager mode ─────────────────────────────────────────────────────────

async function verifyManagerMode() {
  return new Promise((resolve, reject) => {
    const proc = bootRunner({
      STIGMER_RUNNER_MODE: "manager",
      STIGMER_BACKEND_ENDPOINT: "http://localhost:7234",
    });
    let stdout = "";
    let stderr = "";
    let consumed = 0;
    const expected = ["ready", "sessionAdded", "shutdownComplete"];
    let step = 0;

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(
        new Error(
          `manager mode stalled waiting for "${expected[step]}" within ${BOOT_TIMEOUT_MS}ms.\n${stderr.slice(-2000)}`,
        ),
      );
    }, BOOT_TIMEOUT_MS);

    const send = (msg) => proc.stdin.write(JSON.stringify(msg) + "\n");

    proc.stdout.on("data", (chunk) => {
      stdout += chunk;
      // Process complete lines exactly once.
      let newlineIdx;
      while ((newlineIdx = stdout.indexOf("\n", consumed)) !== -1) {
        const line = stdout.slice(consumed, newlineIdx).trim();
        consumed = newlineIdx + 1;
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.type === "error") {
          clearTimeout(timer);
          proc.kill("SIGKILL");
          reject(new Error(`manager mode IPC error: ${line}`));
          return;
        }
        if (msg.type !== expected[step]) continue;
        step += 1;
        if (msg.type === "ready") {
          send({ type: "addSession", sessionId: "verify-slim" });
        } else if (msg.type === "sessionAdded") {
          send({ type: "shutdown" });
        }
      }
    });
    proc.stderr.on("data", (chunk) => (stderr += chunk));

    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (step === expected.length && code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `manager mode exited with code ${code} at step ${step}/${expected.length} (${expected.join(" → ")}).\n` +
              stderr.slice(-2000),
          ),
        );
      }
    });
  });
}

try {
  await verifyStaticMode();
  console.log("[2/3] static mode OK: worker reached RUNNING and shut down gracefully");
  await verifyManagerMode();
  console.log("[3/3] manager mode OK: ready → addSession → shutdown lifecycle, exit 0");
  console.log("verify-slim-artifact: PASS");
} catch (err) {
  fail(err.message);
}
