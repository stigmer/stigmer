#!/usr/bin/env node

/**
 * The compose-stack gate smoke (DD-013, Phase-2 P5) — the ONE smoke,
 * shared by three consumers so their proofs cannot drift:
 *
 *   - local dev:        make smoke-compose            (build-from-source)
 *   - PR CI:            ci.compose-stack.yaml         (build-from-source)
 *   - the release lane: release.npm-libs.yaml runs it against the PUSHED
 *                       image tags on native amd64 AND arm64 runners
 *                       before `latest` moves and the compose pin bumps
 *
 * What one pass proves, in order:
 *   1. `docker compose up` from this clean tree reaches a healthy server
 *      (the image HEALTHCHECK via compose depends_on, then the real
 *      health service answering SERVING over Connect JSON);
 *   2. the console is served on the unified port (/config.json contract +
 *      / answers HTML) — DD-012 must survive the compose topology;
 *   3. the artifact file server is published and answering on 7235 (the
 *      0.0.0.0 bind + port publish — a 404 from it IS the proof of life);
 *   4. one END-TO-END RUN: a deterministic `set_vars` workflow execution
 *      travels server → Temporal → runner → COMPLETED, with zero LLM
 *      keys (the gate ruling Q-C; the ci.conformance-execution precedent).
 *      This is the line the phase gate draws: the runner container
 *      polled the queue and executed real work;
 *   5. clean teardown (`docker compose down --volumes`).
 *
 * Usage:
 *   node scripts/smoke-compose.mjs --build
 *       Builds both images from source via docker-compose.dev.yml. Both
 *       images COPY staged inputs: the server image a prebuilt slim tree
 *       (`make build-server build-web` and `node backend/services/
 *       stigmer-server/scripts/bundle-slim.mjs`), the runner image the CLI
 *       tarballs it installs (`make stage-compose-runner-cli`). `make
 *       smoke-compose` does all of it.
 *
 *   node scripts/smoke-compose.mjs --published --version=vX.Y.Z
 *       Pulls the published ghcr.io images at that tag (the release
 *       lane's mode; requires the tags to exist).
 *
 *   --keep    leave the stack running (skip teardown) for debugging.
 *
 * The stack publishes fixed host ports 7234/7235 (the product contract),
 * so this smoke refuses to start if they are occupied — stop any running
 * `stigmer up` or compose stack first. Keys are generated fresh per run
 * into a temp env file; a developer's real .env is never read.
 *
 * Plain node + docker CLI, no dependencies — runnable everywhere CI is.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assertArtifactLane,
  assertConsoleServed,
  assertPortFree,
  runSetVarsWorkflow,
  waitForServing,
} from "./lib/stigmer-smoke.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const serverRoot = join(repoRoot, "backend", "services", "stigmer-server");
const runnerCliStage = join(repoRoot, "backend", "services", "runner", "stage", "cli");

const SERVER_PORT = 7234;
const ARTIFACT_PORT = 7235;
// First boot pulls/starts four containers, runs Temporal schema setup, and
// waits for the server's start-period; generous on shared CI hosts.
const SERVER_HEALTHY_TIMEOUT_MS = 240_000;
// The end-to-end run additionally needs the runner's worker to connect
// (it restarts until Temporal answers) and the first task-queue poll.
const RUN_COMPLETED_TIMEOUT_MS = 240_000;

function parseArgs() {
  let mode = "";
  let version = "";
  let keep = false;
  for (const arg of process.argv.slice(2)) {
    let m;
    if (arg === "--build") mode = "build";
    else if (arg === "--published") mode = mode === "" ? "published" : mode;
    else if ((m = arg.match(/^--version=(.+)$/)) !== null) version = m[1];
    else if (arg === "--keep") keep = true;
    else fail(`unknown argument: ${arg}`);
  }
  if (mode === "") fail("pass exactly one of --build or --published");
  if (mode === "published" && version === "") {
    fail("--published requires --version=vX.Y.Z (the pushed image tag)");
  }
  return { mode, version, keep };
}

function fail(message) {
  console.error(`smoke-compose: ${message}`);
  process.exit(1);
}

function log(step) {
  console.log(`smoke-compose: ${step}`);
}

/**
 * The dev server image build COPYs dist-slim-<arch>/; stage it from the
 * dist-slim tree bundle-slim.mjs produced for THIS machine (the
 * smoke-docker-image.mjs staging contract).
 */
function stageServerTree() {
  const distSlim = join(serverRoot, "dist-slim");
  if (!existsSync(join(distSlim, "main.js"))) {
    fail(
      "dist-slim/main.js not found — build it first:\n" +
        "  make build-server build-web && " +
        "cd backend/services/stigmer-server && node scripts/bundle-slim.mjs",
    );
  }
  const arch = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : "";
  if (arch === "") fail(`unsupported host arch "${process.arch}"`);
  const staged = join(serverRoot, `dist-slim-${arch}`);
  log(`staging dist-slim/ -> dist-slim-${arch}/`);
  rmSync(staged, { recursive: true, force: true });
  cpSync(distSlim, staged, { recursive: true });
}

/**
 * The dev runner image installs the CLI tarballs staged under
 * backend/services/runner/stage/cli (scripts/stage-compose-runner-cli.mjs)
 * and asserts their version against the STIGMER_CLI_VERSION build-arg, which
 * docker-compose.dev.yml requires. Returns that version for the env file.
 */
function stagedRunnerCliVersion() {
  const versionFile = join(runnerCliStage, "VERSION");
  if (!existsSync(versionFile)) {
    fail(
      "backend/services/runner/stage/cli is not staged — run `make stage-compose-runner-cli` " +
        "(or `node scripts/stage-compose-runner-cli.mjs`) first; `make smoke-compose` does",
    );
  }
  return readFileSync(versionFile, "utf8").trim();
}

async function main() {
  const { mode, version, keep } = parseArgs();

  await assertPortFree(SERVER_PORT);
  await assertPortFree(ARTIFACT_PORT);

  // Fresh keys per run into an isolated env file: the smoke never reads a
  // developer's real .env, and two runs never share state.
  const workDir = mkdtempSync(join(tmpdir(), "stigmer-compose-smoke-"));
  const envFile = join(workDir, "smoke.env");
  const envLines = [
    `POSTGRES_PASSWORD=${randomBytes(24).toString("hex")}`,
    `STIGMER_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`,
    `STIGMER_RUNNER_TOKEN_KEY=${randomBytes(32).toString("base64")}`,
  ];
  if (version !== "") envLines.push(`STIGMER_VERSION=${version}`);
  if (mode === "build") envLines.push(`STIGMER_CLI_VERSION=${stagedRunnerCliVersion()}`);
  writeFileSync(envFile, envLines.join("\n") + "\n");

  const project = `stigmer-smoke-${Date.now()}`;
  const composeArgs = [
    "compose",
    "-p",
    project,
    "--env-file",
    envFile,
    "-f",
    join(repoRoot, "docker-compose.yml"),
  ];
  if (mode === "build") {
    composeArgs.push("-f", join(repoRoot, "docker-compose.dev.yml"));
  }

  const compose = (args, options = {}) =>
    execFileSync("docker", [...composeArgs, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      ...options,
    });

  let failed = false;
  try {
    if (mode === "build") {
      stageServerTree();
      log("docker compose build (server + runner from source)");
      compose(["build"], { stdio: "inherit" });
    } else {
      log(`pulling published images at ${version}`);
      compose(["pull", "--quiet", "stigmer-server", "stigmer-runner"], { stdio: "inherit" });
    }

    log("docker compose up -d");
    compose(["up", "-d"], { stdio: "inherit" });

    const baseUrl = `http://127.0.0.1:${SERVER_PORT}`;

    // 1. The server healthy — through compose depends_on this also proves
    // Postgres answered pg_isready and the image HEALTHCHECK went green.
    log("waiting for the server health service (SERVING)...");
    await waitForServing(baseUrl, SERVER_HEALTHY_TIMEOUT_MS);
    log("health service: SERVING");

    // 2. The console lane (DD-012) through the compose topology: the one
    // trusted-local /config.json document (scripts/lib/stigmer-smoke.mjs).
    await assertConsoleServed(baseUrl);
    log("console lane: /config.json contract + / html both answer");

    // 3. The artifact file server on its published port.
    await assertArtifactLane(`http://127.0.0.1:${ARTIFACT_PORT}`);
    log("artifact file server: answering on the published port");

    // 4. The end-to-end run — the phase gate's line: it only completes if the
    // runner container connected to Temporal and polled the queue.
    const executionId = await runSetVarsWorkflow(baseUrl, RUN_COMPLETED_TIMEOUT_MS, log);
    log(`end-to-end run: execution ${executionId} COMPLETED through the runner`);

    log("PASS");
  } catch (error) {
    failed = true;
    console.error(
      `smoke-compose: FAIL — ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error("--- docker compose ps ---");
    console.error(spawnSync("docker", [...composeArgs, "ps"], { encoding: "utf8" }).stdout ?? "");
    console.error("--- docker compose logs (last 120 lines/service) ---");
    const logs = spawnSync(
      "docker",
      [...composeArgs, "logs", "--tail", "120"],
      { encoding: "utf8" },
    );
    console.error(logs.stdout ?? "");
    console.error(logs.stderr ?? "");
  } finally {
    if (keep && !failed) {
      log(`--keep: stack left running (project ${project}; env file ${envFile})`);
    } else {
      spawnSync("docker", [...composeArgs, "down", "--volumes", "--remove-orphans"], {
        stdio: "inherit",
      });
      rmSync(workDir, { recursive: true, force: true });
    }
  }
  process.exit(failed ? 1 : 0);
}

await main();
