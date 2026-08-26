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
 *   3. the console lane answers over live HTTP (DD-012; the #24 lesson —
 *      packaging gaps are invisible at PR time unless a gate exercises
 *      the artifact): /config.json synthesizes with a Host-derived
 *      apiUrl, the root and a dynamic deep link serve documents, an
 *      unknown URL serves the export's 404 page WITH a 404 status, and a
 *      flight .txt request serves its placeholder payload,
 *   4. SIGTERM → clean exit 0.
 *
 * The console assets themselves are asserted present in the isolated copy
 * before boot — a missing console/ is a packaging failure by itself.
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

// Console assets must ride the artifact (DD-012): assert the lane's two
// load-bearing documents before boot so a staging regression names itself.
for (const consoleFile of ["console/index.html", "console/404.html"]) {
  if (!existsSync(join(isolated, consoleFile))) {
    console.error(
      `verify-slim-artifact: ${consoleFile} missing from the slim artifact — ` +
        "the console staging step (bundle-slim.mjs stageConsoleExport) did not run or was gutted",
    );
    process.exit(1);
  }
}

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

/**
 * Live-HTTP console probes (GRPC_PORT=0 binds ephemeral; the bound port
 * rides the structured "stigmer-server listening" log line). Each probe
 * asserts the status and a body/header property that only the real lane
 * produces — a 200 with the wrong document would pass a status-only check.
 */
async function probeConsole() {
  const portMatch = stderr
    .split("\n")
    .find((line) => line.includes("stigmer-server listening"))
    ?.match(/"port":\s*(\d+)/);
  if (!portMatch) {
    throw new Error(
      `could not parse the bound port from the listening log line`,
    );
  }
  const baseUrl = `http://127.0.0.1:${portMatch[1]}`;

  const config = await fetch(`${baseUrl}/config.json`);
  if (config.status !== 200) {
    throw new Error(`/config.json answered ${config.status}`);
  }
  const configBody = await config.json();
  if (configBody.authMode !== "disabled" || configBody.apiUrl !== baseUrl) {
    throw new Error(
      `/config.json synthesized wrong (authMode=${configBody.authMode}, apiUrl=${configBody.apiUrl}, expected apiUrl ${baseUrl})`,
    );
  }

  const root = await fetch(`${baseUrl}/`);
  if (
    root.status !== 200 ||
    !(root.headers.get("content-type") ?? "").includes("text/html")
  ) {
    throw new Error(`/ answered ${root.status} ${root.headers.get("content-type")}`);
  }

  // A dynamic deep link and its flight payload: /sessions/[id] is a core
  // route; if the route tree ever drops it, update this probe with it.
  const deepLink = await fetch(`${baseUrl}/sessions/zz-verify-probe`);
  if (
    deepLink.status !== 200 ||
    !(deepLink.headers.get("content-type") ?? "").includes("text/html")
  ) {
    throw new Error(
      `dynamic deep link answered ${deepLink.status} ${deepLink.headers.get("content-type")} — the placeholder rewrite is not serving`,
    );
  }
  const flight = await fetch(`${baseUrl}/sessions/zz-verify-probe.txt`);
  if (flight.status !== 200) {
    throw new Error(
      `flight payload answered ${flight.status} — the RSC .txt rewrite is not serving`,
    );
  }

  const notFound = await fetch(`${baseUrl}/zz-no-such-route`);
  if (
    notFound.status !== 404 ||
    !(notFound.headers.get("content-type") ?? "").includes("text/html")
  ) {
    throw new Error(
      `unknown URL answered ${notFound.status} ${notFound.headers.get("content-type")} — expected the export's 404 page WITH a 404 status`,
    );
  }
  console.log("verify-slim-artifact: console lane probes passed");
}

child.stderr.on("data", (chunk) => {
  stderr += String(chunk);
  if (!sawListening && stderr.includes("listening")) sawListening = true;
  if (!sawWorkers && stderr.includes(WORKERS_MARKER)) sawWorkers = true;
  if (sawListening && sawWorkers && shutdownTimer === null) {
    clearTimeout(timer);
    // Arm the deadline over probes + shutdown so a hung probe fails the
    // job instead of hanging it (the same posture as the boot timeout).
    shutdownTimer = setTimeout(() => {
      console.error(
        `verify-slim-artifact: probes/shutdown did not complete within ${SHUTDOWN_TIMEOUT_MS}ms\n${stderr}`,
      );
      child.kill("SIGKILL");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    probeConsole()
      .then(() => {
        child.kill("SIGTERM");
      })
      .catch((error) => {
        console.error(
          `verify-slim-artifact: console probe failed — ${error instanceof Error ? error.message : String(error)}\n${stderr}`,
        );
        child.kill("SIGKILL");
        process.exit(1);
      });
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
