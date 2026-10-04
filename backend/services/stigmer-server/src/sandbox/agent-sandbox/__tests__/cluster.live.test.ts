/**
 * The agent-sandbox driver against a real cluster running a real
 * agent-sandbox release: the live class (vitest.live.config.ts), run by
 * `make test-agent-sandbox` (scripts/agent-sandbox-live.mjs), which makes
 * the kind cluster, installs agent-sandbox, starts a Temporal dev server and
 * hands this file their addresses, and by the ci.agent-sandbox lane on every
 * change to the driver and weekly against upstream's newest release.
 *
 * One session's life, through the built-in factory and the cluster's own
 * controller:
 *
 *   - the ensure creates the Sandbox, its pod runs the runner image, and the
 *     runner polls the session's queue in Temporal (it booted with the
 *     driver's environment and reached Temporal from inside the cluster);
 *   - a file written to /workspace survives a suspend (the pod goes, the
 *     claim stays Bound) and the wake that follows, which brings the runner
 *     back to the queue;
 *   - deprovision leaves no Sandbox, pod, claim or Secret behind.
 *
 * It needs everything it is given and fails without it, never skips: the
 * live config runs only when asked to.
 */
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { createLogger } from "../../../boot/logger.js";
import { sandboxBaseName } from "../../naming.js";
import type { SandboxDriverConfig } from "../../provisioner.js";
import { newAgentSandboxProvisioner } from "../builtin.js";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} is not set: run this file through make test-agent-sandbox (scripts/agent-sandbox-live.mjs)`,
    );
  }
  return value;
}

const namespace = required("STIGMER_SANDBOX_K8S_NAMESPACE");
const temporalFromHost = required("STIGMER_AGENT_SANDBOX_LIVE_TEMPORAL");

const config: SandboxDriverConfig = {
  backendEndpoint: required("STIGMER_SANDBOX_BACKEND_ENDPOINT"),
  mcpPublicEndpoint: "",
  temporalAddress: required("STIGMER_SANDBOX_TEMPORAL_ADDRESS"),
  temporalNamespace: "default",
  temporalConnectionEnv: {},
  runnerImage: required("STIGMER_SANDBOX_RUNNER_IMAGE"),
  runnerCommand: "unused-by-this-driver",
  kubernetesNamespace: namespace,
  runnerEnv: {},
  runnerSecretEnv: {},
  serverRelease: "",
};

const logger = createLogger({ level: "error", pretty: false, write: () => {} });

function kubectl(...args: string[]): string {
  return execFileSync("kubectl", ["-n", namespace, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function exists(kind: string, name: string): boolean {
  return kubectl("get", kind, name, "--ignore-not-found", "-o", "name") !== "";
}

interface Poller {
  readonly identity: string;
  readonly lastAccessTime: number;
}

/** Every object in the CLI's answer that names a poller and when it last polled. */
function pollersIn(value: unknown, found: Poller[] = []): Poller[] {
  if (Array.isArray(value)) {
    for (const entry of value) pollersIn(entry, found);
  } else if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (
      typeof record.identity === "string" &&
      typeof record.lastAccessTime === "string"
    ) {
      found.push({
        identity: record.identity,
        lastAccessTime: Date.parse(record.lastAccessTime),
      });
    }
    for (const entry of Object.values(record)) pollersIn(entry, found);
  }
  return found;
}

/**
 * Whether a runner polled the queue at or after `since`. Temporal lists a
 * poller for minutes after its last poll, so a runner that went with its pod
 * stays listed; only the time of the poll tells a woken runner from it.
 */
function polledSince(taskQueue: string, since: number): boolean {
  const out = execFileSync(
    "temporal",
    [
      "task-queue",
      "describe",
      "--task-queue",
      taskQueue,
      "--address",
      temporalFromHost,
      "--output",
      "json",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const pollers = pollersIn(JSON.parse(out) as unknown);
  return pollers.some((poller) => poller.lastAccessTime >= since);
}

async function until(
  what: string,
  check: () => boolean,
  timeoutMs = 180_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (check()) return;
    if (Date.now() > deadline) {
      throw new Error(
        `timed out after ${timeoutMs / 1000}s waiting for ${what}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

describe("the agent-sandbox driver on a live cluster", () => {
  const sessionId = `ses_live_${Date.now()}`;
  const name = sandboxBaseName("session", sessionId);
  const taskQueue = `session:${sessionId}`;
  const env = { taskQueue, stigmerToken: "tok-live", callerClass: "user" };
  const driver = newAgentSandboxProvisioner({ config, logger });
  const podPhase = () =>
    kubectl(
      "get",
      "pod",
      name,
      "--ignore-not-found",
      "-o",
      "jsonpath={.status.phase}",
    );

  it("runs a session's runner, keeps its files across a suspend and a wake, and leaves nothing behind", async () => {
    const created = Date.now();
    await driver.ensureSessionSandbox(sessionId, env);
    expect(await driver.probe("session", sessionId)).toBe("running");
    await until("the runner pod to run", () => podPhase() === "Running");
    await until("the runner to poll its queue", () =>
      polledSince(taskQueue, created),
    );

    kubectl(
      "exec",
      name,
      "-c",
      "runner",
      "--",
      "sh",
      "-c",
      "echo kept > /workspace/live-proof",
    );

    kubectl(
      "patch",
      "sandbox",
      name,
      "--type",
      "merge",
      "-p",
      '{"spec":{"operatingMode":"Suspended"}}',
    );
    expect(await driver.probe("session", sessionId)).toBe("stopped");
    await until("the pod to go", () => !exists("pod", name));
    expect(
      kubectl(
        "get",
        "pvc",
        `workspace-${name}`,
        "-o",
        "jsonpath={.status.phase}",
      ),
    ).toBe("Bound");

    // Temporal's poll times have one-second precision.
    const woken = Date.now() - 1_000;
    await driver.ensureSessionSandbox(sessionId, {
      ...env,
      stigmerToken: "tok-live-2",
    });
    expect(await driver.probe("session", sessionId)).toBe("running");
    await until("the woken pod to run", () => podPhase() === "Running");
    expect(
      kubectl(
        "exec",
        name,
        "-c",
        "runner",
        "--",
        "cat",
        "/workspace/live-proof",
      ).trim(),
    ).toBe("kept");
    await until("the woken runner to poll its queue", () =>
      polledSince(taskQueue, woken),
    );

    await driver.deprovisionSessionSandbox(sessionId);
    await until("the Sandbox, pod, claim and Secret to go", () =>
      [
        ["sandbox", name],
        ["pod", name],
        ["pvc", `workspace-${name}`],
        ["secret", `${name}-env`],
      ].every(([kind, object]) => !exists(kind ?? "", object ?? "")),
    );
    expect(await driver.probe("session", sessionId)).toBe("absent");
  });
});
