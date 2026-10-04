#!/usr/bin/env node

/**
 * Runs the agent-sandbox driver's live class against a real agent-sandbox
 * release: the one entry point, identical on a laptop (`make
 * test-agent-sandbox`) and in the ci.agent-sandbox lane.
 *
 * It makes everything the live test is handed and removes it afterwards:
 *   - a kind cluster of its own, with a kubeconfig of its own in a temporary
 *     directory, so the operator's ~/.kube/config is never read or written;
 *   - agent-sandbox's core manifest (`sandbox.yaml`) at AGENT_SANDBOX_VERSION,
 *     the release the driver is tested against, or at the version given
 *     (`latest` asks GitHub for upstream's newest release), then the
 *     namespace the driver provisions into;
 *   - the runner image loaded into the cluster's node: pulled when the local
 *     Docker does not hold it. The published default is linux/amd64 only, so
 *     on an arm64 machine build the sandbox image
 *     (`docker build --target sandbox -f backend/services/runner/Dockerfile.sandbox .`)
 *     and name it in RUNNER_IMAGE;
 *   - a Temporal dev server on a free port, which a pod reaches at the kind
 *     network's IPv4 gateway on Linux and at host.docker.internal on Docker
 *     Desktop. It binds the loopback on Docker Desktop, whose
 *     host.docker.internal reaches the host's loopback. On Linux it binds
 *     every interface for the run, because the dev server bound to the
 *     gateway alone dials its own internal services on the loopback and
 *     refuses itself. The dev server has no authentication, so outside CI
 *     (no CI variable) on Linux the run says so before it starts, because
 *     the port is open to the machine's network for those minutes.
 * Then it runs `npm run test:live` in the server package with those
 * addresses. A red test is followed by every object in the namespace, the
 * runner pods' events and logs and the controller's log, before it tears
 * down; so is a step of the setup that fails once the cluster answers, but
 * not an interrupt, which nobody asked to diagnose. It tears down when the
 * test fails and on SIGINT or SIGTERM (a Ctrl-C on a laptop) too, an
 * interrupted `kind create` included, whose leftovers it deletes by the
 * cluster's name (`--keep` leaves a cluster that came up for a reader, and
 * prints how to remove it). It never removes a cluster it did not make: it
 * refuses to start when a cluster of that name already exists, and a create
 * that fails because another run took the name in the meantime leaves that
 * cluster alone. Only an interrupt (SIGINT or SIGTERM) skips the diagnosis;
 * a child killed by anything else is a red like any other.
 *
 * Needs kind, kubectl, docker and the Temporal CLI on PATH (CI pins kind and
 * installs the Temporal CLI through .github/actions/temporal-cli), and the
 * server package's dependencies installed.
 *
 * Usage:
 *   node scripts/agent-sandbox-live.mjs [--agent-sandbox-version <vX.Y.Z|latest>]
 *     [--runner-image <image>] [--keep]
 * AGENT_SANDBOX_VERSION and RUNNER_IMAGE in the environment, when set and not
 * empty, stand in for the two flags; `make test-agent-sandbox` hands them on
 * that way, so a value reaches this script, which checks it, and never a
 * shell command line.
 * Exit: the live test's exit code; 2 when the system could not be made.
 */

import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The agent-sandbox release the driver is tested against; the operator guide names the same one. */
export const AGENT_SANDBOX_VERSION = "v1.0.5";

/** The runner image the live test starts when none is given. */
export const DEFAULT_RUNNER_IMAGE = "ghcr.io/stigmer/runner:latest";

const CLUSTER = "stigmer-agent-sandbox-live";
const NAMESPACE = "stigmer-sandboxes";
const ROOT = resolve(fileURLToPath(import.meta.url), "../..");

export function parseArgs(argv, env = {}) {
  const opts = {
    version: env.AGENT_SANDBOX_VERSION || AGENT_SANDBOX_VERSION,
    runnerImage: env.RUNNER_IMAGE || DEFAULT_RUNNER_IMAGE,
    keep: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--agent-sandbox-version") opts.version = argv[++i] ?? "";
    else if (arg === "--runner-image") opts.runnerImage = argv[++i] ?? "";
    else if (arg === "--keep") opts.keep = true;
    else throw new Error(`unknown argument '${arg}'`);
  }
  if (opts.version !== "latest" && !/^v\d+\.\d+\.\d+$/.test(opts.version)) {
    throw new Error(`--agent-sandbox-version takes vX.Y.Z or latest, not '${opts.version}'`);
  }
  if (opts.runnerImage === "") throw new Error("--runner-image needs an image");
  return opts;
}

/** The manifest URL of one agent-sandbox release. */
export function manifestUrl(version) {
  return `https://github.com/kubernetes-sigs/agent-sandbox/releases/download/${version}/sandbox.yaml`;
}

/** Upstream's newest release tag, from GitHub's API (GITHUB_TOKEN raises the rate limit when set). */
async function latestVersion() {
  const headers = { accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(
    "https://api.github.com/repos/kubernetes-sigs/agent-sandbox/releases/latest",
    { headers },
  );
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for agent-sandbox's latest release`);
  const { tag_name: tag } = await response.json();
  if (typeof tag !== "string" || tag === "") throw new Error("agent-sandbox's latest release has no tag");
  return tag;
}

/** Whether an interrupt has stopped the run: a child ended by SIGINT or SIGTERM, or the run itself. */
let interrupted = false;

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(" ")}`);
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...options });
  } catch (error) {
    if (interruptedBy(error)) interrupted = true;
    throw error;
  }
}

/**
 * Whether a child's ending signal was an interrupt (a Ctrl-C, or a stop): a
 * child killed by anything else (the OOM killer's SIGKILL) is a red to
 * diagnose, not an interrupt.
 */
export function isInterrupt(signal) {
  return signal === "SIGINT" || signal === "SIGTERM";
}

/**
 * Whether a failed execFileSync was an interrupt. Node ends a child whose
 * output passes the buffer cap with SIGTERM too, but names it ENOBUFS: that
 * is a red to diagnose, not an interrupt.
 */
export function interruptedBy(error) {
  return isInterrupt(error?.signal) && error?.code !== "ENOBUFS";
}

/** Whether `kind get clusters` lists the named cluster. */
export function clusterListed(output, name) {
  return output.split(/\r?\n/).some((line) => line.trim() === name);
}

/**
 * Whether the run still owns the cluster's name after its `kind create`
 * failed. kind removes what a failed create made in most failures, but not
 * when the create was interrupted, so an interrupted create's leftovers are
 * this run's to delete. A cluster listed under the name after an
 * uninterrupted failure is taken as another run's, which took the name
 * between the check and the create, and left alone. That is also what the
 * run does with the one uninterrupted failure kind does not clean up, a
 * failed kubeconfig export after the cluster was made: it is left listed,
 * and the next run's refusal names the command that deletes it. Leaving a
 * cluster is the cost the run accepts so that it never deletes another's.
 */
export function ownsAfterFailedCreate({ interrupted: byASignal, listedNow }) {
  return byASignal || !listedNow;
}

/**
 * What the teardown does with the cluster's name: nothing when the run never
 * claimed it; keep it for a --keep reader once it came up; otherwise delete
 * whatever kind made under it, a create's leftovers included, since a
 * cluster that never came up has nothing for a reader.
 */
export function teardownAction({ owned, keep, ready }) {
  if (!owned) return "none";
  return keep && ready ? "keep" : "delete";
}

/** Whether a red run is diagnosed in its cluster before the teardown. */
export function shouldDiagnose({ ready, code, interrupted: byASignal }) {
  return ready && code !== 0 && !byASignal;
}

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

const DOCKER_DESKTOP = new Set(["darwin", "win32"]);

/**
 * The kind network's IPv4 gateway, from `docker network inspect`'s gateways
 * separated by spaces. The network also carries an IPv6 subnet, listed
 * first on some hosts, and a pod's runner dials host:port, which an IPv6
 * address does not fit.
 */
export function ipv4Gateway(gateways) {
  const found = gateways.split(/\s+/).find((gateway) => /^\d+\.\d+\.\d+\.\d+$/.test(gateway));
  if (found === undefined) throw new Error(`the kind network has no IPv4 gateway (gateways: '${gateways.trim()}')`);
  return found;
}

/** The address a pod on the kind network reaches this host at. */
export function hostFromKindNetwork(platform, gateway) {
  return DOCKER_DESKTOP.has(platform) ? "host.docker.internal" : gateway;
}

/** The address the Temporal dev server binds (the header says why Linux binds every interface). */
export function temporalBindAddress(platform) {
  return DOCKER_DESKTOP.has(platform) ? "127.0.0.1" : "0.0.0.0";
}

/** The warning a run outside CI prints before it opens Temporal to every interface, or undefined. */
export function exposureWarning(platform, env) {
  if (temporalBindAddress(platform) !== "0.0.0.0" || env.CI) return undefined;
  return "agent-sandbox-live: warning: the Temporal dev server listens on every interface for this run, without authentication; anyone on this machine's network can reach it until the run ends";
}

/** Starts a child and resolves its exit code; a child that cannot start (a missing binary) resolves 127. */
function spawnChild(command, args, options) {
  const child = spawn(command, args, options);
  const exited = new Promise((resolveCode) => {
    child.once("error", (error) => {
      console.error(`agent-sandbox-live: ${command} could not start: ${error.message}`);
      resolveCode(127);
    });
    child.once("exit", (exit, signal) => {
      if (isInterrupt(signal)) interrupted = true;
      resolveCode(exit ?? 1);
    });
  });
  return { child, exited };
}

async function waitForPort(host, port, timeoutMs, exited) {
  const deadline = Date.now() + timeoutMs;
  let gone = false;
  void exited.then(() => {
    gone = true;
  });
  for (;;) {
    if (gone) throw new Error(`the Temporal dev server exited before it listened on ${host}:${port}`);
    const open = await new Promise((resolveOpen) => {
      const socket = connect(port, host);
      socket.once("connect", () => {
        socket.destroy();
        resolveOpen(true);
      });
      socket.once("error", () => resolveOpen(false));
    });
    if (open) return;
    if (Date.now() > deadline) throw new Error(`nothing listens on ${host}:${port} after ${timeoutMs / 1000}s`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** What a reader of a red run needs before the cluster goes: every object, then each runner pod's events and logs. */
function diagnose(kube) {
  const show = (...args) => {
    try {
      console.log(kube(...args));
    } catch {
      // A diagnosis that fails says nothing more; the run is already red.
    }
  };
  show("-n", NAMESPACE, "get", "sandboxes,pods,pvc,secrets", "-o", "wide");
  show("-n", NAMESPACE, "describe", "pods");
  let pods = "";
  try {
    pods = kube("-n", NAMESPACE, "get", "pods", "-o", "name");
  } catch {
    pods = "";
  }
  for (const pod of pods.split("\n").filter(Boolean)) {
    show("-n", NAMESPACE, "logs", pod, "--all-containers", "--tail=200");
  }
  show("-n", "agent-sandbox-system", "logs", "deploy/agent-sandbox-controller", "--tail=100");
}

async function main(argv) {
  const opts = parseArgs(argv, process.env);
  const version = opts.version === "latest" ? await latestVersion() : opts.version;
  const state = mkdtempSync(join(tmpdir(), "stigmer-agent-sandbox-live-"));
  const kubeconfig = join(state, "kubeconfig");
  const kube = (...args) => run("kubectl", ["--kubeconfig", kubeconfig, ...args]);
  let temporal;
  // owned: this run claimed the cluster's name, so whatever kind made under
  // it, a whole cluster or what an interrupted create left, is this run's to
  // delete. ready: the cluster answers, so a red run can be diagnosed in it.
  let owned = false;
  let ready = false;
  let tornDown = false;
  let code = 2;
  const teardown = () => {
    if (tornDown) return;
    tornDown = true;
    temporal?.child.kill("SIGTERM");
    const action = teardownAction({ owned, keep: opts.keep, ready });
    if (action === "none") {
      rmSync(state, { recursive: true, force: true });
    } else if (action === "keep") {
      console.log(`kept: KUBECONFIG=${kubeconfig}; remove with kind delete cluster --name ${CLUSTER} --kubeconfig ${kubeconfig}`);
    } else {
      try {
        run("kind", ["delete", "cluster", "--name", CLUSTER, "--kubeconfig", kubeconfig]);
      } finally {
        rmSync(state, { recursive: true, force: true });
      }
    }
  };
  // A Ctrl-C reaches every child too; whatever was running ends, and the
  // run takes down what it made before it exits.
  for (const [signal, exit] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    process.once(signal, () => {
      interrupted = true;
      console.error(`agent-sandbox-live: ${signal}, tearing down`);
      try {
        teardown();
      } finally {
        process.exit(exit);
      }
    });
  }
  try {
    console.log(`agent-sandbox ${version}, runner image ${opts.runnerImage}, state ${state}`);
    // A cluster of this name that is not this run's (kept by --keep, or
    // another run's) stops the run here, and is never deleted by it.
    if (clusterListed(run("kind", ["get", "clusters"]), CLUSTER)) {
      throw new Error(
        `a kind cluster named ${CLUSTER} already exists (a --keep run's, or another run's): delete it with kind delete cluster --name ${CLUSTER} first`,
      );
    }
    owned = true;
    try {
      run("kind", ["create", "cluster", "--name", CLUSTER, "--kubeconfig", kubeconfig, "--wait", "180s"], {
        stdio: ["ignore", "inherit", "inherit"],
      });
    } catch (error) {
      let listedNow = true;
      try {
        listedNow = clusterListed(run("kind", ["get", "clusters"]), CLUSTER);
      } catch {
        // Unreadable: take the cluster as another run's, and delete nothing.
      }
      owned = ownsAfterFailedCreate({ interrupted, listedNow });
      throw error;
    }
    ready = true;
    kube("apply", "-f", manifestUrl(version));
    kube("-n", "agent-sandbox-system", "rollout", "status", "deploy/agent-sandbox-controller", "--timeout=300s");
    kube("create", "namespace", NAMESPACE);

    try {
      run("docker", ["image", "inspect", opts.runnerImage, "--format", "{{.Id}}"]);
    } catch {
      run("docker", ["pull", opts.runnerImage], { stdio: ["ignore", "inherit", "inherit"] });
    }
    run("kind", ["load", "docker-image", opts.runnerImage, "--name", CLUSTER], {
      stdio: ["ignore", "inherit", "inherit"],
    });

    const gateway = ipv4Gateway(run("docker", ["network", "inspect", "kind", "--format", "{{range .IPAM.Config}}{{.Gateway}} {{end}}"]));
    const host = hostFromKindNetwork(process.platform, gateway);
    const bind = temporalBindAddress(process.platform);
    const warning = exposureWarning(process.platform, process.env);
    if (warning !== undefined) console.error(warning);
    const port = await freePort();
    temporal = spawnChild(
      "temporal",
      ["server", "start-dev", "--headless", "--ip", bind, "--port", String(port), "--ui-port", String(await freePort()), "--log-level", "warn"],
      { stdio: "inherit" },
    );
    await waitForPort("127.0.0.1", port, 60_000, temporal.exited);

    const env = {
      ...process.env,
      KUBECONFIG: kubeconfig,
      STIGMER_SANDBOX_K8S_NAMESPACE: NAMESPACE,
      STIGMER_SANDBOX_TEMPORAL_ADDRESS: `${host}:${port}`,
      // Nothing serves it: the runner polls Temporal without reaching the
      // server, and the live test asserts the poll, not a turn.
      STIGMER_SANDBOX_BACKEND_ENDPOINT: `http://${host}:1`,
      STIGMER_SANDBOX_RUNNER_IMAGE: opts.runnerImage,
      STIGMER_AGENT_SANDBOX_LIVE_TEMPORAL: `127.0.0.1:${port}`,
    };
    code = await spawnChild("npm", ["run", "test:live"], {
      cwd: join(ROOT, "backend/services/stigmer-server"),
      env,
      stdio: "inherit",
    }).exited;
  } finally {
    // Any red after the cluster answers is diagnosed in it, a setup step's
    // (the controller's rollout, say) as much as the test's.
    if (shouldDiagnose({ ready, code, interrupted })) diagnose(kube);
    teardown();
  }
  return code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`agent-sandbox-live: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    },
  );
}

