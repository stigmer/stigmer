/**
 * A kind cluster an install test drives: created for the run (or an existing
 * one named), the address a pod reaches this machine by, and the images the
 * test built loaded into its node. Shared by the Helm chart's smoke and
 * upgrade rehearsal (install-helm.mjs) and the operator's install test
 * (install-operator.mjs), so the one place that knows how a test cluster is
 * made is this one.
 *
 * The caller's kubeconfig is never changed. A cluster this module creates
 * gets a kubeconfig file of its own, and every kind, kubectl and helm call
 * names --kubeconfig and the context explicitly; an existing cluster
 * (--cluster) is addressed in the caller's kubeconfig by --context alone.
 * Nothing runs `kubectl config use-context`, which would leave a developer's
 * kubectl with no current context (#1561).
 *
 * Plain node and the kind, kubectl, helm and docker CLIs, no dependencies.
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildSourceImages } from "./install-compose.mjs";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

/** The repositories Stigmer's images are published under; a source build is tagged under them. */
export const IMAGE_REGISTRY = "ghcr.io/stigmer";
/** The tag a source build carries. */
export const SOURCE_TAG = "compose-dev";
/** The tag the Enterprise image smoke builds its local image under (ee/server/scripts/smoke-image.mjs, LOCAL_TAG). */
const ENTERPRISE_LOCAL_TAG = "stigmer-server-ee:smoke-local";

/**
 * A kind cluster: `existing` names one the caller owns (left as found);
 * otherwise one is created on `start` and deleted on `stop`.
 */
export function createKindCluster({ existing = "", prefix = "stigmer-helm-smoke", log }) {
  const own = existing === "";
  const name = own ? `${prefix}-${Date.now()}` : existing;
  const workDir = mkdtempSync(join(tmpdir(), "stigmer-kind-"));
  const kubeconfig = own ? join(workDir, "kubeconfig") : undefined;
  const context = `kind-${name}`;
  const kubeconfigFlag = kubeconfig === undefined ? [] : ["--kubeconfig", kubeconfig];
  const run = (command, args, options = {}) =>
    execFileSync(command, args, { cwd: repoRoot, encoding: "utf8", ...options });

  const cluster = {
    name,
    own,
    kubeconfig,
    context,
    async start() {
      if (!own) return;
      log(`kind create cluster ${name}`);
      run("kind", ["create", "cluster", "--name", name, ...kubeconfigFlag, "--wait", "120s"], { stdio: "inherit" });
    },
    kubectl: (args, options = {}) => run("kubectl", [...kubeconfigFlag, "--context", context, ...args], options),
    kubectlJson: (args) => JSON.parse(cluster.kubectl([...args, "-o", "json"])),
    /** A kubectl that runs in the background (a port-forward); the caller ends it. */
    spawnKubectl: (args, options = {}) => spawn("kubectl", [...kubeconfigFlag, "--context", context, ...args], options),
    /** kubectl without throwing, for diagnostics. */
    kubectlQuiet: (args) => spawnSync("kubectl", [...kubeconfigFlag, "--context", context, ...args], { encoding: "utf8" }),
    helm: (args, options = {}) => run("helm", [...kubeconfigFlag, "--kube-context", context, ...args], options),
    /**
     * The name a pod on this cluster reaches the host by. Docker Desktop
     * resolves host.docker.internal inside the node (and so, through
     * CoreDNS, in every pod) and does not route the kind network's gateway to
     * the host; Linux Docker does the reverse. The node's own resolver decides.
     */
    hostAddress() {
      const resolved = spawnSync(
        "docker",
        ["exec", `${name}-control-plane`, "getent", "hosts", "host.docker.internal"],
        { encoding: "utf8" },
      );
      if (resolved.status === 0 && resolved.stdout.trim() !== "") return "host.docker.internal";
      const gateways = run("docker", ["network", "inspect", "kind", "--format", "{{range .IPAM.Config}}{{.Gateway}} {{end}}"])
        .trim()
        .split(/\s+/)
        .filter((gateway) => /^\d+\.\d+\.\d+\.\d+$/.test(gateway));
      if (gateways.length === 0) {
        throw new Error("no way to reach the host from kind: host.docker.internal does not resolve and the kind network has no IPv4 gateway");
      }
      return gateways[0];
    },
    /**
     * The host address as a CIDR of one address, for a fenced release's
     * egressPolicy.allowedCidrs: the fake model listens on this host, which a
     * pod reaches on a private address (Docker Desktop's host.docker.internal,
     * or the kind network's gateway).
     */
    hostCidr() {
      const host = cluster.hostAddress();
      let address = host;
      if (!/^[0-9.]+$/.test(host) && !host.includes(":")) {
        const resolved = run("docker", ["exec", `${name}-control-plane`, "getent", "ahostsv4", host]).trim();
        address = resolved.split(/\s+/)[0];
      }
      return address.includes(":") ? `${address}/128` : `${address}/32`;
    },
    /** Load a local image into the node. */
    loadImage(tagged) {
      log(`kind load docker-image ${tagged}`);
      run("kind", ["load", "docker-image", tagged, "--name", name], { stdio: "inherit" });
    },
    /**
     * Both images built from source (compose's build, install-compose.mjs),
     * tagged as the chart's repositories at `compose-dev`, and loaded into
     * the node.
     */
    loadSourceImages() {
      const built = buildSourceImages({ log });
      for (const [local, repository] of [
        [built.server, "stigmer-server"],
        [built.runner, "stigmer-runner"],
      ]) {
        const tagged = `${IMAGE_REGISTRY}/${repository}:${SOURCE_TAG}`;
        run("docker", ["tag", local, tagged]);
        log(`kind load docker-image ${tagged}`);
        run("kind", ["load", "docker-image", tagged, "--name", name], { stdio: "inherit" });
      }
    },
    /**
     * The Stigmer Enterprise image built from source by its own smoke's
     * build (`make bundle-ee-slim` first, for ee/server/dist-slim), tagged
     * as the chart's enterprise repository at `compose-dev`, and loaded.
     */
    loadEnterpriseSourceImage() {
      log("building stigmer-server-ee through its image smoke (--build-only)");
      run(process.execPath, [join(repoRoot, "ee", "server", "scripts", "smoke-image.mjs"), "--build-only"], { stdio: "inherit" });
      const tagged = `${IMAGE_REGISTRY}/stigmer-server-ee:${SOURCE_TAG}`;
      run("docker", ["tag", ENTERPRISE_LOCAL_TAG, tagged]);
      log(`kind load docker-image ${tagged}`);
      run("kind", ["load", "docker-image", tagged, "--name", name], { stdio: "inherit" });
    },
    /** Delete a cluster this module created (unless `keep`); an existing one is left. */
    async stop({ keep = false } = {}) {
      if (own && keep) log(`--keep: cluster ${name} left running (kubeconfig ${kubeconfig})`);
      if (own && !keep) {
        spawnSync("kind", ["delete", "cluster", "--name", name, ...kubeconfigFlag], { stdio: "inherit" });
        rmSync(workDir, { recursive: true, force: true });
      }
    },
  };
  return cluster;
}
