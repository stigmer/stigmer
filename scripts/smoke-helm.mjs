#!/usr/bin/env node

/**
 * The Helm chart smoke — the ONE smoke for deploy/helm/stigmer, shared by
 * three consumers so their proofs cannot drift (the smoke-compose.mjs shape):
 *
 *   - local dev:        make smoke-helm               (build-from-source)
 *   - PR CI:            ci.helm-chart.yaml            (build-from-source)
 *   - the release lane: release.npm-libs.yaml runs it against the PUSHED
 *                       image tags and the PACKAGED chart on native amd64
 *                       AND arm64 runners before the chart is pushed
 *
 * What one pass proves, per profile (ci/values-<profile>.yaml), on a kind
 * cluster this script creates:
 *   1. `helm install --wait` reaches Ready with every container's restart
 *      count at ZERO — the init container did compose's depends_on job
 *      (a crash-looping first boot would pass --wait and hide here);
 *   2. through a port-forward, the same probes as the compose stack and the
 *      all-in-one: health SERVING, the console's /config.json contract, the
 *      artifact file server, one END-TO-END `set_vars` workflow execution
 *      through the runner with zero LLM keys;
 *   3. (bundled profile) the adversarial arms: the pod is deleted and the
 *      execution is still there; `helm upgrade` with unchanged values moves
 *      no pod; `helm uninstall` leaves every claim; a second install of the
 *      same name adopts them and the execution is still there.
 *
 * The BYO profile first applies ci/byo-infra.yaml (a Postgres and a
 * Temporal the chart did not install) and proves the externalDatabase and
 * externalTemporal wiring against them.
 *
 * Usage:
 *   node scripts/smoke-helm.mjs --build
 *       Builds both images from source through docker-compose.dev.yml (the
 *       compose gate's own path; run `make build-server build-web
 *       stage-compose-runner-cli` and bundle-slim first — make smoke-helm
 *       does all of it), tags them as the chart's repositories at tag
 *       `compose-dev`, loads them into kind and installs with pullPolicy
 *       Never.
 *
 *   node scripts/smoke-helm.mjs --published --version=vX.Y.Z
 *       Installs the chart pointing at the published ghcr.io images at that
 *       tag (the release lane's mode).
 *
 *   --chart=<dir|file.tgz>   the chart to install (default: deploy/helm/stigmer)
 *   --profiles=bundled,byo   which profiles to run (default: both)
 *   --cluster=<name>         use an existing kind cluster and leave it
 *   --keep                   leave the cluster running for debugging
 *
 * The port-forward uses the product's fixed ports 7234/7235, so this smoke
 * refuses to start if they are occupied. Keys are generated fresh per run;
 * a developer's real Secrets are never read.
 *
 * Plain node + the helm, kind, kubectl and docker CLIs, no dependencies.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assertArtifactLane,
  assertConsoleServed,
  assertPortFree,
  connectJson,
  pollUntil,
  runSetVarsWorkflow,
  waitForServing,
} from "./lib/stigmer-smoke.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const serverRoot = join(repoRoot, "backend", "services", "stigmer-server");
const runnerCliStage = join(repoRoot, "backend", "services", "runner", "stage", "cli");
const chartRoot = join(repoRoot, "deploy", "helm", "stigmer");

const SERVER_PORT = 7234;
const ARTIFACT_PORT = 7235;
const RELEASE = "stigmer";
/** The chart's two repositories; --build tags the source builds under them. */
const IMAGE_REGISTRY = "ghcr.io/stigmer";
const SERVER_REPOSITORY = "stigmer-server";
const RUNNER_REPOSITORY = "stigmer-runner";
const DEV_TAG = "compose-dev";

// First install pulls or loads two large images, starts Postgres, lets
// auto-setup create Temporal's schema, and waits through the server's
// startup probe; generous on shared CI hosts.
const INSTALL_TIMEOUT = "12m";
const SERVER_HEALTHY_TIMEOUT_MS = 180_000;
const RUN_COMPLETED_TIMEOUT_MS = 240_000;
const ROLLOUT_TIMEOUT = "8m";

function parseArgs() {
  const args = {
    mode: "",
    version: "",
    chart: chartRoot,
    profiles: ["bundled", "byo"],
    cluster: "",
    keep: false,
  };
  for (const arg of process.argv.slice(2)) {
    let m;
    if (arg === "--build") args.mode = "build";
    else if (arg === "--published")
      args.mode = args.mode === "" ? "published" : args.mode;
    else if ((m = arg.match(/^--version=(.+)$/)) !== null) args.version = m[1];
    else if ((m = arg.match(/^--chart=(.+)$/)) !== null) args.chart = m[1];
    else if ((m = arg.match(/^--profiles=(.+)$/)) !== null)
      args.profiles = m[1].split(",");
    else if ((m = arg.match(/^--cluster=(.+)$/)) !== null) args.cluster = m[1];
    else if (arg === "--keep") args.keep = true;
    else fail(`unknown argument: ${arg}`);
  }
  if (args.mode === "") fail("pass exactly one of --build or --published");
  if (args.mode === "published" && args.version === "") {
    fail("--published requires --version=vX.Y.Z (the pushed image tag)");
  }
  for (const profile of args.profiles) {
    if (!existsSync(join(chartRoot, "ci", `values-${profile}.yaml`))) {
      fail(`unknown profile '${profile}' (no ci/values-${profile}.yaml)`);
    }
  }
  return args;
}

function fail(message) {
  console.error(`smoke-helm: ${message}`);
  process.exit(1);
}

function log(step) {
  console.log(`smoke-helm: ${step}`);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    ...options,
  });
}

function kubectl(args, options = {}) {
  return run("kubectl", args, options);
}

function kubectlJson(args) {
  return JSON.parse(kubectl([...args, "-o", "json"]));
}

/** Every tool the smoke drives must be on PATH before anything is created. */
function assertTools() {
  for (const tool of ["helm", "kind", "kubectl", "docker"]) {
    const probe = spawnSync(tool, ["version", "--client"], {
      encoding: "utf8",
    });
    if (probe.error && probe.error.code === "ENOENT")
      fail(`${tool} not found on PATH`);
  }
}

/** The dev server image COPYs dist-slim-<arch>/ (the smoke-compose.mjs staging contract). */
function stageServerTree() {
  const distSlim = join(serverRoot, "dist-slim");
  if (!existsSync(join(distSlim, "main.js"))) {
    fail(
      "dist-slim/main.js not found — build it first:\n" +
        "  make build-server build-web && " +
        "cd backend/services/stigmer-server && node scripts/bundle-slim.mjs",
    );
  }
  const arch =
    process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : "";
  if (arch === "") fail(`unsupported host arch "${process.arch}"`);
  const staged = join(serverRoot, `dist-slim-${arch}`);
  log(`staging dist-slim/ -> dist-slim-${arch}/`);
  rmSync(staged, { recursive: true, force: true });
  cpSync(distSlim, staged, { recursive: true });
}

/**
 * The dev runner image installs the CLI tarballs staged under
 * backend/services/runner/stage/cli (the smoke-compose.mjs contract) and
 * asserts their version against the STIGMER_CLI_VERSION build-arg, which
 * docker-compose.dev.yml requires.
 */
function stagedRunnerCliVersion() {
  const versionFile = join(runnerCliStage, "VERSION");
  if (!existsSync(versionFile)) {
    fail(
      "backend/services/runner/stage/cli is not staged — run `make stage-compose-runner-cli` " +
        "(or `node scripts/stage-compose-runner-cli.mjs`) first; `make smoke-helm` does",
    );
  }
  return readFileSync(versionFile, "utf8").trim();
}

/**
 * Build both images from source exactly as the compose gate does, retag them
 * under the chart's repositories, and load them into the kind node. The
 * chart then installs with pullPolicy Never, so nothing can be pulled from
 * the registry behind the proof's back.
 */
function buildAndLoadImages(cluster) {
  stageServerTree();
  log("docker compose build (server + runner from source)");
  run(
    "docker",
    [
      "compose",
      "-f",
      join(repoRoot, "docker-compose.yml"),
      "-f",
      join(repoRoot, "docker-compose.dev.yml"),
      "build",
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        POSTGRES_PASSWORD: "unused",
        STIGMER_ENCRYPTION_KEY: "unused",
        STIGMER_RUNNER_TOKEN_KEY: "unused",
        STIGMER_CLI_VERSION: stagedRunnerCliVersion(),
      },
    },
  );
  const images = [
    [
      `${SERVER_REPOSITORY}:${DEV_TAG}`,
      `${IMAGE_REGISTRY}/${SERVER_REPOSITORY}:${DEV_TAG}`,
    ],
    [
      `${RUNNER_REPOSITORY}:${DEV_TAG}`,
      `${IMAGE_REGISTRY}/${RUNNER_REPOSITORY}:${DEV_TAG}`,
    ],
  ];
  for (const [built, tagged] of images) {
    run("docker", ["tag", built, tagged]);
    log(`kind load docker-image ${tagged}`);
    run("kind", ["load", "docker-image", tagged, "--name", cluster], {
      stdio: "inherit",
    });
  }
}

function freshSecretLiterals(withPostgresPassword, postgresPassword) {
  const literals = [
    `--from-literal=STIGMER_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`,
    `--from-literal=STIGMER_RUNNER_TOKEN_KEY=${randomBytes(32).toString("base64")}`,
  ];
  if (withPostgresPassword)
    literals.push(`--from-literal=POSTGRES_PASSWORD=${postgresPassword}`);
  return literals;
}

/** The chart's Secret in the profile's namespace, with fresh keys. */
function createChartSecret(namespace, postgresPassword) {
  kubectl(["create", "namespace", namespace]);
  kubectl([
    "-n",
    namespace,
    "create",
    "secret",
    "generic",
    "stigmer-secrets",
    ...freshSecretLiterals(true, postgresPassword),
  ]);
}

/** The BYO stand-ins: their Secret shares the chart's database password. */
function installByoInfra(postgresPassword) {
  log("applying the bring-your-own Postgres and Temporal (ci/byo-infra.yaml)");
  kubectl(["create", "namespace", "byo-infra"]);
  kubectl([
    "-n",
    "byo-infra",
    "create",
    "secret",
    "generic",
    "byo-secrets",
    `--from-literal=POSTGRES_PASSWORD=${postgresPassword}`,
  ]);
  kubectl(["apply", "-f", join(chartRoot, "ci", "byo-infra.yaml")], {
    stdio: "inherit",
  });
  kubectl(
    [
      "-n",
      "byo-infra",
      "rollout",
      "status",
      "statefulset/byo-postgres",
      `--timeout=${ROLLOUT_TIMEOUT}`,
    ],
    { stdio: "inherit" },
  );
  kubectl(
    [
      "-n",
      "byo-infra",
      "rollout",
      "status",
      "deployment/byo-temporal",
      `--timeout=${ROLLOUT_TIMEOUT}`,
    ],
    { stdio: "inherit" },
  );
}

function helmInstallArgs(verb, namespace, profile, args) {
  const helmArgs = [
    verb,
    RELEASE,
    args.chart,
    "-n",
    namespace,
    "-f",
    join(chartRoot, "ci", `values-${profile}.yaml`),
    "--wait",
    "--timeout",
    INSTALL_TIMEOUT,
  ];
  if (args.mode === "build") {
    helmArgs.push(
      "--set",
      `image.server.tag=${DEV_TAG}`,
      "--set",
      `image.runner.tag=${DEV_TAG}`,
      "--set",
      "image.pullPolicy=Never",
    );
  } else {
    helmArgs.push(
      "--set",
      `image.server.tag=${args.version}`,
      "--set",
      `image.runner.tag=${args.version}`,
    );
  }
  return helmArgs;
}

/**
 * Every container of every pod in the namespace has restarted zero times: the
 * init container did compose's depends_on job (F12, F14). `tolerate` names
 * containers whose restarts are logged, not failed: the runner exits fatally on
 * a failed initial Temporal connection (stigmer#1105) where the server retries,
 * so when Temporal is recreated under load while the runner is starting, the
 * runner crash-loops until the frontend answers. The bundled Temporal's
 * auto-setup was also seen exiting once on a reinstall against its existing
 * schema ("Back-off restarting failed container temporal"; healed on the
 * restart, not reproduced in three later runs). A fresh install tolerates
 * nothing; the reinstall arm tolerates those two, because the fixes are
 * theirs (the runner's boot posture; a third-party image's recovery path) and
 * the arm's point is the data surviving, which is asserted after.
 */
function assertZeroRestarts(namespace, { tolerate = [] } = {}) {
  const pods = kubectlJson(["-n", namespace, "get", "pods"]).items;
  if (pods.length === 0) throw new Error(`no pods in ${namespace}`);
  for (const pod of pods) {
    const statuses = [
      ...(pod.status.initContainerStatuses ?? []),
      ...(pod.status.containerStatuses ?? []),
    ];
    for (const status of statuses) {
      if (status.restartCount === 0) continue;
      const message = `${pod.metadata.name}/${status.name} restarted ${status.restartCount} time(s) during install`;
      if (tolerate.includes(status.name)) {
        log(`${message} (tolerated on a reinstall: see assertZeroRestarts)`);
        continue;
      }
      throw new Error(
        `${message} — the init container should have made first boot deterministic`,
      );
    }
  }
}

function stigmerPodUid(namespace) {
  const pods = kubectlJson([
    "-n",
    namespace,
    "get",
    "pods",
    "-l",
    "app.kubernetes.io/component=stigmer",
  ]).items;
  if (pods.length !== 1)
    throw new Error(
      `expected one stigmer pod in ${namespace}, found ${pods.length}`,
    );
  return pods[0].metadata.uid;
}

/** A port-forward to the release's Service; resolves once the port answers. */
async function portForward(namespace) {
  const child = spawn(
    "kubectl",
    [
      "-n",
      namespace,
      "port-forward",
      `svc/${RELEASE}`,
      `${SERVER_PORT}:7234`,
      `${ARTIFACT_PORT}:7235`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  await pollUntil(
    "port-forward to answer",
    60_000,
    () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) resolve(false);
        const socket = connect({
          host: "127.0.0.1",
          port: SERVER_PORT,
          timeout: 1000,
        });
        socket.once("connect", () => {
          socket.destroy();
          resolve(true);
        });
        socket.once("error", () => resolve(false));
        socket.once("timeout", () => {
          socket.destroy();
          resolve(false);
        });
      }),
    { intervalMs: 500 },
  );
  return {
    stop() {
      if (child.exitCode === null) child.kill("SIGTERM");
      return stderr;
    },
  };
}

/** The shared probes: SERVING, the console contract, the artifact lane, one run. */
async function probeStack(namespace) {
  const baseUrl = `http://127.0.0.1:${SERVER_PORT}`;
  const forward = await portForward(namespace);
  try {
    log("waiting for the server health service (SERVING)...");
    await waitForServing(baseUrl, SERVER_HEALTHY_TIMEOUT_MS);
    log("health service: SERVING");
    await assertConsoleServed(baseUrl);
    log("console lane: /config.json contract + / html both answer");
    await assertArtifactLane(`http://127.0.0.1:${ARTIFACT_PORT}`);
    log("artifact file server: answering through the port-forward");
    const executionId = await runSetVarsWorkflow(
      baseUrl,
      RUN_COMPLETED_TIMEOUT_MS,
      log,
    );
    log(
      `end-to-end run: execution ${executionId} COMPLETED through the runner`,
    );
    return executionId;
  } finally {
    forward.stop();
  }
}

/** The execution created before a disruption must read back COMPLETED after it. */
async function assertExecutionSurvived(namespace, executionId, what) {
  const baseUrl = `http://127.0.0.1:${SERVER_PORT}`;
  const forward = await portForward(namespace);
  try {
    await waitForServing(baseUrl, SERVER_HEALTHY_TIMEOUT_MS);
    const current = await connectJson(
      baseUrl,
      "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionQueryController/get",
      { value: executionId },
    );
    const phase = current.status?.phase;
    if (phase !== "EXECUTION_COMPLETED") {
      throw new Error(
        `after ${what}, execution ${executionId} reads ${phase}, want EXECUTION_COMPLETED`,
      );
    }
    log(`after ${what}: execution ${executionId} still COMPLETED`);
  } finally {
    forward.stop();
  }
}

function claimNames(namespace) {
  return kubectlJson(["-n", namespace, "get", "pvc"])
    .items.map((claim) => claim.metadata.name)
    .sort();
}

/** The bundled profile's adversarial arms (the plan's test plan, Q-HC-16). */
async function adversarialArms(namespace, profile, args, executionId) {
  log("arm: deleting the stigmer pod");
  kubectl(
    [
      "-n",
      namespace,
      "delete",
      "pod",
      "-l",
      "app.kubernetes.io/component=stigmer",
      "--wait=true",
    ],
    { stdio: "inherit" },
  );
  kubectl(
    [
      "-n",
      namespace,
      "rollout",
      "status",
      `deployment/${RELEASE}`,
      `--timeout=${ROLLOUT_TIMEOUT}`,
    ],
    { stdio: "inherit" },
  );
  await assertExecutionSurvived(namespace, executionId, "pod deletion");

  log("arm: helm upgrade with unchanged values");
  const uidBefore = stigmerPodUid(namespace);
  run("helm", helmInstallArgs("upgrade", namespace, profile, args), {
    stdio: "inherit",
  });
  const uidAfter = stigmerPodUid(namespace);
  if (uidBefore !== uidAfter) {
    throw new Error(
      "helm upgrade with unchanged values recreated the pod — the render is not idempotent",
    );
  }
  log("after an unchanged upgrade: the same pod is running");

  log("arm: helm uninstall leaves every claim");
  const claimsBefore = claimNames(namespace);
  run("helm", ["uninstall", RELEASE, "-n", namespace, "--wait"], {
    stdio: "inherit",
  });
  const claimsAfter = claimNames(namespace);
  if (JSON.stringify(claimsBefore) !== JSON.stringify(claimsAfter)) {
    throw new Error(
      `helm uninstall changed the claims: before ${claimsBefore}, after ${claimsAfter}`,
    );
  }
  log(
    `after uninstall: ${claimsAfter.length} claims kept (${claimsAfter.join(", ")})`,
  );

  log("arm: a second install of the same name adopts the claims");
  // What an operator does: let the old pods finish terminating before the
  // new release starts, so the new pods do not race the old Temporal's
  // endpoint disappearing.
  kubectl([
    "-n",
    namespace,
    "wait",
    "--for=delete",
    "pod",
    "--all",
    "--timeout=5m",
  ]);
  run("helm", helmInstallArgs("install", namespace, profile, args), {
    stdio: "inherit",
  });
  assertZeroRestarts(namespace, { tolerate: ["runner", "temporal"] });
  await assertExecutionSurvived(
    namespace,
    executionId,
    "uninstall and reinstall",
  );
}

function dumpDiagnostics(namespace) {
  console.error(`--- kubectl get pods -A ---`);
  console.error(
    spawnSync("kubectl", ["get", "pods", "-A", "-o", "wide"], {
      encoding: "utf8",
    }).stdout ?? "",
  );
  console.error(`--- kubectl get events -n ${namespace} ---`);
  console.error(
    spawnSync(
      "kubectl",
      ["-n", namespace, "get", "events", "--sort-by=.lastTimestamp"],
      {
        encoding: "utf8",
      },
    ).stdout ?? "",
  );
  // Every component's current logs, and the previous container's where one
  // restarted: a crash that healed before the dump is otherwise invisible.
  const targets = [
    ["stigmer", "wait-for-dependencies"],
    ["stigmer", "server"],
    ["stigmer", "runner"],
    ["temporal", "wait-for-postgres"],
    ["temporal", "temporal"],
    ["postgres", "postgres"],
  ];
  for (const [component, container] of targets) {
    for (const previous of [false, true]) {
      const args = [
        "-n",
        namespace,
        "logs",
        "-l",
        `app.kubernetes.io/component=${component}`,
        "-c",
        container,
        "--tail=120",
      ];
      if (previous) args.push("--previous");
      const logs = spawnSync("kubectl", args, { encoding: "utf8" });
      if (previous && logs.status !== 0) continue; // no previous container: nothing restarted
      console.error(
        `--- logs ${component}/${container}${previous ? " (previous container)" : ""} ---`,
      );
      console.error(logs.stdout ?? "");
      if (!previous) console.error(logs.stderr ?? "");
    }
  }
}

async function runProfile(profile, args, postgresPassword) {
  const namespace = `smoke-${profile}`;
  log(`=== profile ${profile} (namespace ${namespace}) ===`);
  createChartSecret(namespace, postgresPassword);
  if (profile === "byo") installByoInfra(postgresPassword);

  log(
    `helm install ${RELEASE} (${args.mode === "build" ? "source-built images" : `published ${args.version}`})`,
  );
  run("helm", helmInstallArgs("install", namespace, profile, args), {
    stdio: "inherit",
  });
  assertZeroRestarts(namespace);
  log("every container reached Ready with zero restarts");

  const executionId = await probeStack(namespace);
  if (profile === "bundled") {
    await adversarialArms(namespace, profile, args, executionId);
  }
  log(`=== profile ${profile}: PASS ===`);
  // A passing profile leaves nothing behind, so a reused cluster (--cluster)
  // can run the next profile or the next iteration cleanly.
  kubectl(["delete", "namespace", namespace, "--wait=false"]);
  if (profile === "byo")
    kubectl(["delete", "namespace", "byo-infra", "--wait=false"]);
}

async function main() {
  const args = parseArgs();
  assertTools();
  await assertPortFree(SERVER_PORT);
  await assertPortFree(ARTIFACT_PORT);

  const ownCluster = args.cluster === "";
  const cluster = ownCluster
    ? `stigmer-helm-smoke-${Date.now()}`
    : args.cluster;
  const postgresPassword = randomBytes(24).toString("hex");
  let failed = false;
  let currentNamespace = "";
  try {
    if (ownCluster) {
      log(`kind create cluster ${cluster}`);
      run("kind", ["create", "cluster", "--name", cluster, "--wait", "120s"], {
        stdio: "inherit",
      });
    }
    run("kubectl", ["config", "use-context", `kind-${cluster}`]);
    if (args.mode === "build") buildAndLoadImages(cluster);

    for (const profile of args.profiles) {
      currentNamespace = `smoke-${profile}`;
      await runProfile(profile, args, postgresPassword);
    }
    log("PASS");
  } catch (error) {
    failed = true;
    console.error(
      `smoke-helm: FAIL — ${error instanceof Error ? error.message : String(error)}`,
    );
    if (currentNamespace !== "") dumpDiagnostics(currentNamespace);
  } finally {
    if (ownCluster && !(args.keep && !failed)) {
      spawnSync("kind", ["delete", "cluster", "--name", cluster], {
        stdio: "inherit",
      });
    } else if (ownCluster) {
      log(`--keep: cluster ${cluster} left running`);
    }
  }
  process.exit(failed ? 1 : 0);
}

await main();
