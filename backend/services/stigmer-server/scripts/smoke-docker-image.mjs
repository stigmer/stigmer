#!/usr/bin/env node

/**
 * Boot-smokes the official server Docker image — the
 * ONE smoke, shared by three consumers so their proofs cannot drift:
 *
 *   - local dev:        make smoke-docker-image
 *   - PR CI:            ci.stigmer-server.yaml (both native arches; the
 *                       amd64 job runs a second pass with DATABASE_URL —
 *                       the image must not meet Postgres for the first
 *                       time at the compose gate)
 *   - the release lane: release.npm-libs.yaml smoke jobs run the PUSHED
 *                       tag on native runners before `latest` is promoted
 *
 * What one pass proves, in order:
 *   1. the container reaches Docker `healthy` — this executes the
 *      Dockerfile's HEALTHCHECK line, which no other test touches;
 *   2. the real health service answers SERVING over the Connect JSON lane
 *      (wiring-complete, not merely port-bound);
 *   3. the console is served: /config.json is the trusted-local document
 *      (the shared probe in test/install/lib/stigmer-smoke.mjs; #1087) and /
 *      answers HTML — the bundled console must survive packaging;
 *   4. the server made its one organization at its first start, and a CRUD
 *      round-trip (an Agent create naming no organization → get) through the
 *      Connect JSON lane lands in it;
 *   5. state survives `docker restart` — the /data volume story is
 *      proven, not claimed (under DATABASE_URL the same probe proves the
 *      Postgres path instead) — and the restarted server holds the same one
 *      organization, making none of its own;
 *   6. `docker stop` (SIGTERM) exits 0 — the clean-shutdown lifecycle.
 *
 * Usage:
 *   node scripts/smoke-docker-image.mjs [--image=TAG] [--database-url=URL]
 *
 *   Without --image: stages dist-slim/ (built by bundle-slim.mjs for THIS
 *   machine's arch) into dist-slim-<arch>/ and builds a local image first.
 *   With --image: smokes the given tag as-is (the release lane's mode).
 *
 *   --database-url runs the container against Postgres. The URL is
 *   resolved INSIDE the container: reach a host-published Postgres via
 *   host.docker.internal (the script adds the host-gateway mapping).
 *
 * Plain node + docker CLI, no dependencies — runnable everywhere CI is.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assertConsoleServed,
  connectJson,
  readSingleOrganization,
} from "../../../../test/install/lib/stigmer-smoke.mjs";

const serverRoot = fileURLToPath(new URL("..", import.meta.url));

const BOOT_TIMEOUT_MS = 90_000;
// docker stop's grace must outlast the server's own drain (verify-slim
// allows 20s) — a SIGKILL here would pass silently as a dirty shutdown.
const STOP_GRACE_SECONDS = 30;

function parseArgs() {
  let image = "";
  let databaseUrl = "";
  for (const arg of process.argv.slice(2)) {
    let m;
    if ((m = arg.match(/^--image=(.+)$/)) !== null) image = m[1];
    else if ((m = arg.match(/^--database-url=(.+)$/)) !== null) databaseUrl = m[1];
    else fail(`unknown argument: ${arg}`);
  }
  return { image, databaseUrl };
}

function fail(message) {
  console.error(`smoke-docker-image: ${message}`);
  process.exit(1);
}

function log(step) {
  console.log(`smoke-docker-image: ${step}`);
}

function docker(args, options = {}) {
  return execFileSync("docker", args, { encoding: "utf8", ...options }).trim();
}

/** node's arch names map straight onto docker's TARGETARCH for our two. */
function dockerArch() {
  const arch = process.arch;
  if (arch === "x64") return "amd64";
  if (arch === "arm64") return "arm64";
  fail(`unsupported host arch "${arch}" — the image ships amd64 + arm64 only`);
}

function buildLocalImage() {
  const distSlim = join(serverRoot, "dist-slim");
  if (!existsSync(join(distSlim, "main.js"))) {
    fail(
      "dist-slim/main.js not found — build it first:\n" +
        "  npm run build && node scripts/bundle-slim.mjs",
    );
  }
  const arch = dockerArch();
  const staged = join(serverRoot, `dist-slim-${arch}`);
  log(`staging dist-slim/ -> dist-slim-${arch}/ (the Dockerfile's TARGETARCH contract)`);
  rmSync(staged, { recursive: true, force: true });
  cpSync(distSlim, staged, { recursive: true });
  const tag = "stigmer-server:smoke-local";
  log(`docker build ${tag}`);
  execFileSync("docker", ["build", "--tag", tag, serverRoot], {
    stdio: "inherit",
  });
  return tag;
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
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${label} (${timeoutMs}ms): ${lastError}`);
}

async function main() {
  const { image: imageArg, databaseUrl } = parseArgs();
  const image = imageArg !== "" ? imageArg : buildLocalImage();

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const container = `stigmer-server-smoke-${suffix}`;
  const volume = `stigmer-server-smoke-data-${suffix}`;

  const runArgs = [
    "run",
    "--detach",
    "--name",
    container,
    // Ephemeral host ports on loopback: parallel-safe on shared CI hosts.
    "-p",
    "127.0.0.1::7234",
    "-v",
    `${volume}:/data`,
  ];
  if (databaseUrl !== "") {
    // host-gateway resolves host.docker.internal on Linux runners too, so
    // one URL shape reaches a host-published Postgres from every CI host.
    runArgs.push("--add-host=host.docker.internal:host-gateway");
    runArgs.push("-e", `DATABASE_URL=${databaseUrl}`);
  }
  runArgs.push(image);

  let failed = false;
  try {
    log(`docker run ${image} (${databaseUrl !== "" ? "postgres" : "sqlite"} mode)`);
    docker(runArgs);

    const hostPort = docker(["port", container, "7234/tcp"])
      .split("\n")[0]
      .split(":")
      .pop();
    const baseUrl = `http://127.0.0.1:${hostPort}`;
    log(`unified port published at ${baseUrl}`);

    // 1. Docker-level health: proves the HEALTHCHECK instruction itself.
    log("waiting for the container to report healthy...");
    await pollUntil("docker health=healthy", BOOT_TIMEOUT_MS, () => {
      const state = docker([
        "inspect",
        "--format",
        "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}",
        container,
      ]);
      if (!state.startsWith("running")) {
        throw new Error(`container is not running: ${state}`);
      }
      return state.endsWith(" healthy");
    });

    // 2. The health service over Connect JSON, from the host's side.
    const health = await connectJson(baseUrl, "grpc.health.v1.Health/Check", {});
    if (health.status !== "SERVING") {
      throw new Error(`health service answered ${JSON.stringify(health)} — want SERVING`);
    }
    log("health service: SERVING");

    // 3. The console lane: the one trusted-local /config.json
    // document and a real page (test/install/lib/stigmer-smoke.mjs).
    await assertConsoleServed(baseUrl);
    log("console lane: /config.json contract + / html both answer");

    // 4. The organization the server made, then CRUD through the same lane a
    // curl user gets, naming no organization: the server fills its one.
    const orgId = await readSingleOrganization(baseUrl);
    log(`organization '${orgId}' made by the server at its first start`);
    const agentName = `smoke-agent-${suffix}`;
    const created = await connectJson(
      baseUrl,
      "ai.stigmer.agentic.agent.v1.AgentCommandController/create",
      {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Agent",
        metadata: { name: agentName },
        spec: { description: "docker image smoke fixture", instructions: "Never run.", mcpServerUsages: [] },
      },
    );
    const agentId = created.metadata?.id;
    if (agentId === undefined || agentId === "") {
      throw new Error(`agent create returned no id: ${JSON.stringify(created)}`);
    }
    if (created.metadata?.org !== orgId) {
      throw new Error(`agent landed in '${created.metadata?.org}' — want the server's '${orgId}'`);
    }
    const fetched = await connectJson(
      baseUrl,
      "ai.stigmer.agentic.agent.v1.AgentQueryController/get",
      { value: agentId },
    );
    if (fetched.metadata?.name !== agentName) {
      throw new Error(`agent get returned ${fetched.metadata?.name} — want ${agentName}`);
    }
    log(`CRUD round-trip: agent '${agentId}' created in '${orgId}' with no organization named, and fetched`);

    // 5. Persistence across a restart: the volume (or Postgres) must carry
    // the row into the next container lifecycle.
    log("restarting the container...");
    docker(["restart", "--time", String(STOP_GRACE_SECONDS), container]);
    const restartedPort = docker(["port", container, "7234/tcp"])
      .split("\n")[0]
      .split(":")
      .pop();
    const restartedBase = `http://127.0.0.1:${restartedPort}`;
    await pollUntil("health=SERVING after restart", BOOT_TIMEOUT_MS, async () => {
      const check = await connectJson(restartedBase, "grpc.health.v1.Health/Check", {});
      return check.status === "SERVING";
    });
    const survived = await connectJson(
      restartedBase,
      "ai.stigmer.agentic.agent.v1.AgentQueryController/get",
      { value: agentId },
    );
    if (survived.metadata?.name !== agentName) {
      throw new Error(`agent did not survive the restart: ${JSON.stringify(survived)}`);
    }
    const restartedOrgId = await readSingleOrganization(restartedBase);
    if (restartedOrgId !== orgId) {
      throw new Error(`the restarted server holds '${restartedOrgId}' — want the same '${orgId}'`);
    }
    log("persistence: the agent and the one organization survived a container restart");

    // 6. Clean shutdown: SIGTERM in, exit code 0 out.
    log("stopping (SIGTERM)...");
    docker(["stop", "--time", String(STOP_GRACE_SECONDS), container]);
    const exitCode = docker(["inspect", "--format", "{{.State.ExitCode}}", container]);
    if (exitCode !== "0") {
      throw new Error(`container exited ${exitCode} on SIGTERM — want 0`);
    }
    log("clean shutdown: exit 0");
    log("PASS");
  } catch (error) {
    failed = true;
    console.error(
      `smoke-docker-image: FAIL — ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error("--- docker logs (last 200 lines) ---");
    const logs = spawnSync("docker", ["logs", "--tail", "200", container], {
      encoding: "utf8",
    });
    console.error(logs.stdout ?? "");
    console.error(logs.stderr ?? "");
  } finally {
    spawnSync("docker", ["rm", "--force", container]);
    spawnSync("docker", ["volume", "rm", "--force", volume]);
  }
  process.exit(failed ? 1 : 0);
}

await main();
