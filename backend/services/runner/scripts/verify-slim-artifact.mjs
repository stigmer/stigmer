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
 *   3. Cloud mode (not on Windows, see 5) — boots static mode as a cloud
 *      sandbox starts it (MODE=cloud, a token, a backend endpoint), so the
 *      cloud-only paths (the http checkpointer, the strict URL guard, the
 *      stdio MCP refusal) load from the bundle, and treats reaching the
 *      Temporal dial (an unroutable sentinel address, refused) as success,
 *      the signal verify-dist-boot.mjs uses. A served turn is the cluster's
 *      proof.
 *   4. Cursor SDK — @cursor/sdk imports, and its platform package (the
 *      helper binaries) resolves, from the artifact as the runner resolves it.
 *   5. Attach entry (not on Windows) — attach/main.js beside the entry serves readiness,
 *      refuses a foreign push and stops cleanly (verify-attach-boot.mjs, run
 *      by the same Node). Skipped on Windows: the waiter runs only in a
 *      Linux sandbox, and Node on Windows cannot deliver SIGTERM as a signal
 *      (kill force-terminates), so the clean-stop check could never pass there
 *      (the desktop's Windows release leg runs this script).
 *   6. Static mode — boots, creates a Worker (native bridge + pre-built
 *      workflow bundle + sandbox worker thread), reaches RUNNING, and shuts
 *      down gracefully on SIGINT.
 *   7. Manager mode — full IPC lifecycle: ready → addSession → sessionAdded
 *      → shutdown → shutdownComplete, exit 0 — run both tokenless and on the
 *      authenticated path (so the lifecycle is proven with the interceptors armed).
 *   8. Pool mode (not on Windows) — boots as a hosted warm-pool sandbox does
 *      (MODE=cloud, STIGMER_POOL_MEMBER_ID, a pool_sandbox-class token whose
 *      claims are read but never verified at boot) with an OTLP endpoint set,
 *      as production sets one, and reaches "[pool-member] … ready" polling its
 *      control queue. Pool mode runs the runner manager, so this is the path
 *      that once died resolving the OTel workflow module the slim artifact
 *      does not stage (stigmer/stigmer#1810).
 *
 * Checks 1–5 need no Temporal; checks 6–8 require a reachable Temporal server
 * (default localhost:7233, override with TEMPORAL_SERVICE_ADDRESS), e.g.:
 *
 *   temporal server start-dev --headless
 *
 * Usage:
 *   node scripts/verify-slim-artifact.mjs               # full suite (needs Temporal)
 *   node scripts/verify-slim-artifact.mjs --no-temporal # checks 1–5 only
 *
 * By default the subject is this package's dist-slim/, booted by `node` from
 * PATH. Two options point the same checks at the artifact as an embedder ships
 * it, run by the engine it ships with:
 *
 *   --node <path>        the Node binary that boots the runner
 *   --artifact <dir>     the staged artifact directory (default: dist-slim/)
 *   --entry <relative>   the entry inside it (default: main.js)
 *
 * The desktop app runs exactly that after staging its bundle
 * (client-apps/desktop/scripts/verify-staged-runtime.mjs): its pinned Node
 * runtime against resources/runner, whose entry is dist/main.js. The sandbox
 * image's release smoke runs it inside the image against /runner/dist with
 * /runner/bin/node. The script imports only Node built-ins and its sibling
 * verify-attach-boot.mjs, so it runs from a mounted checkout.
 */

import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values: options } = parseArgs({
  options: {
    "no-temporal": { type: "boolean", default: false },
    node: { type: "string", default: "node" },
    artifact: { type: "string" },
    entry: { type: "string", default: "main.js" },
  },
});

const artifactDir = options.artifact
  ? resolve(options.artifact)
  : fileURLToPath(new URL("../dist-slim", import.meta.url));
const nodeBinary = options.node;
const entry = options.entry;
const temporalAddress = process.env.TEMPORAL_SERVICE_ADDRESS ?? "localhost:7233";
const sizeBudgetMb = Number(process.env.SLIM_SIZE_BUDGET_MB ?? 120);

// When set, run only the checks that need no Temporal server (1–5 above).
// This is the slice the dev-publish fast path (publish-dev-local.sh) runs, so
// a slim build can never reach the dev channel without at least proving its
// interceptor load order survived bundling.
const skipTemporalBoots = options["no-temporal"] || process.env.SLIM_VERIFY_SKIP_TEMPORAL === "1";

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

if (!existsSync(join(artifactDir, entry))) {
  fail(
    options.artifact
      ? `${join(artifactDir, entry)} not found`
      : "dist-slim/main.js not found — run `npm run build:slim` first",
  );
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

const sizeMb = runtimeSize(artifactDir) / 1024 / 1024;
if (sizeMb > sizeBudgetMb) {
  fail(
    `artifact runtime payload is ${sizeMb.toFixed(1)} MB, over the ${sizeBudgetMb} MB budget. ` +
      "A dependency likely grew or escaped the bundle — inspect dist-slim/meta.json before raising the budget.",
  );
}
console.log(`[size]   OK: ${sizeMb.toFixed(1)} MB <= ${sizeBudgetMb} MB (sourcemaps excluded)`);

// ─── Isolated copy ───────────────────────────────────────────────────────────

const isolatedDir = mkdtempSync(join(tmpdir(), "stigmer-slim-verify-"));
cpSync(artifactDir, isolatedDir, { recursive: true });
const cleanup = () => rmSync(isolatedDir, { recursive: true, force: true });
process.on("exit", cleanup);

const baseEnv = {
  ...process.env,
  TEMPORAL_SERVICE_ADDRESS: temporalAddress,
  WORKSPACE_ROOT_DIR: join(isolatedDir, "workspace"),
};

function bootRunner(extraEnv) {
  return spawn(nodeBinary, [join(isolatedDir, entry)], {
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

// ─── Cloud mode (no Temporal required) ──────────────────────────────────────

/**
 * Boots static mode the way a cloud sandbox starts the runner and succeeds at
 * the Temporal dial: the runner logs its mode once its configuration loaded,
 * then dies dialing a sentinel address only this script uses. A fatal error
 * that does not name the sentinel is a load failure before the dial.
 */
const CLOUD_SENTINEL_ADDRESS = "127.0.0.1:65003";

async function verifyCloudMode() {
  return new Promise((resolve, reject) => {
    const proc = bootRunner({
      MODE: "cloud",
      STIGMER_TOKEN: DUMMY_TOKEN,
      STIGMER_BACKEND_ENDPOINT: "http://127.0.0.1:65004",
      STIGMER_TASK_QUEUE: "session:verify-slim",
      TEMPORAL_SERVICE_ADDRESS: CLOUD_SENTINEL_ADDRESS,
      HOME: join(isolatedDir, "home"),
    });
    let output = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`cloud mode did not reach the Temporal dial within ${BOOT_TIMEOUT_MS}ms.\n${output.slice(-2000)}`));
    }, BOOT_TIMEOUT_MS);
    proc.stdout.on("data", (chunk) => (output += chunk));
    proc.stderr.on("data", (chunk) => (output += chunk));
    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (/Mode: cloud/.test(output) && output.includes(CLOUD_SENTINEL_ADDRESS)) resolve();
      else reject(new Error(`cloud mode exited (code ${code}) before the Temporal dial.\n${output.slice(-2000)}`));
    });
  });
}

// ─── Cursor SDK (no Temporal required) ──────────────────────────────────────

/**
 * Imports @cursor/sdk and resolves its platform package from beside the
 * entry, where the runner's own dynamic import resolves them. The probe is
 * written into the isolated copy, so nothing resolves from this checkout.
 */
function verifyCursorSdk() {
  const probe = join(dirname(join(isolatedDir, entry)), "verify-cursor-sdk.mjs");
  writeFileSync(
    probe,
    `import { createRequire } from "node:module";
await import("@cursor/sdk");
const sdk = createRequire(import.meta.resolve("@cursor/sdk"));
console.log(sdk.resolve(\`@cursor/sdk-\${process.platform}-\${process.arch}/package.json\`));
`,
  );
  const result = spawnSync(nodeBinary, [probe], { cwd: isolatedDir, encoding: "utf8", timeout: BOOT_TIMEOUT_MS });
  rmSync(probe);
  if (result.status !== 0) {
    throw new Error(`@cursor/sdk did not load from the artifact (exit ${result.status}).\n${(result.stderr ?? "").slice(-2000)}`);
  }
  return result.stdout.trim();
}

// ─── Attach entry (no Temporal required) ────────────────────────────────────

function verifyAttachEntry() {
  const script = fileURLToPath(new URL("./verify-attach-boot.mjs", import.meta.url));
  const artifact = dirname(join(isolatedDir, entry));
  const result = spawnSync(nodeBinary, [script, "--node", nodeBinary, "--artifact", artifact], {
    encoding: "utf8",
    timeout: BOOT_TIMEOUT_MS,
  });
  if (result.status !== 0) {
    throw new Error(`the attach entry failed its boot.\n${`${result.stdout}${result.stderr}`.slice(-2000)}`);
  }
}

// ─── 6. Static mode ──────────────────────────────────────────────────────────

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

// ─── 8. Pool mode ────────────────────────────────────────────────────────────

/** An unsigned JWT whose only claim is a pool member's token class. */
function poolSandboxToken() {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none", typ: "JWT" })}.${part({ token_type: "pool_sandbox" })}.verify-slim`;
}

async function verifyPoolMode() {
  return new Promise((resolve, reject) => {
    const proc = bootRunner({
      MODE: "cloud",
      STIGMER_POOL_MEMBER_ID: "pm_verify_slim",
      STIGMER_TOKEN: poolSandboxToken(),
      STIGMER_BACKEND_ENDPOINT: "http://127.0.0.1:65004",
      // Unreachable on purpose: nothing exports before ready; what matters is
      // that the OTel interceptors load as they do in production.
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:65005",
      HOME: join(isolatedDir, "home-pool"),
    });
    let output = "";
    let ready = false;
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`pool mode did not reach ready within ${BOOT_TIMEOUT_MS}ms.\n${output.slice(-2000)}`));
    }, BOOT_TIMEOUT_MS);
    const onData = (chunk) => {
      output += chunk;
      if (!ready && /\[pool-member\] pm_verify_slim ready/.test(output)) {
        ready = true;
        proc.kill("SIGKILL");
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (ready) resolve();
      else reject(new Error(`pool mode exited (code ${code}) before ready.\n${output.slice(-2000)}`));
    });
  });
}

// ─── 7. Manager mode ─────────────────────────────────────────────────────────

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
  // Cloud mode and the attach waiter run only in Linux sandboxes; Windows
  // (the desktop's release leg runs this script there) has neither, and its
  // Node cannot deliver SIGTERM as a signal, so both are skipped there.
  const windows = process.platform === "win32";
  if (windows) {
    console.log("[cloud]  skipped on Windows: cloud mode runs only in Linux sandboxes");
  } else {
    await verifyCloudMode();
    console.log("[cloud]  OK: MODE=cloud loaded its configuration and reached the Temporal dial");
  }
  const cursorPlatform = verifyCursorSdk();
  console.log(`[cursor] OK: @cursor/sdk imported; its platform package resolved at ${cursorPlatform}`);
  if (windows) {
    console.log("[attach] skipped on Windows: the attach waiter runs only in Linux sandboxes");
  } else {
    verifyAttachEntry();
    console.log("[attach] OK: the attach entry served readiness, refused a foreign push and stopped cleanly");
  }

  if (skipTemporalBoots) {
    console.log("verify-slim-artifact: PASS (checks 1–5; Temporal boots skipped via --no-temporal)");
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
    if (windows) {
      console.log("[pool]   skipped on Windows: pool mode runs only in Linux sandboxes");
    } else {
      await verifyPoolMode();
      console.log("[pool]   OK: a warm-pool member with an OTLP endpoint reached ready on its control queue");
    }
    console.log("verify-slim-artifact: PASS");
  }
} catch (err) {
  fail(err.message);
}
