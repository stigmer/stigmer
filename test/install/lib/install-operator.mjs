/**
 * The Stigmer operator as an install a script can bring up and take down on
 * a kind cluster: the one place that knows how the operator is installed
 * (its chart, deploy/helm/stigmer-operator) and how a Stigmer resource is
 * declared, waited on and read back. Used by test/install/smoke-operator.mjs.
 *
 * Two levels, as in install-helm.mjs:
 *   - the operator ({@link createOperator}): its image built from
 *     deploy/operator for this machine's architecture, loaded into kind,
 *     installed with `helm upgrade --install` into its own namespace (the
 *     upgrade test moves it between two builds stamped as consecutive
 *     versions); its log, read for ERROR lines (a healthy install logs none);
 *   - a Stigmer in a namespace ({@link createStigmer}): `kubectl apply` of
 *     the resource, waits on its Ready condition or on one component's
 *     standing, a port-forward to the server's Service, diagnostics.
 *
 * A source build runs every image at `compose-dev` with pullPolicy Never:
 * the operator is stamped with that version, so it pulls nothing behind the
 * proof's back.
 *
 * Plain node and the helm, kind, kubectl and docker CLIs, no dependencies.
 */

import { execFileSync } from "node:child_process";
import { connect } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { IMAGE_REGISTRY, SOURCE_TAG } from "./kind-cluster.mjs";
import { pollUntil } from "./stigmer-smoke.mjs";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

/** This checkout's operator chart and module. */
export const OPERATOR_CHART = join(repoRoot, "deploy", "helm", "stigmer-operator");
const OPERATOR_MODULE = join(repoRoot, "deploy", "operator");
/** The operator's image as a source build tags it. */
export const OPERATOR_IMAGE = `${IMAGE_REGISTRY}/stigmer-operator:${SOURCE_TAG}`;
/** The namespace and release the operator is installed under. */
export const OPERATOR_NAMESPACE = "stigmer-system";
const OPERATOR_RELEASE = "stigmer-operator";
/** The product's ports, forwarded to the same numbers on this host. */
export const SERVER_PORT = 7234;
export const ARTIFACT_PORT = 7235;

/** The operator: built, loaded and installed on `cluster`. */
export function createOperator(cluster, { log }) {
  return {
    /**
     * Build the operator's image from source, stamped `version` (compose-dev
     * unless the upgrade test stamps two versions of one build), and load it
     * into the node.
     */
    buildAndLoad({ version = SOURCE_TAG } = {}) {
      const image = `${IMAGE_REGISTRY}/stigmer-operator:${version}`;
      log(`docker build ${image} from deploy/operator`);
      execFileSync("docker", ["build", "--build-arg", `STIGMER_VERSION=${version}`, "-t", image, OPERATOR_MODULE], {
        stdio: "inherit",
      });
      cluster.loadImage(image);
    },
    /**
     * `helm upgrade --install` the operator chart at the image stamped `tag`
     * and wait for the operator to be ready: a first install, or the upgrade
     * a platform engineer runs to move to the next release.
     */
    install({ tag = SOURCE_TAG } = {}) {
      cluster.helm(
        [
          "upgrade",
          "--install",
          OPERATOR_RELEASE,
          OPERATOR_CHART,
          "-n",
          OPERATOR_NAMESPACE,
          "--create-namespace",
          "--set",
          `image.tag=${tag}`,
          "--set",
          "image.pullPolicy=Never",
          "--wait",
          "--timeout",
          "3m",
        ],
        { stdio: "inherit" },
      );
    },
    /** The operator's whole log. */
    logs() {
      return cluster.kubectlQuiet(["-n", OPERATOR_NAMESPACE, "logs", `deployment/${OPERATOR_RELEASE}`, "--tail=-1"]).stdout ?? "";
    },
    /** The operator's ERROR lines; a healthy install has none. */
    errorLines() {
      return this.logs()
        .split("\n")
        .filter((line) => /"level":"error"/.test(line) || /\tERROR\t/.test(line));
    },
  };
}

/** One Stigmer resource named `name` in `namespace` of `cluster`. */
export function createStigmer(cluster, { namespace, name = "stigmer", log }) {
  const ref = ["-n", namespace, "stigmer", name];
  const read = () => {
    const got = cluster.kubectlQuiet(["-n", namespace, "get", "stigmer", name, "-o", "json"]);
    return got.status === 0 ? JSON.parse(got.stdout) : undefined;
  };
  const component = (status, componentName) => status?.status?.components?.find((c) => c.name === componentName);
  const readyCondition = (status) => status?.status?.conditions?.find((c) => c.type === "Ready");

  return {
    namespace,
    name,
    /** `kubectl apply` the resource with `spec`. */
    apply(spec) {
      const resource = { apiVersion: "stigmer.ai/v1", kind: "Stigmer", metadata: { name, namespace }, spec };
      cluster.kubectl(["apply", "-f", "-"], { input: JSON.stringify(resource) });
    },
    /** The live resource, or undefined. */
    read,
    /** One component's status entry. */
    component(componentName) {
      return component(read(), componentName);
    },
    /** Wait for Ready=True, logging the Ready message whenever it changes. */
    async waitReady(timeoutMs) {
      let last = "";
      await pollUntil(
        `Stigmer ${namespace}/${name} to be Ready`,
        timeoutMs,
        () => {
          const cond = readyCondition(read());
          const line = `${read()?.status?.phase ?? "-"} · ${cond?.message ?? "no status yet"}`;
          if (line !== last) {
            log(`status: ${line}`);
            last = line;
          }
          return cond?.status === "True";
        },
        { intervalMs: 3000 },
      );
    },
    /** Wait until `predicate(component)` holds for one component, logging its standing as it changes. */
    async waitComponent(componentName, what, timeoutMs, predicate) {
      let last = "";
      await pollUntil(
        `${componentName} to be ${what}`,
        timeoutMs,
        () => {
          const c = component(read(), componentName);
          const line = c === undefined ? "absent" : `${c.phase} ${c.reason}: ${c.message}`;
          if (line !== last) {
            log(`${componentName}: ${line}`);
            last = line;
          }
          return c !== undefined && predicate(c);
        },
        { intervalMs: 3000 },
      );
      return component(read(), componentName);
    },
    /** Delete the resource and wait for it to be gone. */
    delete() {
      cluster.kubectl(["delete", ...ref, "--wait=true", "--timeout=2m"]);
    },
    /**
     * A port-forward to the server's Service on the product's ports;
     * resolves once the port answers, to `{ baseUrl, artifactUrl, stop }`.
     */
    async portForward() {
      const child = cluster.spawnKubectl(
        ["-n", namespace, "port-forward", `svc/${name}`, `${SERVER_PORT}:7234`, `${ARTIFACT_PORT}:7235`],
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
        baseUrl: `http://127.0.0.1:${SERVER_PORT}`,
        artifactUrl: `http://127.0.0.1:${ARTIFACT_PORT}`,
        stop() {
          if (child.exitCode === null) child.kill("SIGTERM");
          return stderr;
        },
      };
    },
    /** The image of each container of the server's Deployment, by container name. */
    images() {
      const deployment = cluster.kubectlJson(["-n", namespace, "get", "deployment", name]);
      return Object.fromEntries(deployment.spec.template.spec.containers.map((c) => [c.name, c.image]));
    },
    diagnostics() {
      const out = [
        `--- the Stigmer ${namespace}/${name} ---`,
        cluster.kubectlQuiet(["-n", namespace, "get", "stigmer", name, "-o", "yaml"]).stdout ?? "",
        "--- kubectl get pods -A ---",
        cluster.kubectlQuiet(["get", "pods", "-A", "-o", "wide"]).stdout ?? "",
        `--- kubectl get events -n ${namespace} ---`,
        cluster.kubectlQuiet(["-n", namespace, "get", "events", "--sort-by=.lastTimestamp"]).stdout ?? "",
        "--- the operator's log ---",
        cluster.kubectlQuiet(["-n", OPERATOR_NAMESPACE, "logs", `deployment/${OPERATOR_RELEASE}`, "--tail=200"]).stdout ?? "",
      ];
      // Any container that restarted, with the log of the run before: a
      // restart elsewhere (Temporal's services) says why only there.
      const pods = cluster.kubectlQuiet(["-n", namespace, "get", "pods", "-o", "json"]);
      if (pods.status === 0) {
        for (const pod of JSON.parse(pods.stdout).items) {
          for (const status of pod.status?.containerStatuses ?? []) {
            if ((status.restartCount ?? 0) === 0) continue;
            const previous = cluster.kubectlQuiet(["-n", namespace, "logs", pod.metadata.name, "-c", status.name, "--previous", "--tail=80"]);
            out.push(`--- logs ${pod.metadata.name}/${status.name} (previous container, ${status.restartCount} restart(s)) ---`, previous.stdout ?? "", previous.stderr ?? "");
          }
        }
      }
      for (const container of ["server", "runner"]) {
        for (const previous of [false, true]) {
          const args = ["-n", namespace, "logs", `deployment/${name}`, "-c", container, "--tail=120"];
          if (previous) args.push("--previous");
          const logs = cluster.kubectlQuiet(args);
          if (previous && logs.status !== 0) continue;
          out.push(`--- logs ${container}${previous ? " (previous container)" : ""} ---`, logs.stdout ?? "", logs.stderr ?? "");
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
    const socket = connect({ host: "127.0.0.1", port: SERVER_PORT, timeout: 1000 });
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
