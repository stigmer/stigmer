/**
 * The Docker driver against a real Docker daemon: the live class
 * (vitest.live.config.ts). It starts the runner container the way a
 * self-hosted server on Docker does, through the real docker CLI, and walks
 * the full provision → probe → idempotent ensure → deprovision cycle,
 * reading the label and env contract off the live container, the
 * operator's runner lists included.
 *
 * The ci.agent-sandbox lane runs it with the rest of the server's live
 * class, on the runner's own Docker, on every change to the driver; alone,
 * `make test-docker-sandbox` runs it. The image is the published runner
 * (the lane has it on the host already); STIGMER_SANDBOX_RUNNER_IMAGE
 * points it at a local build. The published image is amd64 alone
 * (stigmer#2720), so on an arm64 host pull it with
 * `--platform linux/amd64` first.
 *
 * It needs a Docker daemon and fails without one, never skips: the live
 * config runs only when asked to.
 */
import { execFileSync } from "node:child_process";

import { afterAll, describe, expect, it } from "vitest";

import { createLogger } from "../../boot/logger.js";
import { newDockerSandboxProvisioner } from "../docker.js";
import { sandboxBaseName } from "../naming.js";
import type { SandboxDriverConfig } from "../provisioner.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

function requireDockerDaemon(): void {
  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      stdio: "pipe",
    });
  } catch (error) {
    throw new Error(
      `no Docker daemon answers \`docker version\`: this live test drives one (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

requireDockerDaemon();

describe("docker driver against a Docker daemon", () => {
  const config: SandboxDriverConfig = {
    // host.docker.internal: reachable-from-container on Docker Desktop;
    // the test only needs the vars INJECTED, not a live server behind
    // them (the runner tolerates an unreachable backend at boot).
    backendEndpoint: "http://host.docker.internal:7234",
    mcpPublicEndpoint: "https://api.example.com",
    temporalAddress: "host.docker.internal:7233",
    temporalNamespace: "default",
    temporalConnectionEnv: {},
    runnerImage:
      process.env["STIGMER_SANDBOX_RUNNER_IMAGE"] ??
      "ghcr.io/stigmer/runner:latest",
    runnerCommand: "unused-by-this-driver",
    kubernetesNamespace: "unused-by-this-driver",
    runnerEnv: { ANTHROPIC_BASE_URL: "http://host.docker.internal:18555" },
    runnerSecretEnv: { ANTHROPIC_API_KEY: "sk-docker-live" },
    serverRelease: "",
  };
  const driver = newDockerSandboxProvisioner({
    config,
    logger: silentLogger,
  });
  const sessionId = `ses_docker_live_${Date.now()}`;
  const containerName = sandboxBaseName("session", sessionId);

  afterAll(async () => {
    await driver.deprovisionSessionSandbox(sessionId);
  });

  it("provisions a labeled container with the env contract, probes, and tears down", async () => {
    await driver.ensureSessionSandbox(sessionId, {
      taskQueue: `session:${sessionId}`,
      stigmerToken: "tok-docker-live",
      callerClass: "user",
    });
    expect(await driver.probe("session", sessionId)).toBe("running");

    const inspect = JSON.parse(
      execFileSync("docker", ["inspect", containerName], {
        stdio: "pipe",
      }).toString(),
    ) as Array<{
      Config: { Env: string[]; Labels: Record<string, string> };
    }>;
    const container = inspect[0];
    expect(container?.Config.Labels["stigmer.ai/sandbox-id"]).toBe(sessionId);
    expect(container?.Config.Labels["stigmer.ai/scope"]).toBe("session");
    expect(container?.Config.Env).toContain(
      `STIGMER_TASK_QUEUE=session:${sessionId}`,
    );
    expect(container?.Config.Env).toContain("STIGMER_TOKEN=tok-docker-live");
    expect(container?.Config.Env).toContain("MODE=local");
    expect(container?.Config.Env).toContain(
      `STIGMER_MCP_PUBLIC_ENDPOINT=${config.mcpPublicEndpoint}`,
    );
    // The operator's runner lists: the setting by value, the secret
    // through the CLI's environment (never argv).
    expect(container?.Config.Env).toContain(
      "ANTHROPIC_BASE_URL=http://host.docker.internal:18555",
    );
    expect(container?.Config.Env).toContain("ANTHROPIC_API_KEY=sk-docker-live");

    // Idempotent fast path.
    await driver.ensureSessionSandbox(sessionId, {
      taskQueue: `session:${sessionId}`,
      stigmerToken: "tok-docker-live",
      callerClass: "user",
    });
    expect(await driver.probe("session", sessionId)).toBe("running");

    await driver.deprovisionSessionSandbox(sessionId);
    expect(await driver.probe("session", sessionId)).toBe("absent");
    // Idempotent teardown.
    await driver.deprovisionSessionSandbox(sessionId);
  });
});
