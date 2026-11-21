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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
 * A local registry on this host for a cluster whose node agent pulls images
 * itself (Agent Substrate's atelet): pushed to at `localhost:5001`, reached
 * from the cluster at `kind-registry:5000`, the names kind's own guide and
 * Agent Substrate's kind script use.
 */
export const LOCAL_REGISTRY = { container: "kind-registry", host: "localhost:5001", inCluster: "kind-registry:5000" };

/**
 * What Agent Substrate needs of a kind cluster, as its own kind script sets
 * it: the pod-certificate and trust-bundle APIs, and parallel image pulls.
 * Merged into any other configuration a run needs (a port mapping).
 */
export function substrateKindConfig(base = { kind: "Cluster", apiVersion: "kind.x-k8s.io/v1alpha4", nodes: [{ role: "control-plane" }] }) {
  return {
    ...base,
    featureGates: { ...(base.featureGates ?? {}), ClusterTrustBundle: true, ClusterTrustBundleProjection: true, PodCertificateRequest: true },
    runtimeConfig: { ...(base.runtimeConfig ?? {}), "certificates.k8s.io/v1beta1": "true" },
    kubeadmConfigPatches: [...(base.kubeadmConfigPatches ?? []), "kind: KubeletConfiguration\nserializeImagePulls: false\nmaxParallelImagePulls: 4\n"],
  };
}

/**
 * A kind cluster: `existing` names one the caller owns (left as found);
 * otherwise one is created on `start` and deleted on `stop`.
 */
export function createKindCluster({ existing = "", prefix = "stigmer-helm-smoke", log, config }) {
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
      // `config` is a kind cluster configuration (an object), for a test that
      // maps a node port to the host.
      const configFlag = [];
      if (config !== undefined) {
        const file = join(workDir, "kind.json");
        writeFileSync(file, JSON.stringify(config));
        configFlag.push("--config", file);
      }
      run("kind", ["create", "cluster", "--name", name, ...kubeconfigFlag, ...configFlag, "--wait", "120s"], { stdio: "inherit" });
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
     * The per-session runner image (the runner's Dockerfile.sandbox, its
     * `sandbox` stage, which the Compose runner is built on), tagged as the
     * repository a per-session driver pulls at `compose-dev`, and loaded.
     */
    loadSandboxRunnerImage() {
      const tagged = `${IMAGE_REGISTRY}/runner:${SOURCE_TAG}`;
      log(`building ${tagged} (Dockerfile.sandbox, target sandbox)`);
      run("docker", ["build", "--target", "sandbox", "-f", join(repoRoot, "backend", "services", "runner", "Dockerfile.sandbox"), "-t", tagged, repoRoot], {
        stdio: "inherit",
      });
      log(`kind load docker-image ${tagged}`);
      run("kind", ["load", "docker-image", tagged, "--name", name], { stdio: "inherit" });
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
    /**
     * Ready the node for Agent Substrate's gVisor workers and its node
     * agent's pulls, as Substrate's kind script does: proxy ARP on the node,
     * and the local registry (started if it is not running) on the kind
     * network, wired into the node's containerd and documented in
     * kube-public (KEP-1755).
     */
    prepareForSubstrate() {
      const node = `${name}-control-plane`;
      run("docker", ["exec", node, "sysctl", "net.ipv4.conf.all.proxy_arp=1"]);
      const running = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", LOCAL_REGISTRY.container], { encoding: "utf8" });
      if (running.stdout.trim() !== "true") {
        log(`starting the local registry ${LOCAL_REGISTRY.container} on ${LOCAL_REGISTRY.host}`);
        spawnSync("docker", ["rm", "-f", LOCAL_REGISTRY.container], { stdio: "ignore" });
        run("docker", ["run", "-d", "--restart=always", "-p", "127.0.0.1:5001:5000", "--network", "bridge", "--name", LOCAL_REGISTRY.container, "registry:3"]);
      }
      const networks = run("docker", ["inspect", "-f", "{{json .NetworkSettings.Networks}}", LOCAL_REGISTRY.container]);
      if (!Object.keys(JSON.parse(networks)).includes("kind")) run("docker", ["network", "connect", "kind", LOCAL_REGISTRY.container]);
      const certs = `/etc/containerd/certs.d/${LOCAL_REGISTRY.host}`;
      run("docker", ["exec", node, "mkdir", "-p", certs]);
      run("docker", ["exec", "-i", node, "cp", "/dev/stdin", `${certs}/hosts.toml`], { input: `[host."http://${LOCAL_REGISTRY.inCluster}"]\n` });
      cluster.kubectl(["apply", "-f", "-"], {
        input: JSON.stringify({
          apiVersion: "v1",
          kind: "ConfigMap",
          metadata: { name: "local-registry-hosting", namespace: "kube-public" },
          data: { "localRegistryHosting.v1": `host: "${LOCAL_REGISTRY.host}"\nhostFromClusterNetwork: "${LOCAL_REGISTRY.inCluster}"\nhelp: "https://kind.sigs.k8s.io/docs/user/local-registry/"\n` },
        }),
      });
    },
    /**
     * The per-session runner image, built as loadSandboxRunnerImage builds
     * it and pushed to the local registry under `registry` (its
     * repository prefix there); returns its digest, which Agent Substrate
     * requires the runner be pinned by.
     */
    pushSandboxRunnerImage(registry) {
      const tagged = `${registry}/runner:${SOURCE_TAG}`;
      log(`building ${tagged} (Dockerfile.sandbox, target sandbox) and pushing it`);
      run("docker", ["build", "--target", "sandbox", "-f", join(repoRoot, "backend", "services", "runner", "Dockerfile.sandbox"), "-t", tagged, repoRoot], {
        stdio: "inherit",
      });
      run("docker", ["push", tagged], { stdio: "inherit" });
      const digest = run("docker", ["image", "inspect", "--format", "{{range .RepoDigests}}{{println .}}{{end}}", tagged])
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.startsWith(`${registry}/runner@sha256:`))
        ?.split("@")[1];
      if (digest === undefined) throw new Error(`the registry gave ${tagged} no digest`);
      return digest;
    },
    /** The source images already loaded, loaded again under another registry's names, for a Stigmer that declares spec.image.registry. */
    loadSourceImagesAs(registry) {
      for (const repository of ["stigmer-server", "stigmer-runner"]) {
        const from = `${IMAGE_REGISTRY}/${repository}:${SOURCE_TAG}`;
        const to = `${registry}/${repository}:${SOURCE_TAG}`;
        run("docker", ["tag", from, to]);
        log(`kind load docker-image ${to}`);
        run("kind", ["load", "docker-image", to, "--name", name], { stdio: "inherit" });
      }
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
