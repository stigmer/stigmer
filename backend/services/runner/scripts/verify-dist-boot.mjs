#!/usr/bin/env node

/**
 * Verifies the plain tsc output (dist/) boots under real Node.
 *
 * Why this exists (stigmer/stigmer#399 boot regression): tsx and vitest
 * use their own module interop, which tolerates ESM/CJS import shapes that
 * Node's real ESM loader rejects — a named import from a CommonJS package
 * whose exports defeat cjs-module-lexer passes every test and typecheck,
 * then kills `node dist/main.js` at startup ("Named export … not found")
 * before it polls a single task queue. No other gate runs the compiled
 * dist with plain `node`: ci.conformance-execution builds + typechecks,
 * check-node builds, ci.runner runs vitest, and verify-slim-artifact.mjs
 * covers only dist-slim/ (whose esbuild CJS output rewrites imports and so
 * cannot exhibit the failure). This script closes that gap for the whole
 * class of import-time crashes, not just the #399 instance.
 *
 * How: boot manager mode tokenless with an explicit, unroutable
 * TEMPORAL_SERVICE_ADDRESS (skips control-plane discovery) and treat
 * "boot progressed to the Temporal dial" as success. The manager factory's
 * init order — pinned empirically against the #399 build — is:
 *
 *   entry module graph → factory init (lazy imports, incl. the encryption
 *   payload-codec chain where #399 died) → NativeConnection.connect
 *
 * so the dial is only reachable after every module load has succeeded.
 * Because this script owns the dial target, the connection-refused error
 * carries SENTINEL_ADDRESS — a deterministic, self-identifying success
 * signal that needs no Temporal server. Import-time crashes surface
 * earlier, as a fatal IPC error with the crash message (verified: the
 * #399 build fails here with the original "Named export 'temporal' not
 * found" signature). Waiting for the `ready` IPC message instead would
 * require a live Temporal server for no additional module coverage —
 * worker-creation modules load per-session, beyond any tokenless boot.
 * Runs in a few seconds; needs `npm run build` first.
 *
 * The runner's own runtime preflight (node:sqlite) runs inside this boot:
 * on Node < 22.13 without --experimental-sqlite the guard fails with the
 * preflight's actionable message — which is correct, that Node cannot run
 * the runner (see the repo's environment notes).
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const distMain = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const BOOT_TIMEOUT_MS = 60_000;

// Loopback + a port nothing binds in practice: connect() fails immediately
// and the address string in the error identifies OUR dial attempt.
const SENTINEL_ADDRESS = "127.0.0.1:65000";

function fail(message) {
  console.error(`verify-dist-boot: FAIL — ${message}`);
  process.exit(1);
}

if (!existsSync(distMain)) {
  fail("dist/main.js not found — run `npm run build` first");
}

const workspaceDir = mkdtempSync(join(tmpdir(), "stigmer-dist-boot-"));
process.on("exit", () => rmSync(workspaceDir, { recursive: true, force: true }));

const proc = spawn(process.execPath, [distMain], {
  env: {
    ...process.env,
    STIGMER_RUNNER_MODE: "manager",
    STIGMER_BACKEND_ENDPOINT: "http://localhost:7234",
    TEMPORAL_SERVICE_ADDRESS: SENTINEL_ADDRESS,
    WORKSPACE_ROOT_DIR: join(workspaceDir, "workspace"),
  },
  stdio: ["pipe", "pipe", "pipe"],
});

let stdoutBuf = "";
let stdoutConsumed = 0;
let allOutput = "";
let settled = false;

function done(ok, message) {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  proc.kill("SIGKILL");
  if (ok) {
    console.log(`verify-dist-boot: PASS — ${message}`);
    process.exit(0);
  }
  fail(message);
}

const timer = setTimeout(() => {
  done(
    false,
    `dist boot produced neither the dial signal nor an error within ` +
      `${BOOT_TIMEOUT_MS}ms.\n${allOutput.slice(-2000)}`,
  );
}, BOOT_TIMEOUT_MS);

proc.stdout.on("data", (chunk) => {
  stdoutBuf += chunk;
  allOutput += chunk;
  let newlineIdx;
  while ((newlineIdx = stdoutBuf.indexOf("\n", stdoutConsumed)) !== -1) {
    const line = stdoutBuf.slice(stdoutConsumed, newlineIdx).trim();
    stdoutConsumed = newlineIdx + 1;
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // Non-JSON stdout lines are ordinary logs.
    }
    if (msg.type === "ready") {
      // Only possible if something answers gRPC on the sentinel address;
      // boot got even further than the dial, so module loading is proven.
      done(true, "dist/main.js booted to ready");
      return;
    }
    if (msg.type === "error") {
      const message = String(msg.message ?? "");
      if (message.includes(SENTINEL_ADDRESS)) {
        done(
          true,
          "dist/main.js completed all module loading and reached the Temporal dial " +
            "(sentinel connection-refused observed)",
        );
      } else {
        done(
          false,
          `dist boot reported a fatal init error before the Temporal dial — a ` +
            `module-load crash (ESM/CJS interop, missing dependency) dies here ` +
            `before any test would see it:\n${line}`,
        );
      }
      return;
    }
  }
});
proc.stderr.on("data", (chunk) => (allOutput += chunk));

proc.on("exit", (code) => {
  done(
    false,
    `dist boot exited (code ${code}) before the Temporal dial.\n${allOutput.slice(-2000)}`,
  );
});
