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
 *   2. the banner carries the evaluation label and, with the model
 *      configured, no no-key warning;
 *   3. the real health service answers SERVING and the console lane serves
 *      its contract (/config.json, / as HTML);
 *   4. the backend was bootstrapped on first boot: the `stigmer` organization
 *      exists (the bootstrap's one act; a fresh install needs no default
 *      content because a session with no agent runs the built-in assistant);
 *   5. one end-to-end run — an LLM-free set_vars workflow — reaches
 *      EXECUTION_COMPLETED: only possible if the embedded Temporal, the
 *      server's workers AND the embedded runner all work inside the one
 *      container (this is also the only boot check the EMITTED slim npm
 *      packages get, the shape a laptop's `stigmer up` acquires); then an
 *      agent answers: the container is started the way a user configures a
 *      model (ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL), pointed at a fake
 *      Anthropic API on this host (test/install/lib/fake-model.mjs), and the
 *      run must complete with the fake's reply as its last message;
 *   6. the artifact file server answers on its published port;
 *   7. state survives `docker restart`, the agent's reply included;
 *   8. state and liveness survive an UNCLEAN restart (`docker kill`, then
 *      `docker start`): the stale PID and lock files a fresh PID namespace
 *      makes deterministic must not make the daemon signal itself or refuse
 *      Temporal's lock, and Temporal must not enter a restart loop (exactly
 *      one dev-server process, same pid, across three supervisor ticks);
 *   9. `docker stop -t 30` (SIGTERM through tini) exits 0;
 *  10. a bind mount the non-root user cannot write is refused with the
 *      entrypoint's message (skipped where the host does not enforce
 *      ownership, e.g. Docker Desktop on macOS);
 *  11. started with no LLM credential, the banner warns that agents will
 *      not execute — the words a first-time user reads.
 *
 * Usage:
 *   node test/install/smoke-all-in-one.mjs [--image=TAG] [--fake-model=error]
 *
 *   Without --image: builds a local image from deploy/all-in-one/stage
 *   (stage-all-in-one.mjs must have run; `make smoke-all-in-one` does both).
 *   With --image: smokes the given tag as-is (the release lane's mode).
 *   --fake-model=error: the fake answers every model call with an error, so
 *   step 5's agent run must fail — the red-first check of that step.
 *
 * How the container is built, run and read (its flags, its published ports,
 * its health, its diagnostics) is test/install/lib/install-all-in-one.mjs, the
 * one boot the upgrade rehearsal shares.
 *
 * Plain node + docker CLI, no dependencies — runnable everywhere CI is.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import {
  assertArtifactLane,
  assertConsoleServed,
  connectJson,
  lastAiReply,
  pollUntil,
  readAgentExecution,
  runAgentToReply,
  runSetVarsWorkflow,
  sleep,
  waitForBootstrapOrganization,
  waitForServing,
} from "./lib/stigmer-smoke.mjs";
import { fakeModelEnv, parseFakeModelArg, startFakeModel } from "./lib/fake-model.mjs";
import { STOP_GRACE_SECONDS, allInOneImage, createAllInOne } from "./lib/install-all-in-one.mjs";

// Temporal boots, the server gates, the runner polls; generous for shared CI hosts.
const HEALTHY_TIMEOUT_MS = 180_000;
const RUN_COMPLETED_TIMEOUT_MS = 180_000;
// Three ticks of Temporal's 5s supervisor: a restart loop shows within one.
const SUPERVISOR_WINDOW_MS = 16_000;
// deploy/all-in-one/entrypoint.sh's words when no LLM credential is set.
const NO_KEY_WARNING = "Agents will not execute";

function parseArgs() {
  let image = "";
  let fakeModel = "reply";
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--image=(.+)$/);
    const mode = parseFakeModelArg(arg);
    if (m !== null) image = m[1];
    else if (mode !== undefined) fakeModel = mode;
    else fail(`unknown argument: ${arg}`);
  }
  return { image, fakeModel };
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
  const { image: givenImage, fakeModel } = parseArgs();

  const suffix = `${Date.now()}`;
  let failed = false;
  // The container reaches this host by the gateway name Docker maps.
  const fake = await startFakeModel({ host: "0.0.0.0", mode: fakeModel });
  const modelEnv = fakeModelEnv(fake, "host.docker.internal");
  const aio = createAllInOne({ model: modelEnv, log, suffix });
  const { container } = aio;

  try {
    const image = givenImage !== "" ? givenImage : allInOneImage({ kind: "build" }, log);
    log(`docker run ${image} (the model: the fake at ${modelEnv.ANTHROPIC_BASE_URL}, mode ${fakeModel})`);
    await aio.start(image);
    const baseUrl = aio.baseUrl();
    const artifactUrl = aio.artifactUrl();

    // 1. Docker healthy — the HEALTHCHECK line itself.
    await aio.waitHealthy();
    log("docker health: healthy");

    // 2. The banner, with no no-key warning now that a model is configured;
    // the runner's mirrored lines follow the server's gate by a moment, so
    // this polls like the rest.
    await pollUntil("banner and mirrored component logs", HEALTHY_TIMEOUT_MS, () => {
      const logs = docker(["logs", container]);
      for (const needle of ["EVALUATION ONLY", "NOT FOR PRODUCTION"]) {
        if (!logs.includes(needle)) throw new Error(`container logs lack ${JSON.stringify(needle)}`);
      }
      if (logs.includes(NO_KEY_WARNING)) throw new Error("the no-key warning printed with a model configured");
      if (!logs.includes("[stigmer-server]") || !logs.includes("[runner]")) {
        throw new Error("container logs carry no mirrored server/runner lines yet");
      }
      return true;
    });
    log("banner: evaluation label and mirrored component logs present; no no-key warning");

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
    const { executionId } = await runSetVarsWorkflow(baseUrl, RUN_COMPLETED_TIMEOUT_MS, log);
    log(`end-to-end run: execution ${executionId} COMPLETED inside the one container`);
    const agentRun = await runAgentToReply(baseUrl, RUN_COMPLETED_TIMEOUT_MS, { expectText: fake.replyText, log });
    log(`agent run: execution ${agentRun.executionId} COMPLETED with the model's reply (${fake.requests()} model calls)`);

    // 6. The artifact lane on its published port.
    await assertArtifactLane(artifactUrl);
    log("artifact file server: answering on the published port");

    // 7. Clean restart: state survives.
    log(`docker restart --time ${STOP_GRACE_SECONDS}`);
    docker(["restart", "--time", String(STOP_GRACE_SECONDS), container]);
    await aio.waitHealthy();
    const restartedBase = aio.baseUrl();
    const after = await connectJson(
      restartedBase,
      "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionQueryController/get",
      { value: executionId },
    );
    if (after.status?.phase !== "EXECUTION_COMPLETED") {
      throw new Error(`execution ${executionId} not found or not completed after restart: ${JSON.stringify(after.status)}`);
    }
    const agentAfter = await readAgentExecution(restartedBase, agentRun.executionId);
    if (lastAiReply(agentAfter) !== agentRun.reply) {
      throw new Error(`agent execution ${agentRun.executionId} lost its reply across the restart: ${JSON.stringify(agentAfter.status)}`);
    }
    log("state survived docker restart, the agent's reply included");

    // 8. Unclean restart: stale pid/lock files on the volume, fresh PID namespace.
    log("docker kill (unclean stop), then docker start");
    docker(["kill", container]);
    docker(["start", container]);
    await aio.waitHealthy();
    const uncleanBase = aio.baseUrl();
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
    await assertUnwritableBindMountRefused(aio.image, suffix);

    // 11. Without a credential, the banner says agents will not execute.
    await assertNoKeyWarning(aio.image, suffix);

    log("PASS");
  } catch (error) {
    failed = true;
    console.error(`smoke-all-in-one: FAIL — ${error instanceof Error ? error.message : String(error)}`);
    console.error(aio.diagnostics());
  } finally {
    await aio.stop();
    await fake.close();
  }
  process.exit(failed ? 1 : 0);
}

/**
 * Boots the image with no LLM credential on a volume of its own and waits for
 * the entrypoint's warning, which it prints before the stack starts; the
 * container is removed as soon as the words are seen.
 */
async function assertNoKeyWarning(image, suffix) {
  const container = `stigmer-aio-smoke-nokey-${suffix}`;
  const volume = `${container}-data`;
  try {
    docker(["run", "--detach", "--name", container, "--volume", `${volume}:/data`, image]);
    await pollUntil("the no-key warning", HEALTHY_TIMEOUT_MS, () => docker(["logs", container]).includes(NO_KEY_WARNING));
    log("no LLM credential: the banner warns that agents will not execute");
  } finally {
    spawnSync("docker", ["rm", "--force", container], { stdio: "ignore" });
    spawnSync("docker", ["volume", "rm", "--force", volume], { stdio: "ignore" });
  }
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
