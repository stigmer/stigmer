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
 *      through the runner with zero LLM keys, then one AGENT RUN answered by
 *      a model: the release is installed the way the chart's README tells a
 *      user to configure one (runner.llm.existingSecret for the key,
 *      runner.extraEnv for ANTHROPIC_BASE_URL), pointed at a fake Anthropic
 *      API on this host (test/install/lib/fake-model.mjs), which the pods reach
 *      by host.docker.internal where the kind node resolves it (Docker
 *      Desktop) and by the kind network's gateway otherwise (Linux);
 *   3. (bundled profile) the adversarial arms: the bundled Temporal admits
 *      the stigmer pod and refuses a pod outside the release (its
 *      NetworkPolicy, enforced by kind's network plugin); the pod is deleted
 *      and the execution is still there; `helm upgrade` with unchanged
 *      values moves no pod; `helm uninstall` leaves every claim; a second
 *      install of the same name adopts them and the execution is still
 *      there.
 *
 * The BYO profile first applies ci/byo-infra.yaml (a Postgres and a
 * Temporal the chart did not install) and proves the externalDatabase and
 * externalTemporal wiring against them.
 *
 * Usage:
 *   node test/install/smoke-helm.mjs --build
 *       Builds both images from source through docker-compose.dev.yml (the
 *       compose gate's own path; run `make build-server build-web
 *       stage-compose-runner-cli` and bundle-slim first — make smoke-helm
 *       does all of it), tags them as the chart's repositories at tag
 *       `compose-dev`, loads them into kind and installs with pullPolicy
 *       Never.
 *
 *   node test/install/smoke-helm.mjs --published --version=vX.Y.Z
 *       Installs the chart pointing at the published ghcr.io images at that
 *       tag (the release lane's mode).
 *
 *   --chart=<dir|file.tgz>   the chart to install (default: deploy/helm/stigmer)
 *   --profiles=bundled,byo   which profiles to run (default: both)
 *   --cluster=<name>         use an existing kind cluster and leave it
 *   --keep                   leave the cluster running for debugging
 *   --fake-model=error       the fake answers every model call with an error,
 *                            so the agent run must fail (its red-first check)
 *
 * How the cluster and each release are brought up, forwarded and torn down
 * is test/install/lib/install-helm.mjs, the one boot the upgrade rehearsal
 * shares. The caller's kubeconfig and current context are never changed: a
 * cluster the smoke creates has a kubeconfig of its own, and --cluster is
 * addressed by --context. The port-forward uses the product's fixed ports
 * 7234/7235, so this smoke refuses to start if they are occupied. Keys are
 * generated fresh per run; a developer's real Secrets are never read.
 *
 * Plain node + the helm, kind, kubectl and docker CLIs, no dependencies.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import {
  assertArtifactLane,
  assertConsoleServed,
  assertPortFree,
  connectJson,
  runAgentToReply,
  runSetVarsWorkflow,
  waitForServing,
} from "./lib/stigmer-smoke.mjs";
import { fakeModelEnv, parseFakeModelArg, startFakeModel } from "./lib/fake-model.mjs";
import {
  CHECKOUT_CHART,
  HELM_ARTIFACT_PORT,
  HELM_SERVER_PORT,
  RELEASE,
  chartFor,
  createKindCluster,
  createStigmerRelease,
  profileValues,
} from "./lib/install-helm.mjs";

const chartRoot = CHECKOUT_CHART;

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
    fakeModel: "reply",
  };
  for (const arg of process.argv.slice(2)) {
    let m;
    const fakeModelMode = parseFakeModelArg(arg);
    if (fakeModelMode !== undefined) args.fakeModel = fakeModelMode;
    else if (arg === "--build") args.mode = "build";
    else if (arg === "--published")
      args.mode = args.mode === "" ? "published" : args.mode;
    else if ((m = arg.match(/^--version=(.+)$/)) !== null) args.version = m[1].replace(/^v/, "");
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
    if (!existsSync(profileValues(profile))) {
      fail(`unknown profile '${profile}' (no ci/values-${profile}.yaml)`);
    }
  }
  args.release = args.mode === "build" ? { kind: "build" } : { kind: "published", version: args.version };
  return args;
}

function fail(message) {
  console.error(`smoke-helm: ${message}`);
  process.exit(1);
}

function log(step) {
  console.log(`smoke-helm: ${step}`);
}

/** The kind cluster this run drives; every kubectl call goes through its --kubeconfig and --context. */
let cluster;

function kubectl(args, options = {}) {
  return cluster.kubectl(args, options);
}

function kubectlJson(args) {
  return cluster.kubectlJson(args);
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

/**
 * Every container of every pod in the namespace has restarted zero times: the
 * init container did compose's depends_on job. `tolerate` names
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

/** The shared probes: SERVING, the console contract, the artifact lane, a workflow run, an agent run. */
async function probeStack(release, fake) {
  const forward = await release.portForward();
  const { baseUrl } = forward;
  try {
    log("waiting for the server health service (SERVING)...");
    await waitForServing(baseUrl, SERVER_HEALTHY_TIMEOUT_MS);
    log("health service: SERVING");
    await assertConsoleServed(baseUrl);
    log("console lane: /config.json contract + / html both answer");
    await assertArtifactLane(forward.artifactUrl);
    log("artifact file server: answering through the port-forward");
    const { executionId } = await runSetVarsWorkflow(
      baseUrl,
      RUN_COMPLETED_TIMEOUT_MS,
      log,
    );
    log(
      `end-to-end run: execution ${executionId} COMPLETED through the runner`,
    );
    const agentRun = await runAgentToReply(baseUrl, RUN_COMPLETED_TIMEOUT_MS, {
      expectText: fake.replyText,
      log,
    });
    log(
      `agent run: execution ${agentRun.executionId} COMPLETED with the model's reply (${fake.requests()} model calls)`,
    );
    return executionId;
  } finally {
    forward.stop();
  }
}

/** The execution created before a disruption must read back COMPLETED after it. */
async function assertExecutionSurvived(release, executionId, what) {
  const forward = await release.portForward();
  const { baseUrl } = forward;
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

/**
 * One TCP connect to the bundled Temporal's frontend, printed as CONNECTED
 * or BLOCKED. A NetworkPolicy drops the packets rather than refusing them,
 * so a fenced connect times out; the timeout is the refusal.
 */
function temporalProbeScript(namespace) {
  const host = `${RELEASE}-temporal.${namespace}.svc.cluster.local`;
  return (
    `const s=require("net").connect(7233,"${host}");s.setTimeout(8000);` +
    `s.on("connect",()=>{console.log("CONNECTED");process.exit(0)});` +
    `s.on("timeout",()=>{console.log("BLOCKED");process.exit(0)});` +
    `s.on("error",(e)=>{console.log("BLOCKED "+e.code);process.exit(0)});`
  );
}

/**
 * The bundled Temporal authenticates nothing, so its fence is what keeps the
 * rest of the cluster off the runner's queue: the stigmer pod connects, and
 * a pod outside the release (the server image, run bare) does not.
 */
async function temporalFenceArm(namespace) {
  log("arm: the bundled Temporal admits the stigmer pod and no other");
  const script = temporalProbeScript(namespace);
  const inside = kubectl(
    ["-n", namespace, "exec", `deployment/${RELEASE}`, "-c", "server", "--", "node", "-e", script],
  ).trim();
  if (inside !== "CONNECTED") {
    throw new Error(`the stigmer pod could not reach its own Temporal: ${inside}`);
  }
  const image = kubectlJson(["-n", namespace, "get", "deployment", RELEASE]).spec.template.spec.containers.find(
    (container) => container.name === "server",
  ).image;
  const probe = "temporal-fence-probe";
  kubectl([
    "-n",
    namespace,
    "run",
    probe,
    `--image=${image}`,
    "--image-pull-policy=IfNotPresent",
    "--restart=Never",
    "--labels=app.kubernetes.io/component=fence-probe",
    "--command",
    "--",
    "node",
    "-e",
    script,
  ]);
  const deadline = Date.now() + 120_000;
  let phase = "";
  while (Date.now() < deadline) {
    phase = kubectlJson(["-n", namespace, "get", "pod", probe]).status?.phase ?? "";
    if (phase === "Succeeded" || phase === "Failed") break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const outside = kubectl(["-n", namespace, "logs", probe]).trim();
  kubectl(["-n", namespace, "delete", "pod", probe, "--wait=true"]);
  if (!outside.startsWith("BLOCKED")) {
    throw new Error(
      `a pod outside the release reached the bundled Temporal (${phase}: ${outside}) — the NetworkPolicy is not enforced`,
    );
  }
  log(`the stigmer pod: CONNECTED; a pod outside the release: ${outside}`);
}

/** The bundled profile's adversarial arms. */
async function adversarialArms(release, args, executionId) {
  const { namespace } = release;
  await temporalFenceArm(namespace);

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
  await assertExecutionSurvived(release, executionId, "pod deletion");

  log("arm: helm upgrade with unchanged values");
  const uidBefore = stigmerPodUid(namespace);
  await release.upgrade(chartFor(args.release, { chart: args.chart }));
  const uidAfter = stigmerPodUid(namespace);
  if (uidBefore !== uidAfter) {
    throw new Error(
      "helm upgrade with unchanged values recreated the pod — the render is not idempotent",
    );
  }
  log("after an unchanged upgrade: the same pod is running");

  log("arm: helm uninstall leaves every claim");
  const claimsBefore = claimNames(namespace);
  await release.uninstall();
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
  await release.install(chartFor(args.release, { chart: args.chart }));
  assertZeroRestarts(namespace, { tolerate: ["runner", "temporal"] });
  await assertExecutionSurvived(
    release,
    executionId,
    "uninstall and reinstall",
  );
}

async function runProfile(profile, args, postgresPassword, fake, modelBaseUrl) {
  const namespace = `smoke-${profile}`;
  log(`=== profile ${profile} (namespace ${namespace}) ===`);
  const release = createStigmerRelease(cluster, {
    namespace,
    valuesFile: profileValues(profile),
    modelBaseUrl,
    postgresPassword,
    log,
  });
  current = release;
  release.createSecrets();
  if (profile === "byo") installByoInfra(postgresPassword);

  log(
    `helm install ${RELEASE} (${args.mode === "build" ? "source-built images" : `published ${args.version}`})`,
  );
  await release.install(chartFor(args.release, { chart: args.chart }));
  assertZeroRestarts(namespace);
  log("every container reached Ready with zero restarts");

  const executionId = await probeStack(release, fake);
  if (profile === "bundled") {
    await adversarialArms(release, args, executionId);
  }
  log(`=== profile ${profile}: PASS ===`);
  // A passing profile leaves nothing behind, so a reused cluster (--cluster)
  // can run the next profile or the next iteration cleanly.
  kubectl(["delete", "namespace", namespace, "--wait=false"]);
  if (profile === "byo")
    kubectl(["delete", "namespace", "byo-infra", "--wait=false"]);
}

/** The release being exercised, so a failure can print its diagnostics. */
let current;

async function main() {
  const args = parseArgs();
  assertTools();
  await assertPortFree(HELM_SERVER_PORT);
  await assertPortFree(HELM_ARTIFACT_PORT);

  cluster = createKindCluster({ existing: args.cluster, log });
  const postgresPassword = randomBytes(24).toString("hex");
  let failed = false;
  const fake = await startFakeModel({ host: "0.0.0.0", mode: args.fakeModel });
  try {
    await cluster.start();
    if (args.mode === "build") cluster.loadSourceImages();
    const modelBaseUrl = fakeModelEnv(fake, cluster.hostAddress()).ANTHROPIC_BASE_URL;
    log(`the model: the fake at ${modelBaseUrl}, mode ${args.fakeModel}`);

    for (const profile of args.profiles) {
      await runProfile(profile, args, postgresPassword, fake, modelBaseUrl);
    }
    log("PASS");
  } catch (error) {
    failed = true;
    console.error(
      `smoke-helm: FAIL — ${error instanceof Error ? error.message : String(error)}`,
    );
    if (current !== undefined) console.error(current.diagnostics());
  } finally {
    await cluster.stop({ keep: args.keep && !failed });
    await fake.close();
  }
  process.exit(failed ? 1 : 0);
}

await main();
