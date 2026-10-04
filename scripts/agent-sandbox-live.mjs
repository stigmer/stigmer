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
 *     Docker does not hold it;
 *   - a Temporal dev server on a free port, bound on every interface so a pod
 *     reaches it at the host's address on the kind network (the network's
 *     gateway on Linux, host.docker.internal on Docker Desktop).
 * Then it runs `npm run test:live` in the server package with those
 * addresses, and tears down even when the test fails (`--keep` leaves the
 * cluster for a reader, and prints how to remove it).
 *
 * Needs kind, kubectl, docker and the Temporal CLI on PATH (CI pins kind and
 * installs the Temporal CLI through .github/actions/temporal-cli), and the
 * server package's dependencies installed.
 *
 * Usage:
 *   node scripts/agent-sandbox-live.mjs [--agent-sandbox-version <vX.Y.Z|latest>]
 *     [--runner-image <image>] [--keep]
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

export function parseArgs(argv) {
  const opts = { version: AGENT_SANDBOX_VERSION, runnerImage: DEFAULT_RUNNER_IMAGE, keep: false };
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

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(" ")}`);
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...options });
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

/** The address a pod on the kind network reaches this host at. */
export function hostFromKindNetwork(platform, gateway) {
  return platform === "darwin" || platform === "win32" ? "host.docker.internal" : gateway;
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const open = await new Promise((resolveOpen) => {
      const socket = connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolveOpen(true);
      });
      socket.once("error", () => resolveOpen(false));
    });
    if (open) return;
    if (Date.now() > deadline) throw new Error(`nothing listens on ${port} after ${timeoutMs / 1000}s`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function main(argv) {
  const opts = parseArgs(argv);
  const version = opts.version === "latest" ? await latestVersion() : opts.version;
  const state = mkdtempSync(join(tmpdir(), "stigmer-agent-sandbox-live-"));
  const kubeconfig = join(state, "kubeconfig");
  const kube = (...args) => run("kubectl", ["--kubeconfig", kubeconfig, ...args]);
  let temporal;
  let code = 2;
  try {
    console.log(`agent-sandbox ${version}, runner image ${opts.runnerImage}, state ${state}`);
    run("kind", ["create", "cluster", "--name", CLUSTER, "--kubeconfig", kubeconfig, "--wait", "180s"], {
      stdio: ["ignore", "inherit", "inherit"],
    });
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

    const port = await freePort();
    temporal = spawn(
      "temporal",
      ["server", "start-dev", "--headless", "--ip", "0.0.0.0", "--port", String(port), "--ui-port", String(await freePort()), "--log-level", "warn"],
      { stdio: "inherit" },
    );
    await waitForPort(port, 60_000);
    const gateway = run("docker", ["network", "inspect", "kind", "--format", "{{(index .IPAM.Config 0).Gateway}}"]).trim();
    const host = hostFromKindNetwork(process.platform, gateway);

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
    const test = spawn("npm", ["run", "test:live"], {
      cwd: join(ROOT, "backend/services/stigmer-server"),
      env,
      stdio: "inherit",
    });
    code = await new Promise((resolveCode) => test.once("exit", (exit) => resolveCode(exit ?? 1)));
  } finally {
    temporal?.kill("SIGTERM");
    if (opts.keep) {
      console.log(`kept: KUBECONFIG=${kubeconfig}; remove with kind delete cluster --name ${CLUSTER} --kubeconfig ${kubeconfig}`);
    } else {
      try {
        run("kind", ["delete", "cluster", "--name", CLUSTER, "--kubeconfig", kubeconfig]);
      } finally {
        rmSync(state, { recursive: true, force: true });
      }
    }
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

