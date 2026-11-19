#!/usr/bin/env node

/**
 * The Stigmer operator's install test: the operator built from source,
 * installed with its chart on a kind cluster this script creates, and one
 * Stigmer resource per profile brought up and proven end to end.
 *
 *   make smoke-operator PROFILE=bundled      (or byo, enterprise)
 *
 * What one pass proves, per profile:
 *
 * bundled: the shortest declaration (an owner and the model key's Secret)
 *   reaches Ready with no other Secret written by hand: the operator mints
 *   the keys, installs CloudNativePG, runs Postgres and Temporal and the
 *   server with its runner. Every container reaches Ready with zero
 *   restarts. Through a port-forward, the same probes as the chart and the
 *   compose stack: health SERVING, the console's /config.json contract, the
 *   artifact file server, and one END-TO-END AGENT RUN through the runner,
 *   answered by the fake model on this host
 *   (test/install/lib/fake-model.mjs), whose key and address reach the
 *   runner through the one Secret the resource names. Then the arms: the
 *   server's pod is deleted and the execution is still there; a second
 *   Stigmer in another namespace is refused in words naming the first;
 *   Enterprise settings without a license are refused by the API server;
 *   deleting the Stigmer leaves nothing of it in the namespace but the keys
 *   Secret (and the Secret the test wrote); declaring it again finds the
 *   same keys.
 *
 * byo: a Postgres and a Temporal the operator did not install (the chart's
 *   ci/byo-infra.yaml), declared as external; the operator runs neither, and
 *   the stack passes the same probes against them.
 *
 * enterprise (run only when named; it builds the Enterprise image): a
 *   license Secret holding a key signed here, which no image trusts, with
 *   sign-in declared as a license requires. The server runs the Enterprise
 *   image, refuses the key and never becomes ready, and the Stigmer's status
 *   relays the server's own refusal line.
 *
 * Every profile ends with zero ERROR lines in the operator's log.
 *
 * Usage:
 *   node test/install/smoke-operator.mjs [--profiles=bundled,byo] [--cluster=<name>] [--keep] [--fake-model=reply|error]
 *
 * `make smoke-operator` first builds what the source images bundle (the
 * server, the console, the runner's CLI); this script builds the images
 * (compose's build, the operator's Dockerfile) and loads them into kind.
 *
 * Plain node + the helm, kind, kubectl and docker CLIs, no dependencies.
 */

import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { LAYER_ENGINES, assertClaudeReady } from "./lib/claude-engine.mjs";
import { FAKE_MODEL_API_KEY, fakeModelEnv, parseFakeModelArg, startFakeModel } from "./lib/fake-model.mjs";
import { SOURCE_TAG, createKindCluster } from "./lib/kind-cluster.mjs";
import { ARTIFACT_PORT, SERVER_PORT, createOperator, createStigmer } from "./lib/install-operator.mjs";
import {
  assertArtifactLane,
  assertConsoleServed,
  assertPortFree,
  pollUntil,
  readAgentExecution,
  runAgentToReply,
  waitForServing,
} from "./lib/stigmer-smoke.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const PROFILES = ["bundled", "byo", "enterprise"];
// A first install pulls CloudNativePG and Temporal, creates the database and
// its schema, and waits through the server's startup probe; generous on a
// shared CI host.
const READY_TIMEOUT_MS = 15 * 60_000;
const SERVER_HEALTHY_TIMEOUT_MS = 180_000;
const RUN_COMPLETED_TIMEOUT_MS = 240_000;
const GONE_TIMEOUT_MS = 3 * 60_000;
const MODEL_SECRET = "anthropic";
/** The line the Enterprise server prints when it refuses a key (ee/server/scripts/smoke-image.mjs checks the same). */
const LICENSE_REFUSAL = "boot failed: The Stigmer Enterprise license key";

function parseArgs() {
  const args = { profiles: ["bundled", "byo"], cluster: "", keep: false, fakeModel: "reply" };
  for (const arg of process.argv.slice(2)) {
    let m;
    const fakeModelMode = parseFakeModelArg(arg);
    if (fakeModelMode !== undefined) args.fakeModel = fakeModelMode;
    else if ((m = arg.match(/^--profiles=(.+)$/)) !== null) args.profiles = m[1].split(",");
    else if ((m = arg.match(/^--cluster=(.+)$/)) !== null) args.cluster = m[1];
    else if (arg === "--keep") args.keep = true;
    else fail(`unknown argument: ${arg}`);
  }
  for (const profile of args.profiles) {
    if (!PROFILES.includes(profile)) fail(`unknown profile '${profile}' (one of ${PROFILES.join(", ")})`);
  }
  return args;
}

function fail(message) {
  console.error(`smoke-operator: ${message}`);
  process.exit(1);
}

function log(step) {
  console.log(`smoke-operator: ${step}`);
}

let cluster;
let operator;
/** The Stigmer being exercised, so a failure can print its diagnostics. */
let current;

function kubectl(args, options = {}) {
  return cluster.kubectl(args, options);
}

function assertTools() {
  for (const tool of ["helm", "kind", "kubectl", "docker"]) {
    const probe = spawnSync(tool, ["version", "--client"], { encoding: "utf8" });
    if (probe.error && probe.error.code === "ENOENT") fail(`${tool} not found on PATH`);
  }
}

/** The namespace and the one Secret a platform engineer writes: the model's key (and, here, the fake's address). */
function prepareNamespace(namespace, modelBaseUrl) {
  kubectl(["create", "namespace", namespace]);
  kubectl([
    "-n",
    namespace,
    "create",
    "secret",
    "generic",
    MODEL_SECRET,
    `--from-literal=ANTHROPIC_API_KEY=${FAKE_MODEL_API_KEY}`,
    `--from-literal=ANTHROPIC_BASE_URL=${modelBaseUrl}`,
  ]);
}

/** Every container of every pod in the namespace has restarted zero times. */
function assertZeroRestarts(namespace) {
  const pods = cluster.kubectlJson(["-n", namespace, "get", "pods"]).items;
  if (pods.length === 0) throw new Error(`no pods in ${namespace}`);
  for (const pod of pods) {
    for (const status of [...(pod.status.initContainerStatuses ?? []), ...(pod.status.containerStatuses ?? [])]) {
      if (status.restartCount !== 0) {
        throw new Error(`${pod.metadata.name}/${status.name} restarted ${status.restartCount} time(s): the operator's ordering should make first boot deterministic`);
      }
    }
  }
}

function assertOperatorLogClean() {
  const errors = operator.errorLines();
  if (errors.length > 0) throw new Error(`the operator logged ${errors.length} ERROR line(s); a healthy install logs none:\n${errors.slice(0, 5).join("\n")}`);
  log("the operator's log: no ERROR lines");
}

/** The shared probes: SERVING, the console contract, the artifact lane, an agent run. Resolves the run's execution id. */
async function probeStack(stigmer, fake) {
  const forward = await stigmer.portForward();
  const { baseUrl } = forward;
  try {
    await waitForServing(baseUrl, SERVER_HEALTHY_TIMEOUT_MS);
    log("health service: SERVING");
    await assertConsoleServed(baseUrl);
    log("console lane: /config.json contract + / html both answer");
    await assertArtifactLane(forward.artifactUrl);
    log("artifact file server: answering through the port-forward");
    const run = await runAgentToReply(baseUrl, RUN_COMPLETED_TIMEOUT_MS, { expectText: fake.replyText, log });
    log(`agent run: execution ${run.executionId} COMPLETED through the runner with the model's reply (${fake.requests()} model calls)`);
    const runnerLogs = kubectl(["-n", stigmer.namespace, "logs", `deployment/${stigmer.name}`, "-c", "runner", "--tail=-1"]);
    log(`claude: ${assertClaudeReady(runnerLogs, LAYER_ENGINES)}`);
    return run.executionId;
  } finally {
    forward.stop();
  }
}

async function assertExecutionSurvived(stigmer, executionId, what) {
  const forward = await stigmer.portForward();
  try {
    await waitForServing(forward.baseUrl, SERVER_HEALTHY_TIMEOUT_MS);
    const phase = (await readAgentExecution(forward.baseUrl, executionId)).status?.phase;
    if (phase !== "RUN_COMPLETED") throw new Error(`after ${what}, execution ${executionId} reads ${phase}, want RUN_COMPLETED`);
    log(`after ${what}: execution ${executionId} still COMPLETED`);
  } finally {
    forward.stop();
  }
}

/** What is left in a namespace, by kind and name, leaving out what every namespace holds. */
function leftovers(namespace) {
  const kinds = "deployments,statefulsets,services,persistentvolumeclaims,configmaps,secrets,jobs,pods";
  const items = cluster.kubectlJson(["-n", namespace, "get", kinds]).items;
  return items
    .map((i) => `${i.kind}/${i.metadata.name}`)
    .filter((n) => n !== "ConfigMap/kube-root-ca.crt")
    .sort();
}

async function runBundled(fake, modelBaseUrl) {
  const namespace = "smoke-bundled";
  log(`=== profile bundled (namespace ${namespace}) ===`);
  prepareNamespace(namespace, modelBaseUrl);
  const stigmer = createStigmer(cluster, { namespace, log });
  current = stigmer;
  stigmer.apply({ owner: { email: "owner@example.com" }, runner: { llm: { secretName: MODEL_SECRET } } });
  await stigmer.waitReady(READY_TIMEOUT_MS);
  assertZeroRestarts(namespace);
  log("Ready, every container with zero restarts");

  const keysMessage = stigmer.component("keys")?.message ?? "";
  if (!keysMessage.includes("keep a copy outside the cluster")) throw new Error(`the keys component does not say to keep the keys: ${keysMessage}`);
  // Every Secret in the namespace is the model's key the test wrote, or one
  // the operator (labelled) or a controller it runs (an owner) made.
  const secrets = cluster.kubectlJson(["-n", namespace, "get", "secrets"]).items;
  const stray = secrets.filter(
    (s) =>
      s.metadata.name !== MODEL_SECRET &&
      s.metadata.labels?.["app.kubernetes.io/managed-by"] !== "stigmer-operator" &&
      (s.metadata.ownerReferences ?? []).length === 0,
  );
  if (stray.length > 0) throw new Error(`Secrets nobody declared: ${stray.map((s) => s.metadata.name).join(", ")}`);
  log(`${secrets.length} Secrets in the namespace; the one written by hand is the model's key`);

  const executionId = await probeStack(stigmer, fake);

  log("arm: deleting the server's pod");
  kubectl(["-n", namespace, "delete", "pod", "-l", "app.kubernetes.io/component=server,app.kubernetes.io/instance=stigmer", "--wait=true"], {
    stdio: "inherit",
  });
  kubectl(["-n", namespace, "rollout", "status", "deployment/stigmer", "--timeout=8m"], { stdio: "inherit" });
  await assertExecutionSurvived(stigmer, executionId, "pod deletion");

  log("arm: a second Stigmer in the cluster is refused naming the first");
  kubectl(["create", "namespace", "smoke-second"]);
  const second = createStigmer(cluster, { namespace: "smoke-second", log });
  second.apply({});
  await pollUntil("the second Stigmer to be refused", 60_000, () => {
    const cond = second.read()?.status?.conditions?.find((c) => c.type === "Ready");
    return second.read()?.status?.phase === "Refused" && cond?.message?.includes(`${namespace}/stigmer`) ? cond.message : false;
  });
  log(`the second Stigmer: Refused · ${second.read().status.conditions.find((c) => c.type === "Ready").message}`);
  second.delete();
  kubectl(["delete", "namespace", "smoke-second", "--wait=false"]);

  log("arm: Enterprise settings without a license are refused at apply");
  const attempt = spawnSync(
    "kubectl",
    [...kubeconfigArgs(), "apply", "-f", "-"],
    {
      encoding: "utf8",
      input: JSON.stringify({
        apiVersion: "stigmer.ai/v1",
        kind: "Stigmer",
        metadata: { name: "unlicensed", namespace },
        spec: { enterprise: { organizationCreators: ["ida_x"] } },
      }),
    },
  );
  if (attempt.status === 0 || !attempt.stderr.includes("need a license")) {
    throw new Error(`Enterprise settings without a license were not refused: ${attempt.stderr || attempt.stdout}`);
  }
  log(`refused: ${attempt.stderr.trim().split("\n").pop()}`);

  assertOperatorLogClean();

  log("arm: deleting the Stigmer leaves only the keys");
  const keysBefore = cluster.kubectlJson(["-n", namespace, "get", "secret", "stigmer-keys"]).data;
  stigmer.delete();
  const allowed = ["Secret/anthropic", "Secret/stigmer-keys"];
  await pollUntil("everything the Stigmer owned to be removed", GONE_TIMEOUT_MS, () => {
    const left = leftovers(namespace).filter((n) => !allowed.includes(n));
    return left.length === 0 ? true : false;
  });
  log(`left in ${namespace}: ${leftovers(namespace).join(", ")}`);

  log("arm: declaring it again finds the same keys");
  stigmer.apply({ owner: { email: "owner@example.com" }, runner: { llm: { secretName: MODEL_SECRET } } });
  await stigmer.waitComponent("keys", "Ready", 60_000, (c) => c.phase === "Ready");
  const keysAfter = cluster.kubectlJson(["-n", namespace, "get", "secret", "stigmer-keys"]).data;
  if (JSON.stringify(keysBefore) !== JSON.stringify(keysAfter)) throw new Error("the keys changed across a delete and a new declaration");
  log("the keys Secret outlived the Stigmer and was used again unchanged");
  stigmer.delete();
  log("=== profile bundled: PASS ===");
  kubectl(["delete", "namespace", namespace, "--wait=false"]);
}

async function runByo(fake, modelBaseUrl) {
  const namespace = "smoke-byo";
  log(`=== profile byo (namespace ${namespace}) ===`);
  const password = `${randomBytes(12).toString("hex")}@:/${randomBytes(12).toString("hex")}`;
  log("applying the bring-your-own Postgres and Temporal (deploy/helm/stigmer/ci/byo-infra.yaml)");
  kubectl(["create", "namespace", "byo-infra"]);
  kubectl(["-n", "byo-infra", "create", "secret", "generic", "byo-secrets", `--from-literal=POSTGRES_PASSWORD=${password}`]);
  kubectl(["apply", "-f", join(repoRoot, "deploy", "helm", "stigmer", "ci", "byo-infra.yaml")], { stdio: "inherit" });
  kubectl(["-n", "byo-infra", "rollout", "status", "statefulset/byo-postgres", "--timeout=8m"], { stdio: "inherit" });
  kubectl(["-n", "byo-infra", "rollout", "status", "deployment/byo-temporal", "--timeout=8m"], { stdio: "inherit" });

  prepareNamespace(namespace, modelBaseUrl);
  kubectl(["-n", namespace, "create", "secret", "generic", "stigmer-db", `--from-literal=password=${password}`]);
  const stigmer = createStigmer(cluster, { namespace, log });
  current = stigmer;
  stigmer.apply({
    owner: { email: "owner@example.com" },
    runner: { llm: { secretName: MODEL_SECRET } },
    database: {
      postgresql: {
        external: {
          host: "byo-postgres.byo-infra.svc.cluster.local",
          user: "postgres",
          database: "stigmer",
          passwordSecret: { name: "stigmer-db", key: "password" },
        },
      },
    },
    temporal: { external: { hostPort: "byo-temporal.byo-infra.svc.cluster.local:7233" } },
  });
  await stigmer.waitReady(READY_TIMEOUT_MS);
  assertZeroRestarts(namespace);
  log("Ready, every container with zero restarts");
  const running = cluster.kubectlJson(["-n", namespace, "get", "deployments,statefulsets"]).items.map((i) => i.metadata.name);
  if (running.join(",") !== "stigmer") throw new Error(`the operator runs more than the server against your own Postgres and Temporal: ${running}`);
  const clusters = cluster.kubectlQuiet(["-n", namespace, "get", "clusters.postgresql.cnpg.io", "-o", "name"]).stdout?.trim() ?? "";
  if (clusters !== "") throw new Error(`a CloudNativePG Cluster was made against your own Postgres: ${clusters}`);
  log("the operator runs the server alone: no Postgres, no Temporal of its own");
  await probeStack(stigmer, fake);
  assertOperatorLogClean();
  stigmer.delete();
  log("=== profile byo: PASS ===");
  kubectl(["delete", "namespace", namespace, "--wait=false"]);
  kubectl(["delete", "namespace", "byo-infra", "--wait=false"]);
}

/** A key in the license verifier's form, signed by a key pair made here: one no image trusts. */
function untrustedLicenseKey() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const segment = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = segment({ alg: "EdDSA", kid: `operator-smoke-${randomUUID()}`, typ: "JWT" });
  const payload = segment({ iss: "stigmer operator smoke", sub: "a key no release trusts" });
  const signature = sign(null, Buffer.from(`${header}.${payload}`, "ascii"), privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

async function runEnterprise(modelBaseUrl) {
  const namespace = "smoke-enterprise";
  log(`=== profile enterprise (namespace ${namespace}) ===`);
  prepareNamespace(namespace, modelBaseUrl);
  kubectl(["-n", namespace, "create", "secret", "generic", "stigmer-license", `--from-literal=STIGMER_LICENSE_KEY=${untrustedLicenseKey()}`]);
  const stigmer = createStigmer(cluster, { namespace, log });
  current = stigmer;
  stigmer.apply({
    owner: { email: "owner@example.com" },
    identity: { oidc: { issuer: "https://issuer.example.com", audience: "https://stigmer.example.com", consoleClientId: "stigmer-console" } },
    enterprise: { license: { name: "stigmer-license", key: "STIGMER_LICENSE_KEY" } },
  });
  const server = await stigmer.waitComponent("server", "refused by its own license check", READY_TIMEOUT_MS, (c) =>
    c.reason === "CrashLooping" && c.message.includes(LICENSE_REFUSAL),
  );
  log(`the server's status relays its refusal: ${server.message}`);
  const images = stigmer.images();
  if (images.server !== `ghcr.io/stigmer/stigmer-server-ee:${SOURCE_TAG}`) throw new Error(`the licensed server runs ${images.server}`);
  if (images.runner !== undefined) throw new Error("the shared runner runs under sign-in with no key");
  const deployment = cluster.kubectlJson(["-n", namespace, "get", "deployment", "stigmer"]);
  if ((deployment.status?.readyReplicas ?? 0) !== 0) throw new Error("the Deployment reports a ready replica with a key no image trusts");
  const runner = stigmer.component("runner");
  if (runner?.reason !== "RunnerKeyPending") throw new Error(`the runner component reads ${runner?.reason}: ${runner?.message}`);
  if (stigmer.read().status.edition !== "enterprise") throw new Error(`the edition reads ${stigmer.read().status.edition}`);
  log(`the Enterprise image at the server's tag, never ready; the runner: ${runner.message}`);
  assertOperatorLogClean();
  stigmer.delete();
  log("=== profile enterprise: PASS ===");
  kubectl(["delete", "namespace", namespace, "--wait=false"]);
}

function kubeconfigArgs() {
  return [...(cluster.kubeconfig === undefined ? [] : ["--kubeconfig", cluster.kubeconfig]), "--context", cluster.context];
}

async function main() {
  const args = parseArgs();
  assertTools();
  await assertPortFree(SERVER_PORT);
  await assertPortFree(ARTIFACT_PORT);
  cluster = createKindCluster({ existing: args.cluster, prefix: "stigmer-operator-smoke", log });
  operator = createOperator(cluster, { log });
  let failed = false;
  const fake = await startFakeModel({ host: "0.0.0.0", mode: args.fakeModel });
  try {
    await cluster.start();
    cluster.loadSourceImages();
    if (args.profiles.includes("enterprise")) cluster.loadEnterpriseSourceImage();
    operator.buildAndLoad();
    operator.install();
    log("the operator is installed and ready");
    const modelBaseUrl = fakeModelEnv(fake, cluster.hostAddress()).ANTHROPIC_BASE_URL;
    log(`the model: the fake at ${modelBaseUrl}, mode ${args.fakeModel}`);
    for (const profile of args.profiles) {
      if (profile === "bundled") await runBundled(fake, modelBaseUrl);
      else if (profile === "byo") await runByo(fake, modelBaseUrl);
      else await runEnterprise(modelBaseUrl);
    }
    log("PASS");
  } catch (error) {
    failed = true;
    console.error(`smoke-operator: FAIL — ${error instanceof Error ? error.message : String(error)}`);
    if (current !== undefined) console.error(current.diagnostics());
  } finally {
    await cluster.stop({ keep: args.keep && !failed });
    await fake.close();
  }
  process.exit(failed ? 1 : 0);
}

await main();
