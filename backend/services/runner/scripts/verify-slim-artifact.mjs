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
 *   2. Authed boot guard — boots the AUTHENTICATED path (token + proxy), the
 *      only path that arms the fetch/http2 interceptors and runs
 *      assertHttp2ConnectPatched(). This is the regression lock for #170's
 *      second failure: a bundle that flattened the dynamic-import load order
 *      (e.g. an ESM esbuild bundle hoisting node:http2) aborts here. Needs no
 *      Temporal — the guard runs before any network I/O.
 *   3. Static mode — boots, creates a Worker (native bridge + pre-built
 *      workflow bundle + sandbox worker thread), reaches RUNNING, and shuts
 *      down gracefully on SIGINT.
 *   4. Manager mode — full IPC lifecycle: ready → addSession → sessionAdded
 *      → shutdown → shutdownComplete, exit 0 — run both tokenless and on the
 *      authenticated path (so the lifecycle is proven with the interceptors armed).
 *
 * Checks 1–2 need no Temporal; checks 3–4 require a reachable Temporal server
 * (default localhost:7233, override with TEMPORAL_SERVICE_ADDRESS), e.g.:
 *
 *   temporal server start-dev --headless
 *
 * Usage:
 *   node scripts/verify-slim-artifact.mjs               # full suite (needs Temporal)
 *   node scripts/verify-slim-artifact.mjs --no-temporal # size + authed guard only
 */

import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const distSlimDir = fileURLToPath(new URL("../dist-slim", import.meta.url));
const temporalAddress = process.env.TEMPORAL_SERVICE_ADDRESS ?? "localhost:7233";
const sizeBudgetMb = Number(process.env.SLIM_SIZE_BUDGET_MB ?? 120);

// When set, run only the checks that need no Temporal server: the size budget
// and the authenticated boot guard. This is the slice the dev-publish fast path
// (publish-dev-local.sh) runs, so a slim build can never reach the dev channel
// without at least proving its interceptor load order survived bundling.
const skipTemporalBoots =
  process.argv.includes("--no-temporal") || process.env.SLIM_VERIFY_SKIP_TEMPORAL === "1";

const BOOT_TIMEOUT_MS = 90_000;

// Dummy credentials for the authenticated-path checks. They never authenticate
// anything: their sole job is to make installHttp2Interceptor()/installFetch
// arm (both require a token + proxy), so the node:http2 ESM-facade boot guard
// actually runs. The proxy host is deliberately unroutable — boot completes
// long before any proxy traffic, so it is never dialed.
const DUMMY_TOKEN = "verify-slim-dummy-token";
const DUMMY_PROXY_ENDPOINT = "https://proxy.invalid";

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
console.log(`[size]   OK: ${sizeMb.toFixed(1)} MB <= ${sizeBudgetMb} MB (sourcemaps excluded)`);

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

// ─── Authenticated boot guard (no Temporal required) ────────────────────────

/**
 * The regression lock for stigmer/stigmer#170's second failure.
 *
 * Boots manager mode on the authenticated path — token + proxy set — which is
 * the ONLY path that arms the fetch/http2 interceptors and therefore the only
 * path that runs assertHttp2ConnectPatched(). A bundle that flattened the
 * dynamic-import load order (e.g. an ESM esbuild bundle that hoists the
 * node:http2 import) aborts here with "ESM facade is unpatched"; a bundle that
 * preserved it sails past the guard.
 *
 * This needs no Temporal server: an explicit (unroutable) TEMPORAL_SERVICE_ADDRESS
 * makes bootstrap skip control-plane discovery, and the guard runs before any
 * network I/O. Success is the deterministic post-guard log line emitted when a
 * proxy is configured but no runner token was minted (runner-manager.ts); we
 * detect it and stop, never reaching the Temporal connection attempt.
 */
async function verifyAuthedGuard() {
  return new Promise((resolve, reject) => {
    const proc = bootRunner({
      STIGMER_RUNNER_MODE: "manager",
      STIGMER_BACKEND_ENDPOINT: "http://localhost:7234",
      STIGMER_TOKEN: DUMMY_TOKEN,
      STIGMER_PROXY_ENDPOINT: DUMMY_PROXY_ENDPOINT,
      // Explicit + unroutable: skips bootstrap discovery and is never dialed
      // because we resolve before the NativeConnection attempt.
      TEMPORAL_SERVICE_ADDRESS: "127.0.0.1:65000",
    });

    let output = "";
    let settled = false;
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.kill("SIGKILL");
      fn(arg);
    };

    const timer = setTimeout(
      () => done(reject, new Error(`authed guard did not pass within ${BOOT_TIMEOUT_MS}ms.\n${output.slice(-2000)}`)),
      BOOT_TIMEOUT_MS,
    );

    const onData = (chunk) => {
      output += chunk;
      if (/ESM facade is unpatched/.test(output)) {
        done(
          reject,
          new Error(
            "authed boot guard FAILED: the bundle defeated the http2 interceptor load order " +
              "(node:http2 ESM facade unpatched before install). This is stigmer/stigmer#170 — " +
              "the slim bundle must preserve the dynamic-import load order (CJS output).\n" +
              output.slice(-2000),
          ),
        );
        return;
      }
      // Post-guard signal: bootstrap resolved and we reached the proxy-token
      // reconciliation, which only runs after assertHttp2ConnectPatched passed.
      if (/no runner token was minted|Adopted minted proxy token/.test(output)) {
        done(resolve);
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);

    proc.on("exit", (code) => {
      // Exit before either signal means it died at init (likely the guard, or a
      // missing dependency) — surface the tail so the cause is visible.
      done(reject, new Error(`authed guard process exited (code ${code}) before passing the guard.\n${output.slice(-2000)}`));
    });
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

async function verifyManagerMode(extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const proc = bootRunner({
      STIGMER_RUNNER_MODE: "manager",
      STIGMER_BACKEND_ENDPOINT: "http://localhost:7234",
      ...extraEnv,
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
  // Runs everywhere (no Temporal needed): proves the authenticated boot path —
  // the one every embedder runs and the one that regressed in #170 — survives
  // bundling. This is the check the dev-publish fast path relies on.
  await verifyAuthedGuard();
  console.log("[guard]  OK: authenticated boot passed assertHttp2ConnectPatched (interceptor load order intact)");

  if (skipTemporalBoots) {
    console.log("verify-slim-artifact: PASS (size + authed guard; Temporal boots skipped via --no-temporal)");
  } else {
    await verifyStaticMode();
    console.log("[static] OK: worker reached RUNNING and shut down gracefully");
    await verifyManagerMode();
    console.log("[mgr]    OK: ready → addSession → shutdown lifecycle, exit 0");
    // Same lifecycle, but on the authenticated path (token + proxy). The
    // interceptors arm and the http2 boot guard runs, yet the full
    // ready→addSession→shutdown lifecycle still completes against Temporal —
    // proving the auth path the verify gate previously never exercised (#170).
    await verifyManagerMode({
      STIGMER_TOKEN: DUMMY_TOKEN,
      STIGMER_PROXY_ENDPOINT: DUMMY_PROXY_ENDPOINT,
    });
    console.log("[mgr+auth] OK: authenticated manager lifecycle booted end-to-end against Temporal");
    console.log("verify-slim-artifact: PASS");
  }
} catch (err) {
  fail(err.message);
}
