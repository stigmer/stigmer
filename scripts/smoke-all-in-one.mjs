#!/usr/bin/env node

/**
 * Boot-smokes the all-in-one evaluation image (deploy/all-in-one) — the ONE
 * smoke, shared by three consumers so their proofs cannot drift:
 *
 *   - local dev:        make smoke-all-in-one
 *   - PR CI:            ci.all-in-one.yaml (both native arches, from the
 *                       PR's own sources)
 *   - the release lane: release.npm-libs.yaml smoke jobs run the PUSHED tag
 *                       on native runners before `latest` is promoted
 *
 * What one pass proves, in order:
 *   1. the container reaches Docker `healthy` — this executes the
 *      Dockerfile's HEALTHCHECK line, which no other test touches;
 *   2. the banner carries the evaluation label, and with no LLM credential
 *      the no-key warning — the words a first-time user reads;
 *   3. the real health service answers SERVING and the console lane serves
 *      its contract (/config.json, / as HTML);
 *   4. the backend was bootstrapped on first boot: the `stigmer` organization
 *      exists (the bootstrap's one act; a fresh install needs no default
 *      content because a session with no agent runs the built-in assistant);
 *   5. one end-to-end run — an LLM-free set_vars workflow — reaches
 *      EXECUTION_COMPLETED: only possible if the embedded Temporal, the
 *      server's workers AND the embedded runner all work inside the one
 *      container (this is also the only boot check the EMITTED slim npm
 *      packages get, the shape a laptop's `stigmer up` acquires);
 *   6. the artifact file server answers on its published port;
 *   7. state survives `docker restart`;
 *   8. state and liveness survive an UNCLEAN restart (`docker kill`, then
 *      `docker start`): the stale PID and lock files a fresh PID namespace
 *      makes deterministic must not make the daemon signal itself or refuse
 *      Temporal's lock, and Temporal must not enter a restart loop (exactly
 *      one dev-server process, same pid, across three supervisor ticks);
 *   9. `docker stop -t 30` (SIGTERM through tini) exits 0;
 *  10. a bind mount the non-root user cannot write is refused with the
 *      entrypoint's message (skipped where the host does not enforce
 *      ownership, e.g. Docker Desktop on macOS).
 *
 * Usage:
 *   node scripts/smoke-all-in-one.mjs [--image=TAG]
 *
 *   Without --image: builds a local image from deploy/all-in-one/stage
 *   (stage-all-in-one.mjs must have run; `make smoke-all-in-one` does both).
 *   With --image: smokes the given tag as-is (the release lane's mode).
 *
 * Plain node + docker CLI, no dependencies — runnable everywhere CI is.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assertArtifactLane,
  assertConsoleServed,
  connectJson,
  pollUntil,
  runSetVarsWorkflow,
  sleep,
  waitForBootstrapOrganization,
  waitForServing,
} from "./lib/stigmer-smoke.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const imageRoot = join(repoRoot, "deploy", "all-in-one");

// Temporal boots, the server gates, the runner polls; generous for shared CI hosts.
const HEALTHY_TIMEOUT_MS = 180_000;
const RUN_COMPLETED_TIMEOUT_MS = 180_000;
// The daemon's graceful teardown budget (runner, server, then Temporal).
const STOP_GRACE_SECONDS = 30;
// Three ticks of Temporal's 5s supervisor: a restart loop shows within one.
const SUPERVISOR_WINDOW_MS = 16_000;

function parseArgs() {
  let image = "";
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--image=(.+)$/);
    if (m !== null) image = m[1];
    else fail(`unknown argument: ${arg}`);
  }
  return { image };
}

function fail(message) {
  console.error(`smoke-all-in-one: ${message}`);
  process.exit(1);
}

function log(step) {
  console.log(`smoke-all-in-one: ${step}`);
}

function docker(args, options = {}) {
  return execFileSync("docker", args, { encoding: "utf8", ...options }).trim();
}

function buildLocalImage() {
  const versionFile = join(imageRoot, "stage", "VERSION");
  if (!existsSync(versionFile)) {
    fail("deploy/all-in-one/stage is not staged — run `node scripts/stage-all-in-one.mjs` first (or `make smoke-all-in-one`)");
  }
  const version = readFileSync(versionFile, "utf8").trim();
  const tag = "stigmer-all-in-one:smoke-local";
  log(`docker build ${tag} (STIGMER_VERSION=${version})`);
  execFileSync("docker", ["build", "--build-arg", `STIGMER_VERSION=${version}`, "--tag", tag, imageRoot], {
    stdio: "inherit",
  });
  return tag;
}

/** Host port docker published for a container port, bound to loopback. */
function publishedPort(container, containerPort) {
  const out = docker(["port", container, String(containerPort)]);
  const m = out.match(/:(\d+)\s*$/m);
  if (m === null) throw new Error(`docker port ${container} ${containerPort} -> ${JSON.stringify(out)}`);
  return Number(m[1]);
}

async function waitHealthy(container) {
  await pollUntil(`${container} healthy`, HEALTHY_TIMEOUT_MS, () => {
    const status = docker(["inspect", "--format", "{{.State.Health.Status}}", container]);
    if (status === "unhealthy") throw new Error("container reported unhealthy");
    if (docker(["inspect", "--format", "{{.State.Running}}", container]) !== "true") {
      throw new Error("container is not running");
    }
    return status === "healthy";
  });
}

/**
 * Temporal dev-server processes inside the container, by /proc (the image has
 * no ps). Matched on a command line that STARTS with the baked binary's path,
 * so the probe's own sh/grep — whose arguments mention the pattern — never
 * count themselves.
 */
function temporalProcesses(container) {
  const out = docker([
    "exec",
    container,
    "sh",
    "-c",
    'n=0; for p in /proc/[0-9]*; do c=$(tr "\\0" " " < "$p/cmdline" 2>/dev/null); case "$c" in "$STIGMER_TEMPORAL_BIN server start-dev"*) n=$((n+1));; esac; done; echo $n',
  ]);
  return Number(out.trim());
}

function temporalPid(container) {
  return docker(["exec", container, "cat", "/data/.stigmer/temporal.pid"]).trim();
}

async function main() {
  const { image: givenImage } = parseArgs();
  const image = givenImage !== "" ? givenImage : buildLocalImage();

  const suffix = `${Date.now()}`;
  const container = `stigmer-aio-smoke-${suffix}`;
  const volume = `${container}-data`;
  let failed = false;

  try {
    log(`docker run ${image} (no LLM credential on purpose)`);
    docker([
      "run",
      "--detach",
      "--name",
      container,
      "--publish",
      "127.0.0.1::7234",
      "--publish",
      "127.0.0.1::7235",
      "--volume",
      `${volume}:/data`,
      image,
    ]);
    const baseUrl = `http://127.0.0.1:${publishedPort(container, 7234)}`;
    const artifactUrl = `http://127.0.0.1:${publishedPort(container, 7235)}`;

    // 1. Docker healthy — the HEALTHCHECK line itself.
    await waitHealthy(container);
    log("docker health: healthy");

    // 2. The banner and the no-key warning; the runner's mirrored lines
    // follow the server's gate by a moment, so this polls like the rest.
    await pollUntil("banner and mirrored component logs", HEALTHY_TIMEOUT_MS, () => {
      const logs = docker(["logs", container]);
      for (const needle of ["EVALUATION ONLY", "NOT FOR PRODUCTION", "Agents will not execute"]) {
        if (!logs.includes(needle)) throw new Error(`container logs lack ${JSON.stringify(needle)}`);
      }
      if (!logs.includes("[stigmer-server]") || !logs.includes("[runner]")) {
        throw new Error("container logs carry no mirrored server/runner lines yet");
      }
      return true;
    });
    log("banner: evaluation label, no-key warning, and mirrored component logs present");

    // 3. SERVING and the console lane.
    await waitForServing(baseUrl, HEALTHY_TIMEOUT_MS);
    await assertConsoleServed(baseUrl);
    log("health service SERVING; console lane answers");

    // 4. The bootstrap. `healthy` is the server's SERVING; the bootstrap runs
    // a few seconds later, from the daemon's onStarted, and creates the
    // `stigmer` organization. Its presence proves the bootstrap ran.
    const orgId = await waitForBootstrapOrganization(baseUrl, HEALTHY_TIMEOUT_MS);
    log(`organization 'stigmer' present after first boot (${orgId})`);

    // 5. The end-to-end run through Temporal, the server's workers and the runner.
    const executionId = await runSetVarsWorkflow(baseUrl, RUN_COMPLETED_TIMEOUT_MS, log);
    log(`end-to-end run: execution ${executionId} COMPLETED inside the one container`);

    // 6. The artifact lane on its published port.
    await assertArtifactLane(artifactUrl);
    log("artifact file server: answering on the published port");

    // 7. Clean restart: state survives.
    log(`docker restart --time ${STOP_GRACE_SECONDS}`);
    docker(["restart", "--time", String(STOP_GRACE_SECONDS), container]);
    await waitHealthy(container);
    const restartedBase = `http://127.0.0.1:${publishedPort(container, 7234)}`;
    const after = await connectJson(
      restartedBase,
      "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionQueryController/get",
      { value: executionId },
    );
    if (after.status?.phase !== "EXECUTION_COMPLETED") {
      throw new Error(`execution ${executionId} not found or not completed after restart: ${JSON.stringify(after.status)}`);
    }
    log("state survived docker restart");

    // 8. Unclean restart: stale pid/lock files on the volume, fresh PID namespace.
    log("docker kill (unclean stop), then docker start");
    docker(["kill", container]);
    docker(["start", container]);
    await waitHealthy(container);
    const uncleanBase = `http://127.0.0.1:${publishedPort(container, 7234)}`;
    await waitForServing(uncleanBase, HEALTHY_TIMEOUT_MS);
    const pidBefore = temporalPid(container);
    const countBefore = temporalProcesses(container);
    if (countBefore !== 1) throw new Error(`expected exactly one Temporal dev-server after the unclean restart, found ${countBefore}`);
    await sleep(SUPERVISOR_WINDOW_MS);
    const pidAfter = temporalPid(container);
    const countAfter = temporalProcesses(container);
    if (countAfter !== 1 || pidAfter !== pidBefore) {
      throw new Error(
        `Temporal churned across the supervisor window: processes ${countBefore}->${countAfter}, pid ${pidBefore}->${pidAfter} (a restart loop)`,
      );
    }
    const stillThere = await connectJson(
      uncleanBase,
      "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionQueryController/get",
      { value: executionId },
    );
    if (stillThere.status?.phase !== "EXECUTION_COMPLETED") {
      throw new Error(`execution ${executionId} lost across the unclean restart`);
    }
    log("unclean restart: recovered; one Temporal, same pid, across three supervisor ticks; state intact");

    // 9. Graceful stop exits 0.
    log(`docker stop --time ${STOP_GRACE_SECONDS}`);
    docker(["stop", "--time", String(STOP_GRACE_SECONDS), container]);
    const exitCode = docker(["inspect", "--format", "{{.State.ExitCode}}", container]);
    if (exitCode !== "0") throw new Error(`container exited ${exitCode} on docker stop — want 0`);
    log("docker stop: exit 0");

    // 10. An unwritable bind mount is refused with the entrypoint's message.
    await assertUnwritableBindMountRefused(image, suffix);

    log("PASS");
  } catch (error) {
    failed = true;
    console.error(`smoke-all-in-one: FAIL — ${error instanceof Error ? error.message : String(error)}`);
    console.error("--- docker logs (last 150 lines) ---");
    const logs = spawnSync("docker", ["logs", "--tail", "150", container], { encoding: "utf8" });
    console.error(logs.stdout ?? "");
    console.error(logs.stderr ?? "");
    console.error("--- component logs on the volume ---");
    const tails = spawnSync(
      "docker",
      ["run", "--rm", "--volume", `${volume}:/data`, "--entrypoint", "sh", image, "-c", "tail -n 40 /data/.stigmer/data/logs/*.log /data/.stigmer/data/logs/temporal.log 2>/dev/null"],
      { encoding: "utf8" },
    );
    console.error(tails.stdout ?? "");
  } finally {
    spawnSync("docker", ["rm", "--force", container], { stdio: "ignore" });
    spawnSync("docker", ["volume", "rm", "--force", volume], { stdio: "ignore" });
  }
  process.exit(failed ? 1 : 0);
}

async function assertUnwritableBindMountRefused(image, suffix) {
  const hostDir = mkdtempSync(join(tmpdir(), "stigmer-aio-ro-"));
  chmodSync(hostDir, 0o555);
  const container = `stigmer-aio-smoke-ro-${suffix}`;
  try {
    // Does this host enforce the directory's ownership inside the container?
    const enforced = spawnSync(
      "docker",
      ["run", "--rm", "--volume", `${hostDir}:/data`, "--entrypoint", "sh", image, "-c", "test -w /data && echo writable || echo unwritable"],
      { encoding: "utf8" },
    ).stdout.trim();
    if (enforced !== "unwritable") {
      log("bind-mount arm skipped: this host does not enforce directory ownership inside containers (Docker Desktop)");
      return;
    }
    const result = spawnSync("docker", ["run", "--name", container, "--volume", `${hostDir}:/data`, image], { encoding: "utf8" });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status !== 1 || !output.includes("is not writable")) {
      throw new Error(`unwritable bind mount: exit ${result.status}, output ${JSON.stringify(output.slice(0, 300))} — want exit 1 with the entrypoint's message`);
    }
    log("unwritable bind mount: refused with the entrypoint's message");
  } finally {
    spawnSync("docker", ["rm", "--force", container], { stdio: "ignore" });
    chmodSync(hostDir, 0o755);
    rmSync(hostDir, { recursive: true, force: true });
  }
}

await main();
