#!/usr/bin/env node

/**
 * The Stigmer operator's install test: the operator built from source,
 * installed with its chart on a kind cluster this script creates, and one
 * Stigmer resource per profile brought up and proven end to end.
 *
 *   make smoke-operator PROFILE=bundled      (or byo, enterprise, bucket, exposed, agent-sandbox, substrate, upgrade)
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
 * bucket: the bucket stack a platform engineer brings (cert-manager, and an
 *   S3-compatible bucket: SeaweedFS, test/install/lib/object-store.mjs),
 *   then one declaration with spec.objectStore. Ready with zero restarts and
 *   no artifacts volume; the agent run; the runner's artifact lane from
 *   inside the runner's container with the run's own credential (an upload
 *   and a download through short-lived URLs, the object then in the bucket;
 *   another run's key refused 403, no credential 401); a Skill pushed with
 *   the CLI lands under skills/; the database archives (BackupHealthy) with
 *   its schedule; a backup, a moment recorded, a second run, a second
 *   backup; the Stigmer deleted and declared again restoring to that
 *   moment: the first run is there, the second is not, the restored
 *   database archives under a name of its own, and the files are in the
 *   bucket.
 *
 * exposed: what a platform engineer brings to expose Stigmer
 *   (test/install/lib/front-door.mjs: Traefik serving Ingresses and Gateway
 *   API routes on this host's 443, cert-manager with a CA made here, a
 *   Gateway, a mail catcher), then one declaration with spec.ingress for
 *   https://stigmer.localtest.me and the bundled sign-in with sign-up for one
 *   domain. The front door waits for its certificate, naming cert-manager's
 *   reason, while status.url already names the URL; the issuer is created
 *   and it is Ready. Through the front door alone, trusting the CA: the
 *   console's /config.json names the public issuer, native gRPC answers
 *   SERVING, the sign-in answers at /idp, and files are served at
 *   /artifacts. Sign-up is closed. The owner signs in with the one-time
 *   password through the console's own client (PKCE) and the forced
 *   password change, owns the organization, and the one-time password's
 *   Secret is deleted. An agent runs as the owner on the shared runner,
 *   which started signed in. Sign-up opens to the declared domain only: an
 *   address elsewhere is refused, one in the domain registers, verifies by
 *   the mail it receives, and is a member. `stigmer auth login` signs the
 *   owner in through a browser and a colleague in by device code. Then the
 *   front door moves to the Gateway: the Ingresses are gone, and the
 *   console, gRPC and a browser sign-in work through it.
 *
 * agent-sandbox: the bucket stack, then one declaration with per-session
 *   sandboxes on agent-sandbox, a fenced server and the fake model's address
 *   declared as a range sandboxes may reach. The operator installs
 *   agent-sandbox and the sandbox namespace; the install is Ready with no
 *   shared runner. Two sessions run in two Sandboxes. From inside one, the
 *   server, the bucket and the model answer and the database and Temporal
 *   do not. Both sandboxes sleep with their claims kept; the first
 *   session's next message wakes only its sandbox, with the file its first
 *   turn wrote. The database archives through its fence (BackupHealthy).
 *   Deleting the Stigmer leaves the namespace as the bucket
 *   profile's does, and the janitor then removes the sandbox namespace,
 *   agent-sandbox and CloudNativePG, saying so in the operator's log.
 *
 * substrate: a cluster with Kubernetes' pod-certificate APIs and a local
 *   registry, as Agent Substrate's own kind script makes it; the runner
 *   image pushed there and the operator rebuilt pinned to its digest, its
 *   chart told the registry's in-cluster address. The bucket stack, then one
 *   declaration with per-session sandboxes on Agent Substrate, a fenced
 *   server, and the fake model reached by an in-cluster name named as a
 *   sandbox lane. The operator installs Substrate, waits in words for the
 *   pool's first worker and then for the server's sandbox image (the
 *   runner component reads PreparingSandboxImage before Ready), and the
 *   install is Ready with no shared runner. Two sessions run as two actors.
 *   From inside one, by a probe the agent runs, the server, the bucket and
 *   the model answer, and the model under a name that is not a lane, the
 *   database and Temporal do not; the same probe from the server's pod
 *   reaches the database and Temporal, so the probe tells them apart. Both
 *   actors sleep; the first session's next message wakes only its actor,
 *   with the file its first turn wrote. The database archives. Deleting the
 *   Stigmer leaves the namespace as the bucket profile's does, and the
 *   janitor removes the sandbox namespace, Substrate (its namespaces, its
 *   definitions, its trust bundles), the backup plugin and CloudNativePG,
 *   and withdraws the label that admitted the namespace to Substrate's API.
 *
 * upgrade: two builds of this checkout's operator stamped as consecutive
 *   versions (smoke-1, smoke-2), with the source images tagged at both. A
 *   bucket-backed Stigmer under smoke-1 runs an agent; `helm upgrade` moves
 *   the operator to smoke-2; the backup named for smoke-2 completes before
 *   the new server pod starts, status.version reads smoke-2, the server
 *   says what the upgrade did, and the run is still there. It runs last:
 *   it leaves the operator at smoke-2.
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

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHmac, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { LAYER_ENGINES, assertClaudeReady } from "./lib/claude-engine.mjs";
import { FAKE_MODEL_API_KEY, fakeModelEnv, isTitleCall, parseFakeModelArg, startFakeModel } from "./lib/fake-model.mjs";
import { anthropicText, anthropicToolUse } from "../support/src/llm-wire.ts";
import { IMAGE_REGISTRY, LOCAL_REGISTRY, SOURCE_TAG, createKindCluster, substrateKindConfig } from "./lib/kind-cluster.mjs";
import { createObjectStore } from "./lib/object-store.mjs";
import { CA_ISSUER, GATEWAY, HOSTNAME, MAIL, PUBLIC_URL, TRAEFIK_H2C, createFrontDoor, kindConfig } from "./lib/front-door.mjs";
import {
  consoleSignIn,
  createBrowser,
  exchangeCode,
  formsOf,
  grpcHealth,
  pkce,
  request,
  signInAnswers,
  startSignedInProxy,
} from "./lib/front-door-client.mjs";
import { ARTIFACT_PORT, SERVER_PORT, createOperator, createStigmer } from "./lib/install-operator.mjs";
import { createActorReader } from "./lib/substrate.mjs";
import {
  assertArtifactLane,
  assertConsoleServed,
  connectJson,
  createSmokeAgent,
  assertPortFree,
  pollUntil,
  readAgentExecution,
  runAgentToReply,
  sleep,
  waitForServing,
} from "./lib/stigmer-smoke.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
/** In the order they run: upgrade last, since it leaves the operator at its second build. */
const PROFILES = ["bundled", "byo", "enterprise", "bucket", "exposed", "agent-sandbox", "substrate", "upgrade"];
// A first install pulls CloudNativePG and Temporal, creates the database and
// its schema, and waits through the server's startup probe; generous on a
// shared CI host.
const READY_TIMEOUT_MS = 15 * 60_000;
/** Agent Substrate's own install, a worker's gVisor download and the sandbox image's golden snapshot come first. */
const SUBSTRATE_READY_TIMEOUT_MS = 30 * 60_000;
const SERVER_HEALTHY_TIMEOUT_MS = 180_000;
const RUN_COMPLETED_TIMEOUT_MS = 240_000;
const GONE_TIMEOUT_MS = 3 * 60_000;
/** A full backup of a small database to an in-cluster bucket, with margin for a shared CI host. */
const BACKUP_TIMEOUT_MS = 10 * 60_000;
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
let objectStore;
let frontDoor;
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

/**
 * Every container of every long-running pod in the namespace has restarted
 * zero times. A Job's pod is held to its Job instead: retrying is a Job's
 * contract (Temporal's namespace step retries until the frontend accepts
 * it), so its restarts are logged and the Job must have completed.
 */
function assertZeroRestarts(namespace) {
  const pods = cluster.kubectlJson(["-n", namespace, "get", "pods"]).items;
  if (pods.length === 0) throw new Error(`no pods in ${namespace}`);
  for (const job of cluster.kubectlJson(["-n", namespace, "get", "jobs"]).items) {
    const complete = (job.status?.conditions ?? []).some((c) => c.type === "Complete" && c.status === "True");
    if (!complete) throw new Error(`Job ${job.metadata.name} has not completed`);
  }
  for (const pod of pods) {
    const ownedByJob = (pod.metadata.ownerReferences ?? []).some((o) => o.kind === "Job");
    for (const status of [...(pod.status.initContainerStatuses ?? []), ...(pod.status.containerStatuses ?? [])]) {
      if (status.restartCount !== 0 && ownedByJob) {
        log(`${pod.metadata.name}/${status.name} retried ${status.restartCount} time(s); its Job completed`);
        continue;
      }
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

/**
 * The shared probes: SERVING, the console contract, the artifact file server
 * (on a volume; a bucket install has none), an agent run. Resolves the
 * run's execution id.
 */
async function probeStack(stigmer, fake, { bucket = false } = {}) {
  const forward = await stigmer.portForward();
  const { baseUrl } = forward;
  try {
    await waitForServing(baseUrl, SERVER_HEALTHY_TIMEOUT_MS);
    log("health service: SERVING");
    await assertConsoleServed(baseUrl);
    log("console lane: /config.json contract + / html both answer");
    if (bucket) {
      log("files live in the bucket: no artifact file server to probe");
    } else {
      await assertArtifactLane(forward.artifactUrl);
      log("artifact file server: answering through the port-forward");
    }
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

/**
 * A run credential for `executionId`, signed with the install's own runner
 * token key exactly as the server signs the one every dispatch carries
 * (runnerauth.ts): what the runner presents to the artifact lane.
 */
function runCredential(namespace, executionId) {
  const secret = cluster.kubectlJson(["-n", namespace, "get", "secret", "stigmer-keys"]);
  const key = Buffer.from(Buffer.from(secret.data.STIGMER_RUNNER_TOKEN_KEY, "base64").toString("utf8").trim(), "base64");
  const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url");
  const claims = { token_type: "execution_scoped", execution_id: executionId, iat: Math.floor(Date.now() / 1000) };
  const input = `${header}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
  return `${input}.${createHmac("sha256", key).update(input).digest("base64url")}`;
}

/**
 * Run in the runner's container, where a runner calls the lane from: an
 * upload and a download of one key under the run through short-lived URLs,
 * then another run's key and a call with no credential. Prints one JSON line.
 */
const LANE_SCRIPT = `
const [token, run] = process.argv.slice(1);
const base = "http://localhost:7234/v1/proxy/artifacts";
const post = (path, body, bearer = token) => fetch(base + path, {
  method: "POST",
  headers: { "content-type": "application/json", ...(bearer ? { authorization: "Bearer " + bearer } : {}) },
  body: JSON.stringify(body),
});
(async () => {
  const key = "artifacts/" + run + "/smoke/lane.txt";
  const up = await post("/presigned-upload-url", { key, content_type: "text/plain" });
  if (up.status !== 200) throw new Error("upload URL refused: " + up.status);
  const upload = await up.json();
  const put = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: "through the lane" });
  if (!put.ok) throw new Error("the signed PUT failed: " + put.status + " " + (await put.text()));
  const down = await post("/presigned-download-url", { key });
  if (down.status !== 200) throw new Error("download URL refused: " + down.status);
  const got = await (await fetch((await down.json()).url)).text();
  const foreign = await post("/presigned-upload-url", { key: "artifacts/run_notmine/x", content_type: "text/plain" });
  const anonymous = await post("/presigned-download-url", { key }, "");
  console.log(JSON.stringify({ key, got, foreign: foreign.status, anonymous: anonymous.status }));
})().catch((e) => { console.error(e.message); process.exit(1); });
`;

function assertArtifactLaneThroughBucket(namespace, executionId) {
  const out = kubectl(["-n", namespace, "exec", "deployment/stigmer", "-c", "runner", "--", "node", "-e", LANE_SCRIPT, runCredential(namespace, executionId), executionId]);
  const lane = JSON.parse(out.trim().split("\n").pop());
  if (lane.got !== "through the lane") throw new Error(`the download through the lane read ${JSON.stringify(lane.got)}`);
  if (lane.foreign !== 403) throw new Error(`a key under another run answered ${lane.foreign}, want 403`);
  if (lane.anonymous !== 401) throw new Error(`a call with no credential answered ${lane.anonymous}, want 401`);
  const keys = objectStore.listKeys(`artifacts/${executionId}/`);
  if (!keys.includes(lane.key)) throw new Error(`the bucket does not hold ${lane.key}: ${keys.join(", ")}`);
  log(`artifact lane: the runner wrote and read ${lane.key} through short-lived URLs; another run's key 403, no credential 401; the run's folder holds ${keys.length} object(s)`);
}

/** A Skill pushed with the CLI the runner's image carries; its archive must land under skills/. */
function assertSkillInBucket(namespace) {
  const before = objectStore.listKeys("skills/").length;
  const skill = ["---", "name: smoke-skill", "description: A Skill the install test pushes to see it land in the bucket.", "---", "# Smoke"]
    .map((line) => `'${line}'`)
    .join(" ");
  kubectl(["-n", namespace, "exec", "deployment/stigmer", "-c", "runner", "--", "sh", "-c",
    `mkdir -p /tmp/smoke-skill && printf '%s\\n' ${skill} > /tmp/smoke-skill/SKILL.md && stigmer push skill /tmp/smoke-skill`], { stdio: "inherit" });
  const skills = objectStore.listKeys("skills/");
  if (skills.length <= before) throw new Error(`no Skill archive landed under skills/ (${skills.join(", ") || "none"})`);
  log(`skills: the pushed Skill's archive is in the bucket (${skills.length} under skills/)`);
}

/** Wait for BackupHealthy=True: archiving, with a full backup done. Resolves its message. */
async function waitBackupHealthy(stigmer) {
  let last = "";
  return pollUntil("the database's first full backup", BACKUP_TIMEOUT_MS, () => {
    const cond = stigmer.read()?.status?.conditions?.find((c) => c.type === "BackupHealthy");
    const line = cond === undefined ? "no BackupHealthy yet" : `${cond.status} ${cond.reason}: ${cond.message}`;
    if (line !== last) {
      log(`BackupHealthy: ${line}`);
      last = line;
    }
    return cond?.status === "True" ? cond.message : false;
  }, { intervalMs: 5000 });
}

/** Take an on-demand backup of the bundled database and wait for it. Resolves the Backup. */
async function takeBackup(namespace, name) {
  kubectl(["apply", "-f", "-"], {
    input: JSON.stringify({
      apiVersion: "postgresql.cnpg.io/v1",
      kind: "Backup",
      metadata: { name, namespace },
      spec: { cluster: { name: "stigmer-postgres" }, method: "plugin", pluginConfiguration: { name: "barman-cloud.cloudnative-pg.io" } },
    }),
  });
  return waitBackup(namespace, name);
}

async function waitBackup(namespace, name) {
  const backup = await pollUntil(`Backup ${name} to complete`, BACKUP_TIMEOUT_MS, () => {
    const got = cluster.kubectlQuiet(["-n", namespace, "get", "backups.postgresql.cnpg.io", name, "-o", "json"]);
    if (got.status !== 0) return false;
    const b = JSON.parse(got.stdout);
    return b.status?.phase === "completed" || b.status?.phase === "failed" ? b : false;
  }, { intervalMs: 5000 });
  if (backup.status.phase !== "completed") throw new Error(`Backup ${name} failed: ${backup.status.error ?? "no reason given"}`);
  log(`Backup ${name}: completed at ${backup.status.stoppedAt}`);
  return backup;
}

/** A second agent run, through a port-forward. Resolves its execution id. */
async function runAgain(stigmer, fake) {
  const forward = await stigmer.portForward();
  try {
    await waitForServing(forward.baseUrl, SERVER_HEALTHY_TIMEOUT_MS);
    return (await runAgentToReply(forward.baseUrl, RUN_COMPLETED_TIMEOUT_MS, { expectText: fake.replyText, log })).executionId;
  } finally {
    forward.stop();
  }
}

async function runBucket(fake, modelBaseUrl) {
  const namespace = "smoke-bucket";
  log(`=== profile bucket (namespace ${namespace}) ===`);
  objectStore.install();
  prepareNamespace(namespace, modelBaseUrl);
  objectStore.writeCredentials(namespace);
  const stigmer = createStigmer(cluster, { namespace, log });
  current = stigmer;
  const declaration = { owner: { email: "owner@example.com" }, runner: { llm: { secretName: MODEL_SECRET } }, objectStore: objectStore.spec() };
  stigmer.apply(declaration);
  await stigmer.waitReady(READY_TIMEOUT_MS);
  assertZeroRestarts(namespace);
  const claims = cluster.kubectlJson(["-n", namespace, "get", "pvc"]).items.map((c) => c.metadata.name);
  if (claims.includes("stigmer-artifacts")) throw new Error("an install with a bucket has an artifacts volume");
  log(`Ready, every container with zero restarts; claims: ${claims.join(", ")}`);

  const executionId = await probeStack(stigmer, fake, { bucket: true });
  assertArtifactLaneThroughBucket(namespace, executionId);
  assertSkillInBucket(namespace);

  log(`backups: ${await waitBackupHealthy(stigmer)}`);
  const serverName = stigmer.read().status.backup.serverName;
  cluster.kubectl(["-n", namespace, "get", "scheduledbackups.postgresql.cnpg.io", "stigmer-postgres-daily"]);
  const archive = objectStore.listKeys(`postgres/${serverName}/`);
  if (archive.length === 0) throw new Error(`nothing under postgres/${serverName}/ in the bucket`);
  log(`the archive: ${archive.length} object(s) under postgres/${serverName}/; the schedule stigmer-postgres-daily exists`);

  await takeBackup(namespace, "smoke-base");
  await sleep(3000);
  const target = new Date().toISOString();
  log(`the moment to restore to: ${target}`);
  await sleep(3000);
  const second = await runAgain(stigmer, fake);
  log(`a second run after that moment: ${second}`);
  await takeBackup(namespace, "smoke-after");

  log("arm: the Stigmer deleted, then declared again restoring to that moment");
  stigmer.delete();
  const allowed = ["Secret/anthropic", "Secret/bucket", "Secret/stigmer-keys"];
  await pollUntil("everything the Stigmer owned to be removed", GONE_TIMEOUT_MS, () => leftovers(namespace).every((n) => allowed.includes(n)));
  stigmer.apply({ ...declaration, database: { postgresql: { bundled: { recoverFrom: { serverName, targetTime: target } } } } });
  await stigmer.waitReady(READY_TIMEOUT_MS);
  const restored = stigmer.read().status.backup;
  if (restored?.restoredFrom !== serverName) throw new Error(`status.backup.restoredFrom reads ${restored?.restoredFrom}, want ${serverName}`);
  if (restored.serverName === serverName) throw new Error("the restored database archives into the archive it was restored from");
  log(`restored from ${serverName}; now archiving as ${restored.serverName}`);

  const forward = await stigmer.portForward();
  try {
    await waitForServing(forward.baseUrl, SERVER_HEALTHY_TIMEOUT_MS);
    const phase = (await readAgentExecution(forward.baseUrl, executionId)).status?.phase;
    if (phase !== "RUN_COMPLETED") throw new Error(`after the restore, run ${executionId} reads ${phase}, want RUN_COMPLETED`);
    const after = await readAgentExecution(forward.baseUrl, second).then(
      () => "present",
      () => "absent",
    );
    if (after !== "absent") throw new Error(`run ${second}, made after the moment restored to, is present`);
  } finally {
    forward.stop();
  }
  if (!objectStore.listKeys(`artifacts/${executionId}/`).some((k) => k.endsWith("smoke/lane.txt"))) throw new Error("the run's files are gone from the bucket");
  log(`after the restore: run ${executionId} COMPLETED, run ${second} absent, the run's files in the bucket`);
  assertOperatorLogClean();
  stigmer.delete();
  log("=== profile bucket: PASS ===");
  kubectl(["delete", "namespace", namespace, "--wait=false"]);
}

/** What a sandbox's fence lets through, probed from inside one: a TCP connect to each address, three seconds each. */
const FENCE_PROBE = `
const net = require("node:net");
const targets = JSON.parse(process.argv[1]);
Promise.all(targets.map(([name, host, port]) => new Promise((resolve) => {
  const socket = net.connect({ host, port, timeout: 3000 });
  const done = (open) => { socket.destroy(); resolve([name, open]); };
  socket.once("connect", () => done(true));
  socket.once("timeout", () => done(false));
  socket.once("error", () => done(false));
}))).then((results) => console.log(JSON.stringify(Object.fromEntries(results))));
`;

/** The address a kind node resolves `host` to, for a fence that names it by range. */
function hostIPv4(host) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  const resolved = spawnSync("docker", ["exec", `${cluster.name}-control-plane`, "getent", "ahostsv4", host], { encoding: "utf8" });
  const ip = resolved.stdout.trim().split(/\s+/)[0];
  if (resolved.status !== 0 || !/^\d+\.\d+\.\d+\.\d+$/.test(ip ?? "")) throw new Error(`the kind node cannot resolve ${host}`);
  return ip;
}

/** One run in an existing session: the agent runs `command` in its sandbox, then answers `reply`. */
async function runInSession(baseUrl, fake, { orgId, sessionId, agent, command, reply }) {
  const turn = (request) => !isTitleCall(request);
  fake.enqueue({ kind: "anthropic", matches: turn, body: anthropicToolUse(`toolu_${randomUUID().slice(0, 8)}`, "execute", { command }) });
  fake.enqueue({ kind: "anthropic", matches: turn, body: anthropicText(reply) });
  const target = sessionId !== undefined ? { sessionId } : { sessionSpec: { agentRef: { kind: "agent", org: orgId, slug: agent.agentSlug } } };
  const run = await connectJson(baseUrl, "ai.stigmer.agentic.run.v1.RunCommandController/create", {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Run",
    metadata: { name: `smoke-sandbox-${randomUUID().slice(0, 8)}`, org: orgId },
    spec: { ...target, message: "Run the step.", autoApproveAll: true },
  });
  const runId = run.metadata?.id;
  const done = await pollUntil(`run ${runId} RUN_COMPLETED`, RUN_COMPLETED_TIMEOUT_MS, async () => {
    const current = await readAgentExecution(baseUrl, runId);
    const phase = current.status?.phase ?? "";
    if (["RUN_FAILED", "RUN_CANCELLED", "RUN_TERMINATED"].includes(phase)) throw new Error(`run ${runId} reached ${phase}: ${current.status?.error ?? ""}`);
    return phase === "RUN_COMPLETED" ? current : false;
  });
  return { runId, sessionId: done.spec?.sessionId };
}

/** The sandbox pods running now. */
function sandboxPods(sandboxes) {
  return cluster
    .kubectlJson(["-n", sandboxes, "get", "pods"])
    .items.filter((p) => p.metadata.deletionTimestamp === undefined && p.status?.phase === "Running")
    .map((p) => p.metadata.name);
}

async function runAgentSandbox(fake, modelBaseUrl) {
  const namespace = "smoke-agent-sandbox";
  const sandboxes = `${namespace}-sandboxes`;
  log(`=== profile agent-sandbox (namespace ${namespace}, sandboxes in ${sandboxes}) ===`);
  objectStore.install();
  prepareNamespace(namespace, modelBaseUrl);
  objectStore.writeCredentials(namespace);
  const modelIP = hostIPv4(new URL(modelBaseUrl).hostname);
  const stigmer = createStigmer(cluster, { namespace, log });
  current = stigmer;
  stigmer.apply({
    owner: { email: "owner@example.com" },
    runner: { llm: { secretName: MODEL_SECRET } },
    objectStore: objectStore.spec(),
    // The server's own fence too: everything below must still work behind it.
    server: { egress: { fenced: true } },
    sandboxes: { driver: "agentSandbox", idleSeconds: 30, agentSandbox: { egress: { allowCIDRs: [`${modelIP}/32`] } } },
  });
  await stigmer.waitReady(READY_TIMEOUT_MS);
  assertZeroRestarts(namespace);
  if (stigmer.images().runner !== undefined) throw new Error("a per-session install runs a shared runner");
  const runnerStanding = stigmer.component("runner");
  if (runnerStanding?.reason !== "PerSessionSandboxes") throw new Error(`the runner component reads ${runnerStanding?.reason}: ${runnerStanding?.message}`);
  log(`Ready; sandboxes: ${stigmer.component("sandboxes")?.message}`);

  const forward = await stigmer.portForward();
  let first;
  try {
    const { baseUrl } = forward;
    await waitForServing(baseUrl, SERVER_HEALTHY_TIMEOUT_MS);
    const agent = await createSmokeAgent(baseUrl, { log });
    const marker = `slept-and-woke-${randomUUID().slice(0, 8)}`;
    first = await runInSession(baseUrl, fake, { orgId: agent.orgId, agent, command: `echo ${marker} > /workspace/sleep-wake.txt`, reply: "Saved." });
    log(`session one: run ${first.runId} COMPLETED, its file written in its sandbox`);
    const second = await runInSession(baseUrl, fake, { orgId: agent.orgId, agent, command: "true", reply: "Done." });
    log(`session two: run ${second.runId} COMPLETED`);
    const boxes = cluster.kubectlJson(["-n", sandboxes, "get", "sandboxes.agents.x-k8s.io"]).items.map((b) => b.metadata.name);
    if (boxes.length !== 2) throw new Error(`two sessions made ${boxes.length} Sandboxes: ${boxes.join(", ")}`);
    log(`two sessions, two Sandboxes: ${boxes.join(", ")}`);

    log("the fence, probed from inside a sandbox");
    const pod = sandboxPods(sandboxes)[0];
    if (pod === undefined) throw new Error("no sandbox pod is running to probe from");
    const targets = [
      ["server", `stigmer.${namespace}.svc.cluster.local`, 7234],
      ["bucket", "seaweedfs.object-store.svc.cluster.local", 8333],
      ["model", modelIP, Number(new URL(modelBaseUrl).port)],
      ["database", `stigmer-postgres-rw.${namespace}.svc.cluster.local`, 5432],
      ["temporal", `stigmer-temporal-frontend.${namespace}.svc.cluster.local`, 7233],
    ];
    const probe = JSON.parse(kubectl(["-n", sandboxes, "exec", pod, "--", "node", "-e", FENCE_PROBE, JSON.stringify(targets)]).trim().split("\n").pop());
    const want = { server: true, bucket: true, model: true, database: false, temporal: false };
    for (const [name, open] of Object.entries(want)) {
      if (probe[name] !== open) throw new Error(`from a sandbox, ${name} is ${probe[name] ? "reachable" : "unreachable"}; want ${open ? "reachable" : "fenced off"}`);
    }
    log(`from a sandbox: server, bucket and model reachable; database and Temporal fenced off`);

    await pollUntil("both sandboxes to sleep", 5 * 60_000, () => sandboxPods(sandboxes).length === 0);
    const claims = cluster.kubectlJson(["-n", sandboxes, "get", "pvc"]).items.length;
    log(`both sandboxes asleep: no pod running, ${claims} claims kept`);

    await runInSession(baseUrl, fake, { orgId: agent.orgId, sessionId: first.sessionId, command: "cat /workspace/sleep-wake.txt", reply: "Read." });
    const awake = sandboxPods(sandboxes);
    if (awake.length !== 1) throw new Error(`one session's next message woke ${awake.length} sandboxes`);
    const kept = kubectl(["-n", sandboxes, "exec", awake[0], "--", "cat", "/workspace/sleep-wake.txt"]).trim();
    if (kept !== marker) throw new Error(`the woken sandbox's file reads ${JSON.stringify(kept)}, want ${marker}`);
    log(`session one woke with its file: ${kept}`);
  } finally {
    forward.stop();
  }
  // The database archives through its fence, and its first backup is done
  // before the delete: a delete during a running backup waits out
  // CloudNativePG's smart shutdown (180 s) for the backup's session.
  log(`backups behind the database's fence: ${await waitBackupHealthy(stigmer)}`);
  assertOperatorLogClean();

  log("arm: deleting the Stigmer removes the sandboxes and what the operator installed");
  stigmer.delete();
  const allowed = ["Secret/anthropic", "Secret/bucket", "Secret/stigmer-keys"];
  await pollUntil("everything the Stigmer owned to be removed", GONE_TIMEOUT_MS, () => leftovers(namespace).every((n) => allowed.includes(n)));
  const gone = (args) => cluster.kubectlQuiet(args).status !== 0;
  await pollUntil("the janitor to remove the sandbox namespace, agent-sandbox and CloudNativePG", 10 * 60_000, () =>
    gone(["get", "namespace", sandboxes]) &&
    gone(["get", "crd", "sandboxes.agents.x-k8s.io"]) &&
    gone(["get", "namespace", "agent-sandbox-system"]) &&
    gone(["get", "crd", "clusters.postgresql.cnpg.io"]) &&
    gone(["get", "namespace", "cnpg-system"]),
  );
  const said = operator.logs().split("\n").filter((l) => l.includes("cleaned up after the last Stigmer"));
  if (said.length === 0) throw new Error("the janitor said nothing of what it removed");
  log(`the janitor: ${said.pop()}`);
  assertOperatorLogClean();
  log("=== profile agent-sandbox: PASS ===");
  kubectl(["delete", "namespace", namespace, "--wait=false"]);
}

/**
 * What a sandbox lets through, probed by the agent itself (a Substrate actor
 * takes no exec): an HTTP GET to each HTTP target, and for the database and
 * Temporal the first bytes their own protocol answers (Postgres's reply to
 * an SSLRequest, an HTTP/2 SETTINGS frame), so a reply from a gateway in
 * between is never mistaken for theirs. It prints one line, FENCE=<base64
 * JSON>, which the fake model reads back from the tool's output.
 */
const PROTOCOL_PROBE = `
const net = require("node:net"), http = require("node:http");
const targets = JSON.parse(Buffer.from(process.argv[process.argv.length - 1], "base64").toString());
const probe = (t) => new Promise((resolve) => {
  const done = (v) => resolve([t.name, v]);
  if (t.kind === "http") {
    const req = http.get({ host: t.host, port: t.port, path: t.path, timeout: 5000 }, (res) => {
      let body = "";
      res.on("data", (c) => { if (body.length < 400) body += c; });
      res.on("end", () => done({ status: res.statusCode, body: body.slice(0, 400) }));
    });
    req.on("timeout", () => { req.destroy(); done({ error: "timeout" }); });
    req.on("error", (e) => done({ error: String(e.code ?? e.message) }));
    return;
  }
  const s = net.connect({ host: t.host, port: t.port, timeout: 5000 });
  let got = Buffer.alloc(0);
  s.once("connect", () => s.write(t.kind === "postgres" ? Buffer.from([0, 0, 0, 8, 4, 210, 22, 47]) : Buffer.from("PRI * HTTP/2.0\\r\\n\\r\\nSM\\r\\n\\r\\n")));
  s.on("data", (d) => { got = Buffer.concat([got, d]); if (got.length >= 9 || t.kind === "postgres") { s.destroy(); done({ first: got.subarray(0, 16).toString("hex") }); } });
  s.once("timeout", () => { s.destroy(); done({ first: got.toString("hex"), error: "timeout" }); });
  s.once("error", (e) => done({ first: got.toString("hex"), error: String(e.code ?? e.message) }));
  s.once("close", () => done({ first: got.toString("hex") }));
});
Promise.all(targets.map(probe)).then((r) => console.log("FENCE=" + Buffer.from(JSON.stringify(Object.fromEntries(r))).toString("base64")));
`;

/** Whether a probe result is the target's own answer. */
const reached = {
  server: (r) => r.status === 200 && (r.body ?? "").trimStart().startsWith("{"),
  bucket: (r) => (r.body ?? "").includes("<?xml"),
  model: (r) => (r.body ?? "").includes("FakeLlmUpstream"),
  postgres: (r) => r.first === "53" || r.first === "4e",
  temporal: (r) => typeof r.first === "string" && r.first.length >= 18 && r.first.slice(6, 8) === "04",
};

/** The probe's results, from the last FENCE= line any model call carried. */
function fenceResults(fake) {
  for (const body of [...fake.bodies()].reverse()) {
    const m = /FENCE=([A-Za-z0-9+/=]+)/.exec(body);
    if (m !== null) return JSON.parse(Buffer.from(m[1], "base64").toString());
  }
  throw new Error("no model call carried the fence probe's output");
}

/** A selectorless Service in `namespace` named `name`, forwarding `port` to the host at `ip`. */
function hostService(namespace, name, ip, port) {
  kubectl(["apply", "-f", "-"], {
    input: JSON.stringify({
      apiVersion: "v1",
      kind: "List",
      items: [
        { apiVersion: "v1", kind: "Service", metadata: { name, namespace }, spec: { ports: [{ name: "http", port, targetPort: port }] } },
        {
          apiVersion: "discovery.k8s.io/v1",
          kind: "EndpointSlice",
          metadata: { name, namespace, labels: { "kubernetes.io/service-name": name } },
          addressType: "IPv4",
          endpoints: [{ addresses: [ip] }],
          ports: [{ name: "http", port, protocol: "TCP" }],
        },
      ],
    }),
  });
}

async function runSubstrate(fake, modelBaseUrl) {
  const namespace = "smoke-substrate";
  const sandboxes = `${namespace}-sandboxes`;
  const registry = `${LOCAL_REGISTRY.host}/stigmer`;
  log(`=== profile substrate (namespace ${namespace}, workers in ${sandboxes}) ===`);
  const digest = cluster.pushSandboxRunnerImage(registry);
  log(`the runner is ${registry}/runner:${SOURCE_TAG}@${digest}`);
  cluster.loadSourceImagesAs(registry);
  operator.buildAndLoad({ runnerDigest: digest });
  operator.install({ localRegistry: LOCAL_REGISTRY.inCluster, restart: true });
  objectStore.install();

  // The model, by an in-cluster name a Substrate lane can carry (a lane is
  // never an address), and the same fake under a name no lane carries.
  const modelIP = hostIPv4(new URL(modelBaseUrl).hostname);
  const modelPort = Number(new URL(modelBaseUrl).port);
  const modelHost = `fake-model.${namespace}.svc.cluster.local`;
  prepareNamespace(namespace, `http://${modelHost}:${modelPort}`);
  hostService(namespace, "fake-model", modelIP, modelPort);
  hostService(namespace, "fake-model-unlisted", modelIP, modelPort);
  objectStore.writeCredentials(namespace);

  const stigmer = createStigmer(cluster, { namespace, log });
  current = stigmer;
  stigmer.apply({
    owner: { email: "owner@example.com" },
    image: { registry },
    runner: { llm: { secretName: MODEL_SECRET } },
    objectStore: objectStore.spec(),
    // The server's own fence too: it reaches Substrate through it, and the
    // model's host by the range named here.
    server: { egress: { fenced: true, allowCIDRs: [`${modelIP}/32`] } },
    sandboxes: {
      driver: "substrate",
      idleSeconds: 30,
      substrate: { workers: 1, sandbox: { cpuMillicores: 1000, memoryMiB: 1024 }, egress: { http: [`${modelHost}:${modelPort}`] } },
    },
  });
  const seen = new Set();
  await pollUntil(
    `Stigmer ${namespace}/stigmer to be Ready`,
    SUBSTRATE_READY_TIMEOUT_MS,
    () => {
      const now = stigmer.read();
      for (const c of now?.status?.components ?? []) {
        const key = `${c.name}/${c.reason}`;
        if (!seen.has(key)) {
          seen.add(key);
          log(`status: ${c.name} ${c.phase} ${c.reason}: ${c.message}`);
        }
      }
      return now?.status?.conditions?.find((c) => c.type === "Ready")?.status === "True";
    },
    { intervalMs: 2000 },
  );
  for (const want of ["sandboxes/WaitingForWorkers", "runner/PreparingSandboxImage"]) {
    if (!seen.has(want)) throw new Error(`the install reached Ready without saying ${want}`);
  }
  assertZeroRestarts(namespace);
  if (stigmer.images().runner !== undefined) throw new Error("a per-session install runs a shared runner");
  log(`Ready; sandboxes: ${stigmer.component("sandboxes")?.message}`);

  const reader = createActorReader(cluster, { serverNamespace: namespace, serverAccount: "stigmer-server", atespace: "stigmer", log });
  const forward = await stigmer.portForward();
  let first;
  try {
    const { baseUrl } = forward;
    await waitForServing(baseUrl, SERVER_HEALTHY_TIMEOUT_MS);
    const agent = await createSmokeAgent(baseUrl, { log });
    const marker = `slept-and-woke-${randomUUID().slice(0, 8)}`;
    first = await runInSession(baseUrl, fake, { orgId: agent.orgId, agent, command: `echo ${marker} > /workspace/sleep-wake.txt`, reply: "Saved." });
    log(`session one: run ${first.runId} COMPLETED, its file written in its actor`);

    log("the fence, probed by the agent from inside its actor");
    const targets = [
      { name: "server", kind: "http", host: `stigmer.${namespace}.svc.cluster.local`, port: 7234, path: "/config.json" },
      { name: "bucket", kind: "http", host: "seaweedfs.object-store.svc.cluster.local", port: 8333, path: "/" },
      { name: "model", kind: "http", host: modelHost, port: modelPort, path: "/fence-probe" },
      { name: "unlisted", kind: "http", host: `fake-model-unlisted.${namespace}.svc.cluster.local`, port: modelPort, path: "/fence-probe" },
      { name: "database", kind: "postgres", host: `stigmer-postgres-rw.${namespace}.svc.cluster.local`, port: 5432 },
      { name: "temporal", kind: "temporal", host: `stigmer-temporal-frontend.${namespace}.svc.cluster.local`, port: 7233 },
    ];
    const encoded = Buffer.from(JSON.stringify(targets)).toString("base64");
    const script = Buffer.from(PROTOCOL_PROBE).toString("base64");
    const second = await runInSession(baseUrl, fake, {
      orgId: agent.orgId,
      agent,
      command: `echo ${script} | base64 -d > /tmp/probe.js && node /tmp/probe.js ${encoded}`,
      reply: "Probed.",
    });
    log(`session two: run ${second.runId} COMPLETED`);
    const probed = fenceResults(fake);
    const want = { server: true, bucket: true, model: true, unlisted: false, database: false, temporal: false };
    for (const [name, open] of Object.entries(want)) {
      const kind = targets.find((t) => t.name === name).kind;
      const check = kind === "http" ? reached[name === "unlisted" ? "model" : name] : reached[kind];
      const got = check(probed[name] ?? {});
      if (got !== open) throw new Error(`from an actor, ${name} ${got ? "answered" : "did not answer"} (${JSON.stringify(probed[name])}); want ${open ? "an answer" : "it fenced off"}`);
    }
    log("from an actor: server, bucket and model answer; the unlisted name, the database and Temporal do not");
    const serverPod = cluster.kubectlJson(["-n", namespace, "get", "pods", "-l", "app.kubernetes.io/component=server"]).items[0]?.metadata?.name;
    if (serverPod === undefined) throw new Error("no server pod to probe from");
    const control = kubectl(["-n", namespace, "exec", serverPod, "-c", "server", "--", "node", "-e", PROTOCOL_PROBE, Buffer.from(JSON.stringify(targets.slice(4))).toString("base64")]);
    const controlResults = JSON.parse(Buffer.from(/FENCE=([A-Za-z0-9+/=]+)/.exec(control)[1], "base64").toString());
    if (!reached.postgres(controlResults.database) || !reached.temporal(controlResults.temporal)) {
      throw new Error(`from the server's pod the probe did not reach the database and Temporal (${JSON.stringify(controlResults)}), so it cannot tell them fenced off`);
    }
    log("from the server's pod the same probe reaches the database and Temporal");

    const actors = reader.actors();
    if (actors.length !== 2) throw new Error(`two sessions made ${actors.length} actors: ${JSON.stringify(actors)}`);
    log(`two sessions, two actors: ${actors.map((a) => `${a.name} ${a.state}`).join(", ")}`);

    await pollUntil("both actors to sleep", 5 * 60_000, () => reader.actors().every((a) => a.state === "SUSPENDED"), { intervalMs: 5000 });
    log("both actors asleep");

    await runInSession(baseUrl, fake, { orgId: agent.orgId, sessionId: first.sessionId, command: "cat /workspace/sleep-wake.txt", reply: "Read." });
    const awake = reader.actors().filter((a) => a.state === "RUNNING");
    if (awake.length !== 1) throw new Error(`one session's next message woke ${awake.length} actors`);
    if (!fake.bodies().slice(-3).some((b) => b.includes(marker))) throw new Error(`the woken actor's file did not read ${marker}`);
    log(`session one woke with its file: ${marker}`);
  } finally {
    forward.stop();
  }
  log(`backups: ${await waitBackupHealthy(stigmer)}`);
  assertOperatorLogClean();

  log("arm: deleting the Stigmer removes Substrate and what else the operator installed");
  stigmer.delete();
  const allowed = ["Secret/anthropic", "Secret/bucket", "Secret/stigmer-keys", "Service/fake-model", "Service/fake-model-unlisted"];
  await pollUntil("everything the Stigmer owned to be removed", GONE_TIMEOUT_MS, () => leftovers(namespace).every((n) => allowed.includes(n)));
  const gone = (args) => cluster.kubectlQuiet(args).status !== 0;
  await pollUntil("the janitor to remove the sandbox namespace, Substrate and CloudNativePG", 10 * 60_000, () =>
    gone(["get", "namespace", sandboxes]) &&
    gone(["get", "crd", "workerpools.ate.dev"]) &&
    gone(["get", "namespace", "ate-system"]) &&
    gone(["get", "namespace", "podcertificate-controller-system"]) &&
    gone(["get", "clusterrole", "ate-api-server"]) &&
    gone(["get", "crd", "clusters.postgresql.cnpg.io"]) &&
    gone(["get", "namespace", "cnpg-system"]),
  );
  await pollUntil("Substrate's trust bundles to go with their namespaces", 3 * 60_000, () =>
    cluster.kubectlJson(["get", "clustertrustbundles.certificates.k8s.io"]).items.every((b) => !b.metadata.name.includes("ate.dev")),
  );
  const labels = cluster.kubectlJson(["get", "namespace", namespace]).metadata.labels ?? {};
  if (labels["ate.dev/api-access"] !== undefined) throw new Error(`namespace ${namespace} still carries ate.dev/api-access`);
  const said = operator.logs().split("\n").filter((l) => l.includes("cleaned up after the last Stigmer"));
  if (said.length === 0) throw new Error("the janitor said nothing of what it removed");
  log(`the janitor: ${said.pop()}`);
  assertOperatorLogClean();
  log("=== profile substrate: PASS ===");
  kubectl(["delete", "namespace", namespace, "--wait=false"]);
}

const OWNER = "owner@team.test";
const OWNER_PASSWORD = `Owner-${randomBytes(9).toString("base64url")}`;
const COLLEAGUE = "alice@team.test";
const COLLEAGUE_PASSWORD = `Alice-${randomBytes(9).toString("base64url")}`;
const ISSUER = `${PUBLIC_URL}/idp/realms/stigmer`;
const CONSOLE_CLIENT = "stigmer-console";
const cliEntry = join(repoRoot, "client-apps", "cli", "src", "cli", "stigmer.ts");
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");
/** The CLI's device sign-in line (client-apps/cli/src/auth/device.ts), restated: the install layer imports no CLI source. */
const DEVICE_CODE = /To sign in, open (\S+) and enter ([A-Z0-9]{4}-[A-Z0-9]{4})/;

/** The stand-in browser `stigmer auth login` opens: walks the sign-in as the owner, then hands the code to the CLI's loopback callback. */
const CLI_BROWSER = `
import { createBrowser, signInAnswers } from ${JSON.stringify(join(repoRoot, "test", "install", "lib", "front-door-client.mjs"))};
const [url] = process.argv.slice(2);
const browser = createBrowser({ caFile: process.env.NODE_EXTRA_CA_CERTS });
const walked = await browser.walk(url, {
  answers: signInAnswers({ email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD }),
  stopAt: "http://127.0.0.1:",
});
if (walked.redirect === undefined) { console.error("the sign-in ended on a page:", (walked.page ?? "").slice(0, 400)); process.exit(1); }
await fetch(walked.redirect);
`;

/** A one-shot https GET through the front door, trusting the test's CA. */
async function frontDoorGet(caFile, path) {
  return request(`${PUBLIC_URL}${path}`, { ca: readFileSync(caFile) });
}

/** The front door serves the console, gRPC and the sign-in on the one hostname. */
async function assertFrontDoor(caFile, what) {
  const config = JSON.parse((await frontDoorGet(caFile, "/config.json")).body);
  if (config.authMode !== "oidc" || config.oidcIssuer !== ISSUER || config.oidcClientId !== CONSOLE_CLIENT) {
    throw new Error(`${what}: /config.json reads ${JSON.stringify(config)}`);
  }
  const status = await grpcHealth({ origin: PUBLIC_URL, caFile });
  if (status !== 1) throw new Error(`${what}: native gRPC health answered status ${status}, want SERVING`);
  const discovery = JSON.parse((await frontDoorGet(caFile, "/idp/realms/stigmer/.well-known/openid-configuration")).body);
  if (discovery.issuer !== ISSUER) throw new Error(`${what}: the sign-in's discovery names ${discovery.issuer}`);
  log(`${what}: /config.json names ${ISSUER}; native gRPC SERVING; the sign-in answers at /idp`);
}

/** The roles `account` holds on `org`, as the owner reads them. */
async function rolesOf(ownerBase, account, org) {
  const got = await connectJson(ownerBase, "ai.stigmer.iam.grant.v1.GrantQueryController/getPrincipalResourceRoles", {
    principal: { kind: "identity_account", id: account },
    resource: { kind: "organization", id: org },
  });
  return (got.roles ?? []).map((r) => r.code);
}

/** Provision the caller's account on first sign-in; resolves its id. */
async function provision(base) {
  const account = await connectJson(base, "ai.stigmer.iam.identityaccount.v1.IdentityAccountCommandController/provisionMyAccount", {});
  return account.metadata?.id;
}

/** Run the CLI from source in `home`. */
function cli(home, caFile, args, extraEnv = {}) {
  const env = { ...process.env, HOME: home, NODE_EXTRA_CA_CERTS: caFile, ...extraEnv };
  for (const key of ["STIGMER_SERVER_ADDRESS", "STIGMER_API_KEY", "STIGMER_ORG"]) delete env[key];
  const child = spawn(tsxBin, [cliEntry, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (c) => (stdout += c));
  child.stderr.setEncoding("utf8").on("data", (c) => (stderr += c));
  const done = new Promise((resolve) => child.once("close", (status) => resolve({ status, stdout, stderr })));
  return { done, output: () => stdout + stderr, kill: () => child.kill("SIGKILL") };
}

async function cliOk(home, caFile, args, extraEnv) {
  const result = await cli(home, caFile, args, extraEnv).done;
  if (result.status !== 0) throw new Error(`stigmer ${args.join(" ")} exited ${result.status}:\n${result.stdout}\n${result.stderr}`);
  return `${result.stdout}${result.stderr}`;
}

async function cliBrowserSignIn(home, caFile) {
  const script = join(home, "browser.mjs");
  writeFileSync(script, CLI_BROWSER);
  const said = await cliOk(home, caFile, ["auth", "login"], {
    BROWSER: `"${process.execPath}" "${script}"`,
    SMOKE_EMAIL: OWNER,
    SMOKE_PASSWORD: OWNER_PASSWORD,
  });
  if (!said.includes(`Authenticated with ${HOSTNAME}`)) throw new Error(`auth login did not say it authenticated: ${said}`);
  const whoami = await cliOk(home, caFile, ["auth", "whoami"]);
  if (!whoami.includes(OWNER)) throw new Error(`whoami after the browser sign-in: ${whoami}`);
}

async function runExposed(fake, modelBaseUrl) {
  const namespace = "smoke-exposed";
  log(`=== profile exposed (namespace ${namespace}, ${PUBLIC_URL}) ===`);
  frontDoor.install();
  prepareNamespace(namespace, modelBaseUrl);
  const stigmer = createStigmer(cluster, { namespace, log });
  current = stigmer;
  const ingress = { hostname: HOSTNAME, className: "traefik", serviceAnnotations: TRAEFIK_H2C, tls: { issuer: { name: CA_ISSUER, kind: "ClusterIssuer" } } };
  const declaration = {
    owner: { email: OWNER },
    runner: { llm: { secretName: MODEL_SECRET } },
    ingress,
    identity: { bundled: { signUp: { emailDomains: ["team.test"] }, smtp: { host: MAIL.host, port: MAIL.port, from: "stigmer@team.test" } } },
  };
  stigmer.apply(declaration);

  const waiting = await stigmer.waitComponent("frontDoor", "waiting for its certificate", 5 * 60_000, (c) => c.reason === "CertificatePending");
  if (stigmer.read().status.url !== PUBLIC_URL) throw new Error(`status.url reads ${stigmer.read().status.url} while the certificate waits`);
  log(`the front door waits, the URL already published: ${waiting.message}`);
  frontDoor.createIssuer();
  await stigmer.waitReady(READY_TIMEOUT_MS);
  assertZeroRestarts(namespace);
  const ready = stigmer.read().status.conditions.find((c) => c.type === "Ready").message;
  if (!ready.includes("stigmer-owner-setup")) throw new Error(`the Ready sentence does not say where the one-time password is: ${ready}`);
  log(`Ready, every container with zero restarts: ${ready}`);

  const workDir = mkdtempSync(join(tmpdir(), "stigmer-exposed-"));
  const caFile = frontDoor.caFile();
  const mailbox = await frontDoor.mailbox();
  const proxies = [];
  try {
    await assertFrontDoor(caFile, "through the Ingress");
    const files = await frontDoorGet(caFile, "/artifacts/smoke-nonexistent-key");
    if (files.status !== 404 || files.body !== "404 page not found\n") throw new Error(`/artifacts answered ${files.status}: ${files.body.slice(0, 120)}`);
    log("files: /artifacts answers as the server's download lane (an unsigned link is a missing key)");

    const registration = () => {
      const { challenge } = pkce();
      const url = new URL(`${ISSUER}/protocol/openid-connect/registrations`);
      for (const [k, v] of Object.entries({ client_id: CONSOLE_CLIENT, redirect_uri: `${PUBLIC_URL}/auth/callback`, response_type: "code", scope: "openid", code_challenge: challenge, code_challenge_method: "S256" })) url.searchParams.set(k, v);
      return url.toString();
    };
    const closed = await createBrowser({ caFile }).send(registration());
    if (formsOf(closed.body).some((f) => f.id === "kc-register-form")) throw new Error("sign-up is open before the owner signed in");
    log("sign-up is closed before the owner signs in");

    const oneTime = Buffer.from(cluster.kubectlJson(["-n", namespace, "get", "secret", "stigmer-owner-setup"]).data.password, "base64").toString("utf8");
    const ownerTokens = await consoleSignIn(createBrowser({ caFile }), {
      issuer: ISSUER, publicUrl: PUBLIC_URL, clientId: CONSOLE_CLIENT, audience: PUBLIC_URL, caFile,
      answers: signInAnswers({ email: OWNER, password: oneTime, newPassword: OWNER_PASSWORD }),
    });
    const owner = await startSignedInProxy({ target: PUBLIC_URL, token: ownerTokens.access_token, caFile });
    proxies.push(owner);
    const ownerAccount = await provision(owner.baseUrl);
    const org = (await connectJson(owner.baseUrl, "ai.stigmer.tenancy.organization.v1.OrganizationQueryController/listMine", {})).entries?.[0]?.metadata?.id;
    const ownerRoles = await rolesOf(owner.baseUrl, ownerAccount, org);
    if (!ownerRoles.includes("owner")) throw new Error(`the owner holds ${ownerRoles.join(", ")} on the organization`);
    log(`the owner signed in with the one-time password, chose their own, and owns organization ${org}`);
    await pollUntil("the one-time password's Secret to be deleted and sign-up to open", 3 * 60_000, () => {
      const gone = cluster.kubectlQuiet(["-n", namespace, "get", "secret", "stigmer-owner-setup"]).status !== 0;
      return gone && (stigmer.component("identity")?.message ?? "").includes("sign-up is open to addresses at team.test");
    });
    log(`identity: ${stigmer.component("identity").message}`);

    const run = await runAgentToReply(owner.baseUrl, RUN_COMPLETED_TIMEOUT_MS, { expectText: fake.replyText, log });
    const runner = stigmer.component("runner");
    if (!runner.message.includes("signed in as the runner service account")) throw new Error(`the runner: ${runner.message}`);
    const serverLog = kubectl(["-n", namespace, "logs", "deployment/stigmer", "-c", "server", "--tail=-1"]);
    if (!serverLog.includes("the shared runner's key is stored")) throw new Error("the server never stored the runner's key");
    log(`agent run ${run.executionId} COMPLETED as the owner on the shared runner, which started signed in (no key step)`);

    const eve = await createBrowser({ caFile }).walk(registration(), {
      answers: { "kc-register-form": { email: "eve@elsewhere.test", password: COLLEAGUE_PASSWORD, "password-confirm": COLLEAGUE_PASSWORD, firstName: "Eve", lastName: "Else" } },
    });
    if (!(eve.page ?? "").includes("Sign-up is open to addresses at team.test")) throw new Error(`an address elsewhere was not refused:\n${(eve.page ?? "").slice(0, 400)}`);
    log("sign-up refuses eve@elsewhere.test in words");
    const alice = createBrowser({ caFile });
    const { verifier, challenge } = pkce();
    const signUp = new URL(`${ISSUER}/protocol/openid-connect/registrations`);
    for (const [k, v] of Object.entries({ client_id: CONSOLE_CLIENT, redirect_uri: `${PUBLIC_URL}/auth/callback`, response_type: "code", scope: "openid profile email offline_access", code_challenge: challenge, code_challenge_method: "S256", audience: PUBLIC_URL })) signUp.searchParams.set(k, v);
    await alice.walk(signUp.toString(), {
      answers: { "kc-register-form": { email: COLLEAGUE, password: COLLEAGUE_PASSWORD, "password-confirm": COLLEAGUE_PASSWORD, firstName: "Alice", lastName: "Team" } },
      stopAt: `${PUBLIC_URL}/auth/callback`,
    });
    const mail = await mailbox.newestTo(COLLEAGUE);
    const link = /https:\/\/\S+?action-token\S+/.exec(mail)?.[0];
    if (link === undefined) throw new Error(`the verification mail carries no link:\n${mail}`);
    // Keycloak asks a new account for its password once its address is
    // verified, on the page the mail's link leads to.
    const verified = await alice.walk(link.replace(/[)>\]]+$/, ""), {
      answers: { "kc-passwd-update-form": { "password-new": COLLEAGUE_PASSWORD, "password-confirm": COLLEAGUE_PASSWORD } },
      stopAt: `${PUBLIC_URL}/auth/callback`,
    });
    if (verified.redirect === undefined) throw new Error(`following the verification link ended on a page:\n${(verified.page ?? "").slice(0, 400)}`);
    const aliceTokens = await exchangeCode({ issuer: ISSUER, clientId: CONSOLE_CLIENT, redirect: `${PUBLIC_URL}/auth/callback`, verifier, code: new URL(verified.redirect).searchParams.get("code"), caFile });
    const colleague = await startSignedInProxy({ target: PUBLIC_URL, token: aliceTokens.access_token, caFile });
    proxies.push(colleague);
    const aliceAccount = await provision(colleague.baseUrl);
    const aliceRoles = await rolesOf(owner.baseUrl, aliceAccount, org);
    if (!aliceRoles.includes("member") || aliceRoles.includes("admin") || aliceRoles.includes("owner")) throw new Error(`the colleague holds ${aliceRoles.join(", ")}`);
    log(`${COLLEAGUE} signed up, verified by mail, and is a member`);

    const home = mkdtempSync(join(tmpdir(), "stigmer-exposed-cli-"));
    await cliOk(home, caFile, ["config", "backend", "add", "smoke", "--endpoint", `${HOSTNAME}:443`]);
    await cliOk(home, caFile, ["config", "backend", "use", "smoke"]);
    await cliBrowserSignIn(home, caFile);
    log("stigmer auth login: the owner signed in through the browser");
    await cliOk(home, caFile, ["auth", "logout"]);
    const device = cli(home, caFile, ["auth", "login", "--device"]);
    const code = await pollUntil("the CLI's device code", 60_000, () => DEVICE_CODE.exec(device.output()) ?? false);
    const approved = await createBrowser({ caFile }).walk(`${code[1]}?user_code=${code[2]}`, {
      answers: signInAnswers({ email: COLLEAGUE, password: COLLEAGUE_PASSWORD }),
    });
    const deviceResult = await device.done;
    if (deviceResult.status !== 0) throw new Error(`auth login --device exited ${deviceResult.status}:\n${deviceResult.stderr}\npage:\n${(approved.page ?? "").slice(0, 300)}`);
    const whoami = await cliOk(home, caFile, ["auth", "whoami"]);
    if (!whoami.includes(COLLEAGUE)) throw new Error(`whoami after the device sign-in: ${whoami}`);
    log(`stigmer auth login --device: ${COLLEAGUE} approved code ${code[2]} at ${code[1]}`);

    log("arm: the front door moves to the Gateway");
    await frontDoor.waitGateway();
    stigmer.apply({ ...declaration, ingress: { hostname: HOSTNAME, serviceAnnotations: TRAEFIK_H2C, gatewayRef: GATEWAY } });
    const routed = await stigmer.waitComponent("frontDoor", "Ready through the Gateway", 5 * 60_000, (c) => c.phase === "Ready" && c.message.includes("through Gateway"));
    const ingresses = cluster.kubectlJson(["-n", namespace, "get", "ingresses"]).items;
    if (ingresses.length !== 0) throw new Error(`Ingresses outlived the move to the Gateway: ${ingresses.map((i) => i.metadata.name)}`);
    log(`frontDoor: ${routed.message}`);
    await stigmer.waitReady(READY_TIMEOUT_MS);
    await assertFrontDoor(caFile, "through the Gateway");
    await cliOk(home, caFile, ["auth", "logout"]);
    await cliBrowserSignIn(home, caFile);
    log("stigmer auth login through the Gateway: the owner signed in again");
    rmSync(home, { recursive: true, force: true });
  } finally {
    for (const p of proxies) await p.stop();
    mailbox.stop();
    rmSync(workDir, { recursive: true, force: true });
  }

  assertZeroRestarts(namespace);
  assertOperatorLogClean();
  stigmer.delete();
  // cert-manager keeps the certificate it issued after its Certificate is
  // gone (its default), so a new declaration of the hostname reuses it.
  const allowed = ["Secret/anthropic", "Secret/stigmer-keys", "Secret/stigmer-tls"];
  await pollUntil("everything the Stigmer owned to be removed", GONE_TIMEOUT_MS, () => leftovers(namespace).every((n) => allowed.includes(n))).catch((error) => {
    throw new Error(`${error.message}; left: ${leftovers(namespace).filter((n) => !allowed.includes(n)).join(", ")}`);
  });
  log(`left in ${namespace}: ${leftovers(namespace).join(", ")}`);
  log("=== profile exposed: PASS ===");
  kubectl(["delete", "namespace", namespace, "--wait=false"]);
}

/** The source images tagged as `version` and loaded, as a release of that version would publish them. */
function tagSourceImages(version) {
  for (const image of ["stigmer-server", "stigmer-runner"]) {
    const tagged = `${IMAGE_REGISTRY}/${image}:${version}`;
    spawnSync("docker", ["tag", `${IMAGE_REGISTRY}/${image}:${SOURCE_TAG}`, tagged], { stdio: "inherit" });
    cluster.loadImage(tagged);
  }
}

async function runUpgrade(fake, modelBaseUrl) {
  const namespace = "smoke-upgrade";
  log(`=== profile upgrade (namespace ${namespace}) ===`);
  objectStore.install();
  for (const version of ["smoke-1", "smoke-2"]) {
    tagSourceImages(version);
    operator.buildAndLoad({ version });
  }
  operator.install({ tag: "smoke-1" });
  log("the operator runs smoke-1");
  prepareNamespace(namespace, modelBaseUrl);
  objectStore.writeCredentials(namespace);
  const stigmer = createStigmer(cluster, { namespace, log });
  current = stigmer;
  stigmer.apply({ owner: { email: "owner@example.com" }, runner: { llm: { secretName: MODEL_SECRET } }, objectStore: objectStore.spec() });
  await stigmer.waitReady(READY_TIMEOUT_MS);
  await pollUntil("status.version to read smoke-1", 60_000, () => stigmer.read()?.status?.version === "smoke-1");
  const executionId = await probeStack(stigmer, fake, { bucket: true });
  log(`backups: ${await waitBackupHealthy(stigmer)}`);

  log("helm upgrade: the operator to smoke-2");
  operator.install({ tag: "smoke-2" });
  const backup = await waitBackup(namespace, "stigmer-before-smoke-2");
  await pollUntil("the server to roll to smoke-2", READY_TIMEOUT_MS, () => stigmer.images().server.endsWith(":smoke-2"));
  await stigmer.waitReady(READY_TIMEOUT_MS);
  await pollUntil("status.version to read smoke-2", 120_000, () => stigmer.read()?.status?.version === "smoke-2");
  const pods = cluster.kubectlJson(["-n", namespace, "get", "pods", "-l", "app.kubernetes.io/component=server,app.kubernetes.io/instance=stigmer"]).items;
  const started = new Date(pods[0].metadata.creationTimestamp);
  if (started < new Date(backup.status.stoppedAt)) {
    throw new Error(`the server at smoke-2 started at ${started.toISOString()}, before its backup finished at ${backup.status.stoppedAt}`);
  }
  const annotations = cluster.kubectlJson(["-n", namespace, "get", "deployment", "stigmer"]).metadata.annotations ?? {};
  if (annotations["stigmer.ai/upgraded-from"] !== "smoke-1" || annotations["stigmer.ai/upgrade-backup"] !== "stigmer-before-smoke-2") {
    throw new Error(`the server's Deployment does not record the upgrade: ${JSON.stringify(annotations)}`);
  }
  const server = stigmer.component("server");
  if (!server.message.includes("upgraded from smoke-1 after backup stigmer-before-smoke-2")) throw new Error(`the server does not say what the upgrade did: ${server.message}`);
  log(`the server rolled after its backup (backup done ${backup.status.stoppedAt}, pod ${started.toISOString()}): ${server.message}`);
  await assertExecutionSurvived(stigmer, executionId, "the upgrade");
  assertZeroRestarts(namespace);
  assertOperatorLogClean();
  stigmer.delete();
  log("=== profile upgrade: PASS ===");
  kubectl(["delete", "namespace", namespace, "--wait=false"]);
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
  if (images.runner !== undefined) throw new Error("a licensed install runs a shared runner");
  const deployment = cluster.kubectlJson(["-n", namespace, "get", "deployment", "stigmer"]);
  if ((deployment.status?.readyReplicas ?? 0) !== 0) throw new Error("the Deployment reports a ready replica with a key no image trusts");
  // The runner waits for the server before it says anything of its own;
  // the server never becomes ready here, so it is Pending on it.
  const runner = stigmer.component("runner");
  if (runner?.phase !== "Pending") throw new Error(`the runner component reads ${runner?.phase} ${runner?.reason}: ${runner?.message}`);
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
  if (args.profiles.includes("exposed")) await assertPortFree(443);
  let config = args.profiles.includes("exposed") ? kindConfig() : undefined;
  if (args.profiles.includes("substrate")) config = substrateKindConfig(config);
  cluster = createKindCluster({ existing: args.cluster, prefix: "stigmer-operator-smoke", log, config });
  operator = createOperator(cluster, { log });
  objectStore = createObjectStore(cluster, { log });
  frontDoor = createFrontDoor(cluster, { log, workDir: mkdtempSync(join(tmpdir(), "stigmer-front-door-")) });
  let failed = false;
  const fake = await startFakeModel({ host: "0.0.0.0", mode: args.fakeModel });
  try {
    await cluster.start();
    if (args.profiles.includes("substrate")) cluster.prepareForSubstrate();
    cluster.loadSourceImages();
    if (args.profiles.includes("enterprise")) cluster.loadEnterpriseSourceImage();
    if (args.profiles.includes("agent-sandbox")) cluster.loadSandboxRunnerImage();
    operator.buildAndLoad();
    operator.install();
    log("the operator is installed and ready");
    const modelBaseUrl = fakeModelEnv(fake, cluster.hostAddress()).ANTHROPIC_BASE_URL;
    log(`the model: the fake at ${modelBaseUrl}, mode ${args.fakeModel}`);
    for (const profile of PROFILES.filter((p) => args.profiles.includes(p))) {
      if (profile === "bundled") await runBundled(fake, modelBaseUrl);
      else if (profile === "byo") await runByo(fake, modelBaseUrl);
      else if (profile === "enterprise") await runEnterprise(modelBaseUrl);
      else if (profile === "bucket") await runBucket(fake, modelBaseUrl);
      else if (profile === "exposed") await runExposed(fake, modelBaseUrl);
      else if (profile === "agent-sandbox") await runAgentSandbox(fake, modelBaseUrl);
      else if (profile === "substrate") await runSubstrate(fake, modelBaseUrl);
      else await runUpgrade(fake, modelBaseUrl);
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
