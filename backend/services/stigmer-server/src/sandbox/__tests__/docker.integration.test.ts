/**
 * Integration smoke for the Docker driver (§6d, O6): the real docker
 * CLI, the full provision → probe → stop/start → deprovision cycle, and
 * the label/env contract on the live container.
 *
 * Gated HONESTLY, never silently: it runs only when Docker answers AND
 * the operator opts in with STIGMER_SANDBOX_DOCKER_SMOKE=1 — the smoke
 * pulls the published runner image (the breakdown's acceptance names
 * it), which is far too heavy for every `npm test`. CI's opt-in lane and
 * the PR's recorded run are the proof points. Override the image with
 * STIGMER_SANDBOX_RUNNER_IMAGE to smoke against a local build.
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

function dockerAnswers(): boolean {
  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

const optedIn = process.env["STIGMER_SANDBOX_DOCKER_SMOKE"] === "1";

describe.skipIf(!optedIn || !dockerAnswers())(
  "docker driver (integration smoke — opt-in)",
  () => {
    const config: SandboxDriverConfig = {
      // host.docker.internal: reachable-from-container on Docker Desktop;
      // the smoke only needs the vars INJECTED, not a live server behind
      // them (the runner tolerates an unreachable backend at boot).
      backendEndpoint: "http://host.docker.internal:7234",
      temporalAddress: "host.docker.internal:7233",
      runnerImage:
        process.env["STIGMER_SANDBOX_RUNNER_IMAGE"] ??
        "ghcr.io/stigmer/runner:latest",
      runnerCommand: "unused-by-this-driver",
      kubernetesNamespace: "unused-by-this-driver",
    };
    const driver = newDockerSandboxProvisioner({
      config,
      logger: silentLogger,
    });
    const sessionId = `ses_docker_smoke_${Date.now()}`;
    const containerName = sandboxBaseName("session", sessionId);

    afterAll(async () => {
      await driver.deprovisionSessionSandbox(sessionId);
    });

    it("provisions a labeled container with the env contract, probes, and tears down", async () => {
      await driver.ensureSessionSandbox(sessionId, {
        taskQueue: `session:${sessionId}`,
        stigmerToken: "tok-docker-smoke",
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
      expect(container?.Config.Env).toContain("STIGMER_TOKEN=tok-docker-smoke");
      expect(container?.Config.Env).toContain("MODE=local");

      // Idempotent fast path.
      await driver.ensureSessionSandbox(sessionId, {
        taskQueue: `session:${sessionId}`,
        stigmerToken: "tok-docker-smoke",
      });
      expect(await driver.probe("session", sessionId)).toBe("running");

      await driver.deprovisionSessionSandbox(sessionId);
      expect(await driver.probe("session", sessionId)).toBe("absent");
      // Idempotent teardown.
      await driver.deprovisionSessionSandbox(sessionId);
    });
  },
);
