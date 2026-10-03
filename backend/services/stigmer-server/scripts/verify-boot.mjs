#!/usr/bin/env node

/**
 * Boots a compiled server entry with plain `node` and verifies the full
 * lifecycle: bind → "stigmer-server listening" log → the ready line →
 * SIGTERM → clean exit 0. It boots with GRPC_PORT=0, so the artifact file
 * server binds ephemeral beside it, and a lane that cannot bind fails the
 * boot and this gate with it.
 *
 * The ready line (STIGMER_READY_LINE=stdout, src/boot/ready-line.ts) is what
 * the test harnesses read the bound ports from, and the process body main.ts
 * runs (src/boot/run.ts) is the only place that prints it. Its unit tests
 * drive that body in-process; no unit test runs main.ts, so this gate is
 * where the line is proven on the artifact: one JSON line on stdout, both ports
 * non-zero, and the gRPC port the one the listening log line names.
 *
 * Why this gate exists (the runner's #399 lesson): vitest/tsx module
 * interop tolerates ESM/CJS import shapes that Node's real loader rejects,
 * so an import-time boot crash can pass typecheck AND the whole test suite.
 * This is the only gate that executes the artifact the way the CLI daemon
 * will.
 *
 * `--require-workers`: additionally require
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
// The unified port's bind line. The artifact file server logs its own
// "listening" line and binds FIRST (a lane that cannot bind fails the boot,
// stigmer#1089), so the bare word would read readiness before the port.
const LISTENING_MARKER = "stigmer-server listening";
// The ready line's key (src/boot/ready-line.ts READY_LINE_KEY). Spelled
// here too because this gate runs against an artifact, not the source.
const READY_LINE_KEY = "stigmerServerReady";
const temporalHostPort = process.env.TEMPORAL_HOST_PORT ?? "127.0.0.1:7233";

// Every filesystem-touching stage gets a throwaway root: the boot check
// must never write the operator's ~/.stigmer. STORAGE_PATH matters beyond
// hygiene — the skill domain WIPES {STORAGE_PATH}/skills/staging at boot
// (crash recovery), which against the real default would clear a
// running server's in-flight uploads.
const scratch = mkdtempSync(join(tmpdir(), "verify-boot-"));

const child = spawn(process.execPath, [resolve(serverRoot, entry)], {
  env: {
    ...process.env,
    GRPC_PORT: "0",
    LOG_LEVEL: "info",
    ENV: "ci",
    STIGMER_READY_LINE: "stdout",
    ...(requireWorkers ? { TEMPORAL_HOST_PORT: temporalHostPort } : {}),
    DB_PATH: join(scratch, "stigmer.db"),
    STORAGE_PATH: join(scratch, "storage"),
    ARTIFACT_LOCAL_BASE_PATH: join(scratch, "artifacts"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
let stdout = "";
let sawListening = false;
let sawWorkers = !requireWorkers;
// The listening line's port (ENV=ci logs NDJSON) and the ready line's report.
let listeningPort = null;
let ready = null;
let shutdownTimer = null;

const markers = () =>
  `listening=${sawListening}, workers=${sawWorkers}, ready=${ready !== null}`;

const timer = setTimeout(() => {
  console.error(
    `verify-boot: markers not seen within ${BOOT_TIMEOUT_MS}ms ` +
      `(${markers()})\n${stderr}\n` +
      (ready === null ? `stdout (no ready line):\n${stdout}\n` : "") +
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

// The port the NDJSON listening line names, once that whole line is in.
function readListeningPort() {
  for (const line of stderr.split("\n")) {
    if (!line.includes(LISTENING_MARKER)) continue;
    try {
      const port = JSON.parse(line).port;
      if (Number.isInteger(port)) return port;
    } catch {
      // The line has not fully arrived yet; the next chunk completes it.
    }
  }
  return null;
}

// The ready report from the first whole stdout line carrying its key, or a
// sentence saying what is wrong with it. Other stdout lines are not ours.
function readReadyLine() {
  const whole = stdout.split("\n").slice(0, -1);
  for (const line of whole) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const report = parsed?.[READY_LINE_KEY];
    if (report === undefined) continue;
    const { grpcPort, artifactHttpPort } = report;
    if (!Number.isInteger(grpcPort) || grpcPort <= 0) {
      return { problem: `grpcPort is not a bound port: ${line}` };
    }
    if (!Number.isInteger(artifactHttpPort) || artifactHttpPort <= 0) {
      return { problem: `artifactHttpPort is not a bound port: ${line}` };
    }
    return { report: { grpcPort, artifactHttpPort } };
  }
  return null;
}

function failBoot(reason) {
  clearTimeout(timer);
  console.error(`verify-boot: ${entry} ${reason}\n${stderr}`);
  child.kill("SIGKILL");
  process.exit(1);
}

// The two streams arrive on separate pipes, in either order, so this waits
// for the parsed listening port as well as the ready line before comparing.
function shutDownWhenReady() {
  const allIn = listeningPort !== null && sawWorkers && ready !== null;
  if (!allIn || shutdownTimer !== null) return;
  if (listeningPort !== ready.grpcPort) {
    failBoot(
      `printed a ready line naming gRPC port ${ready.grpcPort}, but its listening line names ${listeningPort}`,
    );
  }
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

child.stderr.on("data", (chunk) => {
  stderr += String(chunk);
  if (!sawListening && stderr.includes(LISTENING_MARKER)) sawListening = true;
  if (!sawWorkers && stderr.includes(WORKERS_MARKER)) sawWorkers = true;
  if (sawListening && listeningPort === null) {
    listeningPort = readListeningPort();
  }
  shutDownWhenReady();
});

child.stdout.on("data", (chunk) => {
  // Forwarded as it was when stdout was inherited; read for the ready line.
  process.stdout.write(chunk);
  stdout += String(chunk);
  if (ready !== null) return;
  const found = readReadyLine();
  if (found?.problem !== undefined) {
    failBoot(`printed a malformed ready line: ${found.problem}`);
  }
  if (found?.report !== undefined) ready = found.report;
  shutDownWhenReady();
});

child.on("exit", (code, signal) => {
  clearTimeout(timer);
  if (shutdownTimer !== null) clearTimeout(shutdownTimer);
  if (sawListening && sawWorkers && ready !== null && code === 0) {
    console.log(
      `verify-boot: ${entry} booted, served, announced its ports${requireWorkers ? ", started all workers" : ""}, and shut down cleanly`,
    );
    process.exit(0);
  }
  console.error(
    `verify-boot: ${entry} failed (${markers()}, code=${code}, signal=${signal})\n${stderr}`,
  );
  process.exit(1);
});
