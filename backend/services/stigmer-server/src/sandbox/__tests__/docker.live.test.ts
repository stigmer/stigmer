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
 * A second case moves a container made from another image reference (a
 * local tag of the same image, so nothing is pulled) to the configured
 * image the way a server upgrade does (stigmer#1843): its files come over,
 * an agent-owned file keeping its owner and mode in the `--user 0:0`
 * container the driver creates (stigmer#3155), and the agent's home with
 * them, back at its own path, so the conversation's state survives
 * (stigmer#3361). A third carries an operator's own agent home, at a
 * folder the runner image does not have (`/data/agent`), the same way. It reads the files with
 * `docker cp`, so it holds whether the runner is still up or has exited.
 *
 * It needs a Docker daemon and fails without one, never skips: the live
 * config runs only when asked to.
 */
import { execFileSync } from "node:child_process";

import { afterAll, describe, expect, it } from "vitest";

import { createLogger } from "../../boot/logger.js";
import { newDockerSandboxProvisioner } from "../docker.js";
import { AGENT_HOME } from "../runner-launch.js";
import { sandboxBaseName } from "../naming.js";
import type { SandboxDriverConfig, SandboxFacts } from "../provisioner.js";

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

/** One regular file of a tar stream. */
interface TarFile {
  readonly name: string;
  readonly uid: number;
  readonly gid: number;
  readonly mode: number;
  readonly body: string;
}

/** A ustar stream of `files`, with the owners and modes given (no tar binary's own defaults). */
function tarOf(files: readonly TarFile[]): Buffer {
  const blocks: Buffer[] = [];
  for (const file of files) {
    const body = Buffer.from(file.body);
    const header = Buffer.alloc(512);
    const octal = (value: number, width: number, at: number) =>
      header.write(`${value.toString(8).padStart(width - 1, "0")}\0`, at, "latin1");
    header.write(file.name, 0, "latin1");
    octal(file.mode, 8, 100);
    octal(file.uid, 8, 108);
    octal(file.gid, 8, 116);
    octal(body.length, 12, 124);
    octal(Math.floor(Date.now() / 1000), 12, 136);
    header.write("        ", 148, "latin1");
    header.write("0", 156, "latin1");
    header.write("ustar\0", 257, "latin1");
    header.write("00", 263, "latin1");
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "latin1");
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

/** The first file of a tar stream: its owner, mode and contents. */
function firstFileOf(tar: Buffer): Omit<TarFile, "name"> {
  const field = (at: number, width: number) =>
    Number.parseInt(tar.subarray(at, at + width).toString("latin1").replace(/\0.*$/s, "").trim(), 8);
  const size = field(124, 12);
  return {
    uid: field(108, 8),
    gid: field(116, 8),
    mode: field(100, 8) & 0o7777,
    body: tar.subarray(512, 512 + size).toString("utf8"),
  };
}

describe("docker driver against a Docker daemon", () => {
  const config: SandboxDriverConfig = {
    // host.docker.internal: reachable-from-container on Docker Desktop;
    // the test only needs the vars INJECTED, not a live server behind
    // them. With no Temporal to reach, the runner exits within seconds
    // (on Linux, where the name does not resolve, too), so the probes
    // below read the container in its first moments (stigmer#2722); the
    // ensure state machine itself is pinned by docker-ensure.test.ts.
    backendEndpoint: "http://host.docker.internal:7234",
    mcpPublicEndpoint: "https://api.example.com",
    temporalNamespace: "default",
    runnerImage:
      process.env["STIGMER_SANDBOX_RUNNER_IMAGE"] ??
      "ghcr.io/stigmer/runner:latest",
    runnerCommand: "unused-by-this-driver",
    kubernetesNamespace: "unused-by-this-driver",
    runnerEnv: { ANTHROPIC_BASE_URL: "http://host.docker.internal:18555" },
    runnerSecretEnv: { ANTHROPIC_API_KEY: "sk-docker-live" },
    serverRelease: "",
    artifactLane: false,
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
      executionId: "aex_test",
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
      executionId: "aex_test",
    });
    expect(await driver.probe("session", sessionId)).toBe("running");

    await driver.deprovisionSessionSandbox(sessionId);
    expect(await driver.probe("session", sessionId)).toBe("absent");
    // Idempotent teardown.
    await driver.deprovisionSessionSandbox(sessionId);
  });
});

describe("docker driver moving a container to another image (stigmer#1843)", () => {
  const sessionId = `ses_docker_move_${Date.now()}`;
  const containerName = sandboxBaseName("session", sessionId);
  // A local tag of the configured image stands in for the earlier release's.
  const earlierImage = `stigmer-live-earlier-runner:${Date.now()}`;
  const config: SandboxDriverConfig = {
    backendEndpoint: "http://host.docker.internal:7234",
    mcpPublicEndpoint: "",
    temporalNamespace: "default",
    runnerImage:
      process.env["STIGMER_SANDBOX_RUNNER_IMAGE"] ??
      "ghcr.io/stigmer/runner:latest",
    runnerCommand: "unused-by-this-driver",
    kubernetesNamespace: "unused-by-this-driver",
    runnerEnv: {},
    runnerSecretEnv: {},
    serverRelease: "",
    artifactLane: false,
  };
  const facts: SandboxFacts = {
    taskQueue: `session:${sessionId}`,
    stigmerToken: "",
    callerClass: "user",
    executionId: "aex_test",
  };
  const current = newDockerSandboxProvisioner({ config, logger: silentLogger });

  afterAll(async () => {
    await current.deprovisionSessionSandbox(sessionId);
    execFileSync("docker", ["rmi", earlierImage], { stdio: "pipe" });
  });

  function docker(args: string[], input?: Buffer): Buffer {
    return execFileSync("docker", args, { stdio: "pipe", ...(input !== undefined ? { input } : {}) });
  }

  it("recreates it from the configured image with its files and the agent's home, an agent-owned file keeping its owner and mode", async () => {
    docker(["tag", config.runnerImage, earlierImage]);
    const earlier = newDockerSandboxProvisioner({
      config: { ...config, runnerImage: earlierImage },
      logger: silentLogger,
    });
    await earlier.ensureSessionSandbox(sessionId, facts);
    docker(
      ["cp", "-", `${containerName}:/`],
      tarOf([
        { name: "workspace/carried.txt", uid: 1500, gid: 1500, mode: 0o640, body: "the agent's file" },
        { name: "root/carried.txt", uid: 0, gid: 0, mode: 0o600, body: "the runner's file" },
        {
          name: `${AGENT_HOME.slice(1)}/.stigmer/sessions/carried.txt`,
          uid: 10001,
          gid: 10001,
          mode: 0o600,
          body: "the agent's state",
        },
      ]),
    );
    const before = docker(["inspect", "--format", "{{.Id}}", containerName]).toString().trim();

    // The workflow's ensure, right before it would invoke the runner.
    await current.ensureSessionSandbox(sessionId, { ...facts, runnerIdle: true });

    expect(docker(["inspect", "--format", "{{.Id}}", containerName]).toString().trim()).not.toBe(before);
    expect(docker(["inspect", "--format", "{{.Config.Image}}", containerName]).toString().trim()).toBe(
      config.runnerImage,
    );
    expect(firstFileOf(docker(["cp", `${containerName}:/workspace/carried.txt`, "-"]))).toEqual({
      uid: 1500,
      gid: 1500,
      mode: 0o640,
      body: "the agent's file",
    });
    expect(firstFileOf(docker(["cp", `${containerName}:/root/carried.txt`, "-"])).body).toBe("the runner's file");
    expect(
      firstFileOf(docker(["cp", `${containerName}:${AGENT_HOME}/.stigmer/sessions/carried.txt`, "-"])),
      "the agent's home came back at its own path",
    ).toEqual({ uid: 10001, gid: 10001, mode: 0o600, body: "the agent's state" });

    // On the configured image now: the next such ensure leaves it as it is.
    const moved = docker(["inspect", "--format", "{{.Id}}", containerName]).toString().trim();
    await current.ensureSessionSandbox(sessionId, { ...facts, runnerIdle: true });
    expect(docker(["inspect", "--format", "{{.Id}}", containerName]).toString().trim()).toBe(moved);
  });
});

describe("docker driver carrying an operator's own agent home (stigmer#3361)", () => {
  const sessionId = `ses_docker_home_${Date.now()}`;
  const containerName = sandboxBaseName("session", sessionId);
  const earlierImage = `stigmer-live-earlier-home-runner:${Date.now()}`;
  const config: SandboxDriverConfig = {
    backendEndpoint: "http://host.docker.internal:7234",
    mcpPublicEndpoint: "",
    temporalNamespace: "default",
    runnerImage: process.env["STIGMER_SANDBOX_RUNNER_IMAGE"] ?? "ghcr.io/stigmer/runner:latest",
    runnerCommand: "unused-by-this-driver",
    kubernetesNamespace: "unused-by-this-driver",
    // The image has no /data: the copy into the new container makes it.
    runnerEnv: { STIGMER_AGENT_HOME: "/data/agent" },
    runnerSecretEnv: {},
    serverRelease: "",
    artifactLane: false,
  };
  const facts: SandboxFacts = {
    taskQueue: `session:${sessionId}`,
    stigmerToken: "",
    callerClass: "user",
    executionId: "aex_test",
  };
  const current = newDockerSandboxProvisioner({ config, logger: silentLogger });

  afterAll(async () => {
    await current.deprovisionSessionSandbox(sessionId);
    execFileSync("docker", ["rmi", earlierImage], { stdio: "pipe" });
  });

  function docker(args: string[], input?: Buffer): Buffer {
    return execFileSync("docker", args, { stdio: "pipe", ...(input !== undefined ? { input } : {}) });
  }

  it("recreates it with the agent's home at /data/agent, a folder the image lacks, its file keeping its owner and mode", async () => {
    docker(["tag", config.runnerImage, earlierImage]);
    const earlier = newDockerSandboxProvisioner({
      config: { ...config, runnerImage: earlierImage },
      logger: silentLogger,
    });
    await earlier.ensureSessionSandbox(sessionId, facts);
    docker(
      ["cp", "-", `${containerName}:/`],
      tarOf([{ name: "data/agent/.stigmer/sessions/carried.txt", uid: 10001, gid: 10001, mode: 0o600, body: "the agent's state" }]),
    );
    const before = docker(["inspect", "--format", "{{.Id}}", containerName]).toString().trim();

    await current.ensureSessionSandbox(sessionId, { ...facts, runnerIdle: true });

    expect(docker(["inspect", "--format", "{{.Id}}", containerName]).toString().trim()).not.toBe(before);
    expect(
      firstFileOf(docker(["cp", `${containerName}:/data/agent/.stigmer/sessions/carried.txt`, "-"])),
      "the operator's agent home came back at its own path",
    ).toEqual({ uid: 10001, gid: 10001, mode: 0o600, body: "the agent's state" });
  });
});
