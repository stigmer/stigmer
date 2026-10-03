/**
 * Pins the Docker driver's ensure state machine (docker.ts) without a
 * Docker daemon: a fake `docker` on PATH answers `inspect` with the state
 * the case sets and records every call. A running container is the fast
 * path (nothing started), a stopped one is restarted as-is with its
 * original env, and an absent one is created, with the operator's runner
 * secrets beside the token, never on the command line. The real CLI and
 * image are the opt-in smoke's (docker.test.ts).
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { LogFields, Logger } from "../../boot/logger.js";
import { newDockerSandboxProvisioner } from "../docker.js";
import { sandboxBaseName } from "../naming.js";
import type { SandboxDriverConfig, SandboxEnvironment } from "../provisioner.js";

const CONFIG: SandboxDriverConfig = {
  backendEndpoint: "http://host.docker.internal:7234",
  mcpPublicEndpoint: "https://api.example.com",
  temporalAddress: "host.docker.internal:7233",
  temporalNamespace: "default",
  temporalConnectionEnv: {},
  runnerImage: "ghcr.io/stigmer/runner:test",
  runnerCommand: "unused-by-this-driver",
  kubernetesNamespace: "unused-by-this-driver",
  runnerEnv: { ANTHROPIC_BASE_URL: "http://model.example:18555" },
  runnerSecretEnv: { ANTHROPIC_API_KEY: "sk-ensure" },
};

const ENV: SandboxEnvironment = {
  taskQueue: "session:ses_ensure",
  stigmerToken: "token-ensure",
  callerClass: "user",
};

let dir: string;
let originalPath: string | undefined;

/** The fake CLI: answers `inspect` from the state file, records every call. */
const FAKE_DOCKER = `#!/bin/sh
echo "$*" >> "$FAKE_DOCKER_DIR/calls.log"
if [ "$1" = "inspect" ]; then
  state=$(cat "$FAKE_DOCKER_DIR/state")
  if [ "$state" = "absent" ]; then
    echo "Error: No such container: x" >&2
    exit 1
  fi
  if [ "$state" = "running" ]; then echo true; else echo false; fi
  exit 0
fi
echo ok
`;

function setState(state: "absent" | "stopped" | "running"): void {
  writeFileSync(path.join(dir, "state"), state);
  writeFileSync(path.join(dir, "calls.log"), "");
}

function calls(): string[] {
  return readFileSync(path.join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
}

function capturingLogger(): { logger: Logger; infos: Array<[string, LogFields | undefined]> } {
  const infos: Array<[string, LogFields | undefined]> = [];
  return {
    infos,
    logger: {
      debug: () => undefined,
      info: (message, fields) => infos.push([message, fields]),
      warn: () => undefined,
      error: () => undefined,
    },
  };
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "docker-ensure-test-"));
  const bin = path.join(dir, "docker");
  writeFileSync(bin, FAKE_DOCKER);
  chmodSync(bin, 0o755);
  originalPath = process.env["PATH"];
  process.env["PATH"] = `${dir}${path.delimiter}${originalPath ?? ""}`;
  process.env["FAKE_DOCKER_DIR"] = dir;
});

afterEach(() => {
  writeFileSync(path.join(dir, "calls.log"), "");
});

afterAll(() => {
  process.env["PATH"] = originalPath;
  delete process.env["FAKE_DOCKER_DIR"];
  rmSync(dir, { recursive: true, force: true });
});

describe("docker driver ensure", () => {
  const name = sandboxBaseName("session", "ses_ensure");

  it("starts nothing when the container is already running", async () => {
    setState("running");
    const { logger, infos } = capturingLogger();
    await newDockerSandboxProvisioner({ config: CONFIG, logger }).ensureSessionSandbox("ses_ensure", ENV);

    expect(calls()).toEqual([`inspect --format {{.State.Running}} ${name}`]);
    expect(infos).toEqual([]);
  });

  it("restarts a stopped container as it is, and logs the restart", async () => {
    setState("stopped");
    const { logger, infos } = capturingLogger();
    await newDockerSandboxProvisioner({ config: CONFIG, logger }).ensureSessionSandbox("ses_ensure", ENV);

    expect(calls()).toEqual([`inspect --format {{.State.Running}} ${name}`, `start ${name}`]);
    expect(infos).toEqual([
      ["Docker sandbox restarted", { scope: "session", id: "ses_ensure", container: name }],
    ]);
  });

  it("creates the container when none exists", async () => {
    setState("absent");
    const { logger } = capturingLogger();
    await newDockerSandboxProvisioner({ config: CONFIG, logger }).ensureSessionSandbox("ses_ensure", ENV);

    const made = calls();
    expect(made[0]).toBe(`inspect --format {{.State.Running}} ${name}`);
    expect(made[1]?.startsWith(`run --detach --name ${name} `)).toBe(true);
    // The token travels by a value-less --env, so it is never on the command line.
    expect(made[1]).toMatch(/ --env STIGMER_TOKEN( |$)/);
    expect(made.join("\n")).not.toContain(ENV.stigmerToken);
    // So do the operator's runner secrets; a plain runner setting is a value.
    expect(made[1]).toMatch(/ --env ANTHROPIC_API_KEY( |$)/);
    expect(made.join("\n")).not.toContain("sk-ensure");
    expect(made[1]).toContain("--env ANTHROPIC_BASE_URL=http://model.example:18555");
    expect(made.some((c) => c.startsWith("start "))).toBe(false);
  });
});
