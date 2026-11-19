/**
 * The Helm chart (deploy/helm/stigmer) as an install a script can bring up,
 * move to another release, and take down, on a kind cluster: the one place
 * that knows how a release of the chart is installed, shared by its smoke
 * (test/install/smoke-helm.mjs) and the upgrade rehearsal
 * (test/install/rehearse-upgrade.mjs).
 *
 * Two levels, because the smoke runs several releases on one cluster:
 *   - the cluster (createKindCluster, from kind-cluster.mjs): created (or an
 *     existing one named), the host address a pod reaches this machine by,
 *     images loaded;
 *   - a release in a namespace ({@link createStigmerRelease}): its Secrets,
 *     `helm install` / `helm upgrade` / `helm uninstall`, a port-forward to
 *     the product's ports, the images it runs, its diagnostics.
 *
 * The caller's kubeconfig is never changed (kind-cluster.mjs says how).
 *
 * A release is configured the way the chart's README tells a user to: the
 * chart's Secret by secrets.existingSecret, the model's key by
 * runner.llm.existingSecret, its address by runner.extraEnv. An upgrade is
 * the guide's: `helm upgrade` to the target chart with the same values,
 * --wait, then a new port-forward.
 *
 * Plain node and the helm, kind, kubectl and docker CLIs, no dependencies.
 */

import { randomBytes } from "node:crypto";
import { connect } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FAKE_MODEL_API_KEY } from "./fake-model.mjs";
import { SOURCE_TAG } from "./kind-cluster.mjs";
import { pollUntil } from "./stigmer-smoke.mjs";

// The cluster lifecycle is shared with the operator's install test.
export { createKindCluster } from "./kind-cluster.mjs";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

/** This checkout's chart. */
export const CHECKOUT_CHART = join(repoRoot, "deploy", "helm", "stigmer");
/** Where every release of the chart is published: what a user installs. */
export const PUBLISHED_CHART = "oci://ghcr.io/stigmer/charts/stigmer";
/** The release name the guide uses. */
export const RELEASE = "stigmer";
/** The product's ports, forwarded to the same numbers on this host. */
export const HELM_SERVER_PORT = 7234;
export const HELM_ARTIFACT_PORT = 7235;

/** The Secret each release's namespace carries for runner.llm.existingSecret. */
const LLM_SECRET = "stigmer-smoke-llm";
// First install pulls or loads two large images, starts Postgres, lets
// the Temporal pod create its schema and namespace, and waits through the
// server's startup probe; generous on shared CI hosts.
const INSTALL_TIMEOUT = "12m";

/** The values file of one of the chart's CI profiles (ci/values-<profile>.yaml). */
export function profileValues(profile) {
  return join(CHECKOUT_CHART, "ci", `values-${profile}.yaml`);
}

/**
 * The chart and image settings a release is installed from:
 *   - a source build: this checkout's chart (or `chart`), the source images
 *     loaded into kind, pullPolicy Never, so nothing is pulled behind the
 *     proof's back;
 *   - a published release as a user installs it: the published chart at
 *     that version, whose image tags default to v<appVersion>;
 *   - `chart` given: that chart (a directory or a packaged .tgz) with the
 *     published images at the release's tag, the release lane's check of a
 *     chart before it is pushed.
 */
export function chartFor(release, { chart } = {}) {
  if (release.kind === "build") return { chart: chart ?? CHECKOUT_CHART, imageTag: SOURCE_TAG, pullNever: true };
  if (chart !== undefined) return { chart, imageTag: `v${release.version}` };
  return { chart: PUBLISHED_CHART, version: release.version };
}

/**
 * One release of the chart in `namespace` of `cluster`, configured with
 * `valuesFile` and a model at `modelBaseUrl`. `postgresPassword` is the
 * database password its Secret carries (shared with a bring-your-own
 * Postgres when the profile has one). `extraSets` are `--set` values every
 * install and upgrade of the release carries (a fenced smoke's).
 */
export function createStigmerRelease(cluster, { namespace, valuesFile, modelBaseUrl, postgresPassword, extraSets = [], log }) {
  let installedFrom;

  const helmArgs = (verb, spec, { wait = true } = {}) => {
    const args = [verb, RELEASE, spec.chart];
    if (spec.version !== undefined) args.push("--version", spec.version);
    args.push("-n", namespace, "-f", valuesFile);
    if (wait) args.push("--wait", "--timeout", INSTALL_TIMEOUT);
    args.push(
      // The model, as a user configures it: the key from a Secret, the address
      // as an extra runner env var (the chart has no dedicated value for it).
      "--set",
      `runner.llm.existingSecret=${LLM_SECRET}`,
      "--set",
      "runner.extraEnv[0].name=ANTHROPIC_BASE_URL",
      "--set",
      `runner.extraEnv[0].value=${modelBaseUrl}`,
    );
    if (spec.imageTag !== undefined) {
      args.push("--set", `image.server.tag=${spec.imageTag}`, "--set", `image.runner.tag=${spec.imageTag}`);
    }
    if (spec.pullNever === true) args.push("--set", "image.pullPolicy=Never");
    for (const set of extraSets) args.push("--set", set);
    return args;
  };

  return {
    namespace,
    /** The chart spec the release was last installed or upgraded from. */
    get installedFrom() {
      return installedFrom;
    },
    /** The namespace, the chart's Secret with fresh keys, and the model's key Secret. */
    createSecrets() {
      cluster.kubectl(["create", "namespace", namespace]);
      cluster.kubectl([
        "-n",
        namespace,
        "create",
        "secret",
        "generic",
        "stigmer-secrets",
        `--from-literal=STIGMER_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`,
        `--from-literal=STIGMER_RUNNER_TOKEN_KEY=${randomBytes(32).toString("base64")}`,
        `--from-literal=POSTGRES_PASSWORD=${postgresPassword}`,
      ]);
      cluster.kubectl([
        "-n",
        namespace,
        "create",
        "secret",
        "generic",
        LLM_SECRET,
        `--from-literal=ANTHROPIC_API_KEY=${FAKE_MODEL_API_KEY}`,
      ]);
    },
    /** `helm install`; `wait: false` returns once the objects exist, for a release that is never meant to become ready. */
    async install(spec, { wait = true } = {}) {
      cluster.helm(helmArgs("install", spec, { wait }), { stdio: "inherit" });
      installedFrom = spec;
    },
    /** `helm upgrade` to `spec` with the same values and --wait (the guide's upgrade). */
    async upgrade(spec) {
      cluster.helm(helmArgs("upgrade", spec), { stdio: "inherit" });
      installedFrom = spec;
    },
    async uninstall() {
      cluster.helm(["uninstall", RELEASE, "-n", namespace, "--wait"], { stdio: "inherit" });
    },
    /**
     * A port-forward to the release's Service on the product's ports;
     * resolves once the port answers, to `{ baseUrl, artifactUrl, stop }`.
     */
    async portForward() {
      const child = cluster.spawnKubectl(
        ["-n", namespace, "port-forward", `svc/${RELEASE}`, `${HELM_SERVER_PORT}:7234`, `${HELM_ARTIFACT_PORT}:7235`],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      try {
        await pollUntil("port-forward to answer", 60_000, () => portAnswers(child), { intervalMs: 500 });
      } catch (error) {
        if (child.exitCode === null) child.kill("SIGTERM");
        throw new Error(`${error instanceof Error ? error.message : String(error)}; kubectl: ${stderr.trim()}`);
      }
      return {
        baseUrl: `http://127.0.0.1:${HELM_SERVER_PORT}`,
        artifactUrl: `http://127.0.0.1:${HELM_ARTIFACT_PORT}`,
        stop() {
          if (child.exitCode === null) child.kill("SIGTERM");
          return stderr;
        },
      };
    },
    /** The image of each container of the stigmer Deployment, by container name. */
    async images() {
      const deployment = cluster.kubectlJson(["-n", namespace, "get", "deployment", RELEASE]);
      return Object.fromEntries(deployment.spec.template.spec.containers.map((container) => [container.name, container.image]));
    },
    diagnostics() {
      const out = [
        "--- kubectl get pods -A ---",
        cluster.kubectlQuiet(["get", "pods", "-A", "-o", "wide"]).stdout ?? "",
        `--- kubectl get events -n ${namespace} ---`,
        cluster.kubectlQuiet(["-n", namespace, "get", "events", "--sort-by=.lastTimestamp"]).stdout ?? "",
      ];
      // Every component's current logs, and the previous container's where one
      // restarted: a crash that healed before the dump is otherwise invisible.
      const targets = [
        ["stigmer", "wait-for-dependencies"],
        ["stigmer", "server"],
        ["stigmer", "runner"],
        ["temporal", "wait-for-postgres"],
        ["temporal", "temporal-schema"],
        ["temporal", "temporal"],
        ["temporal", "temporal-namespace"],
        ["postgres", "postgres"],
      ];
      for (const [component, container] of targets) {
        for (const previous of [false, true]) {
          const args = ["-n", namespace, "logs", "-l", `app.kubernetes.io/component=${component}`, "-c", container, "--tail=120"];
          if (previous) args.push("--previous");
          const logs = cluster.kubectlQuiet(args);
          if (previous && logs.status !== 0) continue; // no previous container: nothing restarted
          out.push(`--- logs ${component}/${container}${previous ? " (previous container)" : ""} ---`, logs.stdout ?? "");
          if (!previous) out.push(logs.stderr ?? "");
        }
      }
      return out.join("\n");
    },
  };
}

/** One connect attempt to the forwarded server port; false while kubectl is still binding. */
function portAnswers(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) resolve(false);
    const socket = connect({ host: "127.0.0.1", port: HELM_SERVER_PORT, timeout: 1000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

