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
 *       Builds both images from source via docker-compose.dev.yml. The
 *       server image COPYs a prebuilt slim tree: run `make build-server
 *       build-web` and `node backend/services/stigmer-server/scripts/
 *       bundle-slim.mjs` first (make smoke-compose does all of it).
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
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const serverRoot = join(repoRoot, "backend", "services", "stigmer-server");

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

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntil(label, timeoutMs, probe) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const result = await probe();
      if (result !== undefined && result !== false) return result;
      lastError = "probe returned falsy";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(2000);
  }
  throw new Error(`timed out waiting for ${label} (${timeoutMs}ms): ${lastError}`);
}

/** Unary Connect-JSON call — the same lane a curl user gets. */
async function connectJson(procedure, body) {
  const response = await fetch(`http://127.0.0.1:${SERVER_PORT}/${procedure}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${procedure} -> HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

/** Fails when the port is already taken — a stigmer stack is running. */
function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port, timeout: 1500 });
    socket.once("connect", () => {
      socket.destroy();
      reject(new Error(
        `port ${port} is already in use — stop the running stigmer stack ` +
        `(stigmer down / docker compose down) before the smoke`,
      ));
    });
    socket.once("error", () => resolve(undefined)); // refused = free
    socket.once("timeout", () => {
      socket.destroy();
      resolve(undefined);
    });
  });
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

    // 1. The server healthy — through compose depends_on this also proves
    // Postgres answered pg_isready and the image HEALTHCHECK went green.
    log("waiting for the server health service (SERVING)...");
    await pollUntil("health SERVING", SERVER_HEALTHY_TIMEOUT_MS, async () => {
      const health = await connectJson("grpc.health.v1.Health/Check", {});
      return health.status === "SERVING";
    });
    log("health service: SERVING");

    // 2. The console lane (DD-012) through the compose topology.
    const config = await (await fetch(`http://127.0.0.1:${SERVER_PORT}/config.json`)).json();
    if (config.authMode !== "disabled") {
      throw new Error(`/config.json authMode=${config.authMode} — want disabled`);
    }
    if (config.apiUrl !== `http://127.0.0.1:${SERVER_PORT}`) {
      throw new Error(`/config.json apiUrl=${config.apiUrl} — want the Host-derived origin`);
    }
    const index = await fetch(`http://127.0.0.1:${SERVER_PORT}/`);
    const indexType = index.headers.get("content-type") ?? "";
    if (index.status !== 200 || !indexType.includes("text/html")) {
      throw new Error(`console / -> ${index.status} ${indexType} — want 200 text/html`);
    }
    log("console lane: /config.json contract + / html both answer");

    // 3. The artifact file server on its published port: a 404 from the
    // listener proves the 0.0.0.0 bind and the port publish; content
    // round-trips ride the artifact conformance suites, not this smoke.
    const artifactProbe = await fetch(
      `http://127.0.0.1:${ARTIFACT_PORT}/smoke-nonexistent-key`,
    );
    if (artifactProbe.status !== 404) {
      throw new Error(`artifact server probe -> HTTP ${artifactProbe.status} — want 404`);
    }
    log("artifact file server: answering on the published port");

    // 4. The end-to-end run — the phase gate's line. A single set_vars
    // task: sub-second, hermetic, no LLM/MCP/keys (the conformance
    // suite's canonical execution fixture), but it only completes if the
    // runner container connected to Temporal and polled the queue.
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const org = await connectJson(
      "ai.stigmer.tenancy.organization.v1.OrganizationCommandController/create",
      {
        apiVersion: "tenancy.stigmer.ai/v1",
        kind: "Organization",
        metadata: { name: `smoke-org-${suffix}` },
      },
    );
    const orgId = org.metadata?.id;
    if (!orgId) throw new Error(`organization create returned no id: ${JSON.stringify(org)}`);

    const workflow = await connectJson(
      "ai.stigmer.agentic.workflow.v1.WorkflowCommandController/create",
      {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Workflow",
        metadata: { name: `smoke-wf-${suffix}`, org: orgId },
        spec: {
          description: "compose smoke fixture",
          document: {
            dsl: "1.0.0",
            namespace: orgId,
            name: `smoke-wf-${suffix}`,
            version: "1.0.0",
          },
          tasks: [
            {
              name: "setVars",
              kind: "set_vars",
              taskConfig: { variables: { greeting: "hello" } },
              export: { as: "${ . }" },
            },
          ],
        },
      },
    );
    const workflowId = workflow.metadata?.id;
    if (!workflowId) throw new Error(`workflow create returned no id: ${JSON.stringify(workflow)}`);
    log(`workflow ${workflowId} created`);

    const execution = await connectJson(
      "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionCommandController/create",
      {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "WorkflowExecution",
        metadata: { name: `smoke-wfx-${suffix}`, org: orgId },
        spec: { workflowId },
      },
    );
    const executionId = execution.metadata?.id;
    if (!executionId) throw new Error(`execution create returned no id: ${JSON.stringify(execution)}`);
    log(`execution ${executionId} created — awaiting COMPLETED...`);

    const TERMINAL_FAILURES = new Set([
      "EXECUTION_FAILED",
      "EXECUTION_CANCELLED",
      "EXECUTION_TERMINATED",
    ]);
    await pollUntil("execution EXECUTION_COMPLETED", RUN_COMPLETED_TIMEOUT_MS, async () => {
      const current = await connectJson(
        "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionQueryController/get",
        { value: executionId },
      );
      const phase = current.status?.phase ?? "EXECUTION_PHASE_UNSPECIFIED";
      if (TERMINAL_FAILURES.has(phase)) {
        // Terminal-and-wrong: surface immediately with the server's own error.
        throw new Error(
          `execution reached ${phase}: ${JSON.stringify(current.status?.error ?? {})}`,
        );
      }
      return phase === "EXECUTION_COMPLETED";
    });
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
