/**
 * Pins the Docker driver's ensure state machine (docker.ts) without a
 * Docker daemon: a fake `docker` on PATH answers `inspect` with the state
 * the case sets and records every call. A running container is the fast
 * path (nothing started), a stopped one is restarted as-is with its
 * original env while its baked token is good, and recreated with the
 * fresh token once that token has expired: its workspace and home carried
 * over as tar streams into a container created fresh from the runner image
 * beside it, then swapped in, so no variable the driver no longer sets
 * survives, and a failed copy leaves the old container as it was. An
 * absent one is created (a connect sandbox on its
 * own queue), with the operator's runner
 * secrets beside the token, never on the command line. The real CLI and
 * image are the live test's (docker.live.test.ts).
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { LogFields, Logger } from "../../boot/logger.js";
import { createArgsFor, newDockerSandboxProvisioner, tokenExpiryMs } from "../docker.js";
import { sandboxBaseName } from "../naming.js";
import type { SandboxDriverConfig, SandboxFacts } from "../provisioner.js";

const CONFIG: SandboxDriverConfig = {
  backendEndpoint: "http://host.docker.internal:7234",
  mcpPublicEndpoint: "https://api.example.com",
  temporalNamespace: "default",
  runnerImage: "ghcr.io/stigmer/runner:test",
  runnerCommand: "unused-by-this-driver",
  kubernetesNamespace: "unused-by-this-driver",
  runnerEnv: { ANTHROPIC_BASE_URL: "http://model.example:18555" },
  runnerSecretEnv: { ANTHROPIC_API_KEY: "sk-ensure" },
  serverRelease: "",
};

const ENV: SandboxFacts = {
  taskQueue: "session:ses_ensure",
  stigmerToken: "token-ensure",
  callerClass: "user",
  executionId: "aex_test",
};

let dir: string;
let originalPath: string | undefined;

/** The fake CLI: answers `inspect` from the state file, records every call. */
const FAKE_DOCKER = `#!/bin/sh
echo "$*" >> "$FAKE_DOCKER_DIR/calls.log"
if [ "$1" = "cp" ] && [ "$2" != "--archive" ] && [ -f "$FAKE_DOCKER_DIR/copy-out-fails" ]; then
  echo "Error: no such path" >&2
  exit 1
fi
if [ "$1" = "rm" ] && [ -f "$FAKE_DOCKER_DIR/copy-in-fails" ]; then
  case "$3" in *-fresh) echo "Error: removal failed" >&2; exit 1;; esac
fi
if [ "$1" = "cp" ] && [ "$2" = "--archive" ] && [ -f "$FAKE_DOCKER_DIR/copy-in-fails" ]; then
  echo "Error: copy failed" >&2
  exit 1
fi
if [ "$1" = "inspect" ] && [ "$3" = "{{json .Config.Env}}" ]; then
  cat "$FAKE_DOCKER_DIR/env"
  exit 0
fi
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

function setState(state: "absent" | "stopped" | "running", bakedToken = jwtExpiringIn(3600)): void {
  writeFileSync(path.join(dir, "state"), state);
  writeFileSync(path.join(dir, "env"), JSON.stringify(["PATH=/usr/bin", `STIGMER_TOKEN=${bakedToken}`]));
  writeFileSync(path.join(dir, "calls.log"), "");
}

/** A token-shaped string whose `exp` is `seconds` from now (the driver reads, never verifies, it). */
function jwtExpiringIn(seconds: number): string {
  const claims = { token_type: "execution_scoped", exp: Math.floor(Date.now() / 1000) + seconds };
  return `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
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

    expect(calls()).toEqual([
      `inspect --format {{.State.Running}} ${name}`,
      `inspect --format {{json .Config.Env}} ${name}`,
      `start ${name}`,
    ]);
    expect(infos).toEqual([
      ["Docker sandbox restarted", { scope: "session", id: "ses_ensure", container: name }],
    ]);
  });

  it("recreates a stopped container whose token has expired, carrying its files and none of its old environment", async () => {
    setState("stopped", jwtExpiringIn(-60));
    const { logger, infos } = capturingLogger();
    await newDockerSandboxProvisioner({ config: CONFIG, logger }).ensureSessionSandbox("ses_ensure", ENV);

    const made = calls();
    const fresh = `${name}-fresh`;
    expect(made.slice(0, 4)).toEqual([
      `inspect --format {{.State.Running}} ${name}`,
      `inspect --format {{json .Config.Env}} ${name}`,
      `cp ${name}:/workspace -`,
      `cp ${name}:/root -`,
    ]);
    // Created fresh from the runner image, with only what this ensure gives it.
    expect(made[4]?.startsWith(`create --name ${fresh} `)).toBe(true);
    expect(made[4]).toContain(` ${CONFIG.runnerImage} `);
    expect(made[4]).toMatch(/ --env STIGMER_TOKEN( |$)/);
    expect(made[4]).not.toContain("STIGMER_TEMPORAL_");
    expect(made.slice(5)).toEqual([
      `cp --archive - ${fresh}:/`,
      `cp --archive - ${fresh}:/`,
      `rm --force ${name}`,
      `rename ${fresh} ${name}`,
      `start ${name}`,
    ]);
    expect(infos).toEqual([
      ["Docker sandbox recreated with a fresh token", { scope: "session", id: "ses_ensure", container: name }],
    ]);
  });

  it("touches nothing when the files cannot be copied out of the old container", async () => {
    setState("stopped", jwtExpiringIn(-60));
    writeFileSync(path.join(dir, "copy-out-fails"), "");
    try {
      const { logger } = capturingLogger();
      await expect(
        newDockerSandboxProvisioner({ config: CONFIG, logger }).ensureSessionSandbox("ses_ensure", ENV),
      ).rejects.toThrow(/exited 1: Error: no such path/);
      expect(calls().at(-1)).toBe(`cp ${name}:/workspace -`);
    } finally {
      rmSync(path.join(dir, "copy-out-fails"), { force: true });
    }
  });

  it("leaves the old container as it was when the files cannot be copied into the new one, its copy failure the one reported", async () => {
    setState("stopped", jwtExpiringIn(-60));
    writeFileSync(path.join(dir, "copy-in-fails"), "");
    try {
      const { logger } = capturingLogger();
      await expect(
        newDockerSandboxProvisioner({ config: CONFIG, logger }).ensureSessionSandbox("ses_ensure", ENV),
      ).rejects.toThrow(/copy failed/);
      const made = calls();
      expect(made.at(-1)).toBe(`rm --force ${name}-fresh`);
      expect(made).not.toContain(`rm --force ${name}`);
    } finally {
      rmSync(path.join(dir, "copy-in-fails"), { force: true });
    }
  });

  it("starts a stopped container as it is when it has no token, or none minted now", async () => {
    for (const [baked, fresh] of [["", "token-ensure"], [jwtExpiringIn(-60), ""]] as const) {
      setState("stopped", baked);
      const { logger } = capturingLogger();
      await newDockerSandboxProvisioner({ config: CONFIG, logger }).ensureSessionSandbox("ses_ensure", {
        ...ENV,
        stigmerToken: fresh,
      });
      expect(calls().at(-1)).toBe(`start ${name}`);
    }
  });

  it("creates a connect sandbox on its connect queue and answers its id", async () => {
    setState("absent");
    const { logger } = capturingLogger();
    const id = await newDockerSandboxProvisioner({ config: CONFIG, logger }).createConnectSandbox("mcr_ensure", {
      taskQueue: "mcpconnect:mcr_ensure",
      stigmerToken: "",
      callerClass: "user",
      executionId: "aex_test",
    });

    expect(id).toBe("mcr_ensure");
    const made = calls();
    expect(made[1]?.startsWith(`run --detach --name ${sandboxBaseName("connect", "mcr_ensure")} `)).toBe(true);
    expect(made[1]).toContain("--env STIGMER_TASK_QUEUE=mcpconnect:mcr_ensure");
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

describe("tokenExpiryMs", () => {
  it("reads a JWT's exp in milliseconds, and nothing from anything else", () => {
    expect(tokenExpiryMs(`h.${Buffer.from(JSON.stringify({ exp: 10 })).toString("base64url")}.s`)).toBe(10_000);
    for (const token of ["opaque", "h.%%%.s", `h.${Buffer.from("{}").toString("base64url")}.s`]) {
      expect(tokenExpiryMs(token)).toBeUndefined();
    }
  });
});

describe("createArgsFor", () => {
  it("turns a docker run into a docker create under another name, and refuses anything else", () => {
    expect(createArgsFor(["run", "--detach", "--name", "a", "--env", "X=1", "img"], "b")).toEqual([
      "create",
      "--name",
      "b",
      "--env",
      "X=1",
      "img",
    ]);
    expect(() => createArgsFor(["create", "--name", "a"], "b")).toThrow(/start "run --detach --name"/);
  });
});
