/**
 * Pins the Docker driver's ensure state machine (docker.ts) without a
 * Docker daemon: a fake `docker` on PATH answers `inspect` with the state
 * the case sets and records every call. A running container is the fast
 * path (nothing started), a stopped one is restarted as-is with its
 * original env while its baked token is good, and recreated with the
 * fresh token once that token has expired: its workspace, the runner's home
 * and the agent's home carried over as tar streams into a container created
 * fresh from the runner image beside it, each copied into its own parent
 * folder (stigmer#3361), and without `--archive` so each file keeps the owner its
 * tar header names, the agent user's included (`--archive` would chown
 * them all to the container's user, and refuses a `--user 0:0` container
 * outright: stigmer#3155), then swapped in, so no variable the driver no longer sets
 * survives, and a failed copy leaves the old container as it was. A
 * container made under another configuration (another image, or another
 * baked server release; a development server's none compares equal) is
 * recreated the same way: a stopped one instead of started, a running one
 * stopped first, and only when the ensure says the runner is idle; one on
 * this configuration, or an ensure that does not say so, is left as it is
 * (stigmer#1843). Two ensures of one container at once (a retried ask
 * and the attempt it replaced) take turns, so a recreate never runs twice. An
 * absent one is created (a connect sandbox on its
 * own queue), with the operator's runner
 * secrets beside the token, never on the command line. Which agent's home
 * a recreate carries is the one the new runner will use: the operator's
 * STIGMER_AGENT_HOME when it is a folder of its own, else the default
 * (carriedDirs); when the old container was made under another agent's
 * home, the state is not where the new runner looks, so the recreate goes
 * ahead without it and says so. The real CLI and image are the live test's
 * (docker.live.test.ts).
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { LogFields, Logger } from "../../boot/logger.js";
import { carriedDirs, createArgsFor, newDockerSandboxProvisioner, tokenExpiryMs } from "../docker.js";
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
  artifactLane: false,
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
if [ "$1" = "cp" ] && [ "$2" != "-" ] && [ -f "$FAKE_DOCKER_DIR/copy-out-fails" ]; then
  echo "Error: no such path" >&2
  exit 1
fi
if [ "$1" = "rm" ] && [ -f "$FAKE_DOCKER_DIR/copy-in-fails" ]; then
  case "$3" in *-fresh) echo "Error: removal failed" >&2; exit 1;; esac
fi
if [ "$1" = "cp" ] && [ "$2" = "-" ] && [ -f "$FAKE_DOCKER_DIR/copy-in-fails" ]; then
  echo "Error: copy failed" >&2
  exit 1
fi
if [ "$1" = "start" ] && [ -f "$FAKE_DOCKER_DIR/start-fails" ]; then
  echo "Error: cannot start" >&2
  exit 1
fi
if [ "$1" = "rm" ] && [ -f "$FAKE_DOCKER_DIR/state" ] && [ "$(cat "$FAKE_DOCKER_DIR/state")" = "absent" ]; then
  echo "Error: No such container: $3" >&2
  exit 1
fi
if [ "$1" = "rename" ] && [ -f "$FAKE_DOCKER_DIR/config-after" ]; then
  cp "$FAKE_DOCKER_DIR/config-after" "$FAKE_DOCKER_DIR/config"
fi
if [ "$1" = "start" ] && [ -f "$FAKE_DOCKER_DIR/config-after" ]; then
  echo running > "$FAKE_DOCKER_DIR/state"
fi
if [ "$1" = "inspect" ] && [ "$3" = "{{json .Config}}" ]; then
  cat "$FAKE_DOCKER_DIR/config"
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

/** What the container was created with: its image and, when its server was a release, that release. */
interface Baked {
  readonly image?: string;
  readonly release?: string;
  readonly agentHome?: string;
}

function setState(
  state: "absent" | "stopped" | "running",
  bakedToken = jwtExpiringIn(3600),
  baked: Baked = {},
): void {
  writeFileSync(path.join(dir, "state"), state);
  const env = ["PATH=/usr/bin", `STIGMER_TOKEN=${bakedToken}`];
  if (baked.release !== undefined) env.push(`STIGMER_SERVER_RELEASE=${baked.release}`);
  if (baked.agentHome !== undefined) env.push(`STIGMER_AGENT_HOME=${baked.agentHome}`);
  writeFileSync(
    path.join(dir, "config"),
    JSON.stringify({ Image: baked.image ?? CONFIG.runnerImage, Env: env }),
  );
  writeFileSync(path.join(dir, "calls.log"), "");
  rmSync(path.join(dir, "config-after"), { force: true });
}

/**
 * Makes the fake CLI's container follow a recreate: the swapped-in one
 * carries `baked`, and a start leaves it running.
 */
function recreatesTo(baked: Baked): void {
  writeFileSync(
    path.join(dir, "config-after"),
    JSON.stringify({ Image: baked.image ?? CONFIG.runnerImage, Env: ["PATH=/usr/bin"] }),
  );
}

/** A token-shaped string whose `exp` is `seconds` from now (the driver reads, never verifies, it). */
function jwtExpiringIn(seconds: number): string {
  const claims = { token_type: "execution_scoped", exp: Math.floor(Date.now() / 1000) + seconds };
  return `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
}

function calls(): string[] {
  return readFileSync(path.join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
}

function capturingLogger(): {
  logger: Logger;
  infos: Array<[string, LogFields | undefined]>;
  warns: Array<[string, LogFields | undefined]>;
} {
  const infos: Array<[string, LogFields | undefined]> = [];
  const warns: Array<[string, LogFields | undefined]> = [];
  return {
    infos,
    warns,
    logger: {
      debug: () => undefined,
      info: (message, fields) => infos.push([message, fields]),
      warn: (message, fields) => warns.push([message, fields]),
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
      `inspect --format {{json .Config}} ${name}`,
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
    expect(made.slice(0, 5)).toEqual([
      `inspect --format {{.State.Running}} ${name}`,
      `inspect --format {{json .Config}} ${name}`,
      `cp ${name}:/workspace -`,
      `cp ${name}:/root -`,
      `cp ${name}:/home/stigmer-agent -`,
    ]);
    // Created fresh from the runner image, with only what this ensure gives it.
    expect(made[5]?.startsWith(`create --name ${fresh} `)).toBe(true);
    expect(made[5]).toContain(` ${CONFIG.runnerImage} `);
    expect(made[5]).toMatch(/ --env STIGMER_TOKEN( |$)/);
    expect(made[5]).not.toContain("STIGMER_TEMPORAL_");
    // Each folder's tar is rooted at its base name, so it goes into its parent.
    expect(made.slice(6)).toEqual([
      `cp - ${fresh}:/`,
      `cp - ${fresh}:/`,
      `cp - ${fresh}:/home`,
      `rm --force ${name}`,
      `rename ${fresh} ${name}`,
      `start ${name}`,
    ]);
    expect(infos).toEqual([
      ["Docker sandbox recreated with a fresh token", { scope: "session", id: "ses_ensure", container: name }],
    ]);
  });

  it("recreates without the agent's home when the old container was made under another one, and says so", async () => {
    setState("stopped", jwtExpiringIn(-60));
    const moved: SandboxDriverConfig = { ...CONFIG, runnerEnv: { ...CONFIG.runnerEnv, STIGMER_AGENT_HOME: "/data/agent" } };
    const { logger, warns } = capturingLogger();
    await newDockerSandboxProvisioner({ config: moved, logger }).ensureSessionSandbox("ses_ensure", ENV);

    const made = calls();
    const fresh = `${name}-fresh`;
    // The old runner kept the agent's state at the default home; the new one
    // looks in /data/agent, which the old container never had.
    expect(made.filter((c) => c.startsWith("cp "))).toEqual([
      `cp ${name}:/workspace -`,
      `cp ${name}:/root -`,
      `cp - ${fresh}:/`,
      `cp - ${fresh}:/`,
    ]);
    expect(made.slice(-3)).toEqual([`rm --force ${name}`, `rename ${fresh} ${name}`, `start ${name}`]);
    expect(warns).toEqual([
      [
        "Docker sandbox recreated under another agent home; the agent's earlier state stays behind",
        { scope: "session", id: "ses_ensure", container: name, fromAgentHome: "/home/stigmer-agent", toAgentHome: "/data/agent" },
      ],
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

describe("a container started under another configuration (stigmer#1843)", () => {
  const name = sandboxBaseName("session", "ses_ensure");
  /** The facts of the workflow's ensure, right before it invokes the runner. */
  const IDLE: SandboxFacts = { ...ENV, runnerIdle: true };
  const RELEASED: SandboxDriverConfig = { ...CONFIG, serverRelease: "3.42.0" };

  /** The calls of a recreate that carries the files, after `before`. */
  function expectRecreated(made: string[], before: string[]): void {
    const fresh = `${name}-fresh`;
    expect(made.slice(0, before.length + 3)).toEqual([
      ...before,
      `cp ${name}:/workspace -`,
      `cp ${name}:/root -`,
      `cp ${name}:/home/stigmer-agent -`,
    ]);
    const create = made[before.length + 3];
    expect(create?.startsWith(`create --name ${fresh} `)).toBe(true);
    expect(create).toContain(` ${CONFIG.runnerImage} `);
    expect(made.slice(before.length + 4)).toEqual([
      `cp - ${fresh}:/`,
      `cp - ${fresh}:/`,
      `cp - ${fresh}:/home`,
      `rm --force ${name}`,
      `rename ${fresh} ${name}`,
      `start ${name}`,
    ]);
  }

  it("running on another image with the runner idle, its recreate failing: started again as it was, the failure reported", async () => {
    setState("running", jwtExpiringIn(3600), { image: "ghcr.io/stigmer/runner:old" });
    writeFileSync(path.join(dir, "copy-out-fails"), "");
    try {
      const { logger } = capturingLogger();
      await expect(
        newDockerSandboxProvisioner({ config: CONFIG, logger }).ensureSessionSandbox("ses_ensure", IDLE),
      ).rejects.toThrow(/no such path/);
      const made = calls();
      expect(made).toContain(`stop ${name}`);
      expect(made.at(-1), "a container that served turns is never left stopped").toBe(`start ${name}`);
    } finally {
      rmSync(path.join(dir, "copy-out-fails"), { force: true });
    }
  });

  it("a failed recreate whose restart fails too: the recreate's failure is the one reported", async () => {
    setState("running", jwtExpiringIn(3600), { image: "ghcr.io/stigmer/runner:old" });
    writeFileSync(path.join(dir, "copy-out-fails"), "");
    writeFileSync(path.join(dir, "start-fails"), "");
    try {
      const { logger } = capturingLogger();
      await expect(
        newDockerSandboxProvisioner({ config: CONFIG, logger }).ensureSessionSandbox("ses_ensure", IDLE),
      ).rejects.toThrow(/no such path/);
      expect(calls().at(-1)).toBe(`start ${name}`);
    } finally {
      rmSync(path.join(dir, "copy-out-fails"), { force: true });
      rmSync(path.join(dir, "start-fails"), { force: true });
    }
  });

  it("running on another image with the runner idle: stopped, then recreated carrying its files", async () => {
    setState("running", jwtExpiringIn(3600), { image: "ghcr.io/stigmer/runner:old" });
    const { logger, infos } = capturingLogger();
    await newDockerSandboxProvisioner({ config: CONFIG, logger }).ensureSessionSandbox("ses_ensure", IDLE);

    expectRecreated(calls(), [
      `inspect --format {{.State.Running}} ${name}`,
      `inspect --format {{json .Config}} ${name}`,
      `stop ${name}`,
    ]);
    expect(infos).toEqual([
      [
        "Docker sandbox started under another configuration; recreated on this server's runner with its files",
        {
          scope: "session",
          id: "ses_ensure",
          container: name,
          fromImage: "ghcr.io/stigmer/runner:old",
          fromRelease: "",
          toImage: CONFIG.runnerImage,
          toRelease: "",
        },
      ],
    ]);
  });

  it("running under another release with the runner idle: recreated, though its image reference is the same", async () => {
    setState("running", jwtExpiringIn(3600), { release: "3.41.0" });
    const { logger } = capturingLogger();
    await newDockerSandboxProvisioner({ config: RELEASED, logger }).ensureSessionSandbox("ses_ensure", IDLE);

    expectRecreated(calls(), [
      `inspect --format {{.State.Running}} ${name}`,
      `inspect --format {{json .Config}} ${name}`,
      `stop ${name}`,
    ]);
  });

  it("running on this configuration with the runner idle: the fast path after one read", async () => {
    setState("running", jwtExpiringIn(3600), { release: "3.42.0" });
    const { logger, infos } = capturingLogger();
    await newDockerSandboxProvisioner({ config: RELEASED, logger }).ensureSessionSandbox("ses_ensure", IDLE);

    expect(calls()).toEqual([
      `inspect --format {{.State.Running}} ${name}`,
      `inspect --format {{json .Config}} ${name}`,
    ]);
    expect(infos).toEqual([]);
  });

  it("running on another image without the runner idle (a caller not right before the runner): never touched", async () => {
    setState("running", jwtExpiringIn(3600), { image: "ghcr.io/stigmer/runner:old" });
    const { logger } = capturingLogger();
    await newDockerSandboxProvisioner({ config: CONFIG, logger }).ensureSessionSandbox("ses_ensure", ENV);

    expect(calls()).toEqual([`inspect --format {{.State.Running}} ${name}`]);
  });

  it("a development server compares the image alone: a container with no release stamp on the same image starts as it is", async () => {
    setState("stopped");
    const { logger } = capturingLogger();
    await newDockerSandboxProvisioner({ config: CONFIG, logger }).ensureSessionSandbox("ses_ensure", ENV);

    expect(calls().at(-1)).toBe(`start ${name}`);
  });

  it("stopped on another image, its token still good: recreated carrying its files, not started as it is", async () => {
    setState("stopped", jwtExpiringIn(3600), { image: "ghcr.io/stigmer/runner:old" });
    const { logger } = capturingLogger();
    await newDockerSandboxProvisioner({ config: CONFIG, logger }).ensureSessionSandbox("ses_ensure", ENV);

    expectRecreated(calls(), [
      `inspect --format {{.State.Running}} ${name}`,
      `inspect --format {{json .Config}} ${name}`,
    ]);
  });

  it("two ensures at once: one recreate, the second ensure finding the swapped-in container", async () => {
    setState("stopped", jwtExpiringIn(3600), { image: "ghcr.io/stigmer/runner:old" });
    recreatesTo({});
    const { logger } = capturingLogger();
    const driver = newDockerSandboxProvisioner({ config: CONFIG, logger });
    await Promise.all([
      driver.ensureSessionSandbox("ses_ensure", IDLE),
      driver.ensureSessionSandbox("ses_ensure", ENV),
    ]);

    const made = calls();
    expect(made.filter((call) => call.startsWith("create ")), "one recreate, never a second over the first").toHaveLength(1);
    expect(made.filter((call) => call === `rm --force ${name}`)).toHaveLength(1);
    // The second ensure reads the container only after the first has swapped it in.
    expect(made.lastIndexOf(`inspect --format {{.State.Running}} ${name}`)).toBeGreaterThan(made.indexOf(`rename ${name}-fresh ${name}`));
  });

  it("stopped under another release with no token minted now: recreated all the same", async () => {
    setState("stopped", "", { release: "3.41.0" });
    const { logger } = capturingLogger();
    await newDockerSandboxProvisioner({ config: RELEASED, logger }).ensureSessionSandbox("ses_ensure", {
      ...ENV,
      stigmerToken: "",
    });

    expect(calls()).toContain(`rename ${name}-fresh ${name}`);
  });
});

describe("docker driver teardown", () => {
  const name = sandboxBaseName("session", "ses_ensure");

  it("removes the container, a missing one is success, and it waits its turn behind an ensure of the same container", async () => {
    setState("stopped");
    const { logger } = capturingLogger();
    const driver = newDockerSandboxProvisioner({ config: CONFIG, logger });
    await Promise.all([
      driver.ensureSessionSandbox("ses_ensure", ENV),
      driver.deprovisionSessionSandbox("ses_ensure"),
    ]);
    const made = calls();
    expect(made.indexOf(`rm --force ${name}`)).toBeGreaterThan(made.indexOf(`start ${name}`));

    setState("absent");
    await driver.deprovisionSessionSandbox("ses_ensure");
    expect(calls()).toEqual([`rm --force ${name}`]);
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

describe("carriedDirs (stigmer#3361)", () => {
  /** The config whose runner list (`list`) names `home` as the agent's home. */
  function configWith(home: string, list: "runnerEnv" | "runnerSecretEnv" = "runnerEnv"): SandboxDriverConfig {
    return { ...CONFIG, [list]: { ...CONFIG[list], STIGMER_AGENT_HOME: home } };
  }

  /** The folders a recreate carries when the old container was made under the same agent's home. */
  function carriedWith(home: string, list: "runnerEnv" | "runnerSecretEnv" = "runnerEnv"): readonly string[] {
    return carriedDirs(configWith(home, list), [`STIGMER_AGENT_HOME=${home}`]);
  }

  it("carries the workspace, the runner's home and the agent's default home", () => {
    expect(carriedDirs(CONFIG, ["PATH=/usr/bin"])).toEqual(["/workspace", "/root", "/home/stigmer-agent"]);
  });

  it("leaves the agent's home out when the old container was made under another one", () => {
    expect(carriedDirs(CONFIG, ["STIGMER_AGENT_HOME=/data/agent"])).toEqual(["/workspace", "/root"]);
    expect(carriedDirs(configWith("/data/agent"), [])).toEqual(["/workspace", "/root"]);
    expect(carriedDirs(configWith("/data/agent"), ["STIGMER_AGENT_HOME=/data/other"])).toEqual(["/workspace", "/root"]);
    // The same folder spelled another way, or a blank one read as the default, has not moved.
    expect(carriedDirs(configWith("/data/agent/"), ["STIGMER_AGENT_HOME=/data/agent"])).toEqual(["/workspace", "/root", "/data/agent"]);
    expect(carriedDirs(CONFIG, ["STIGMER_AGENT_HOME= "])).toEqual(["/workspace", "/root", "/home/stigmer-agent"]);
  });

  it("carries the operator's own agent home instead, from either runner list", () => {
    expect(carriedWith("/data/agent")).toEqual(["/workspace", "/root", "/data/agent"]);
    expect(carriedWith("/data/agent", "runnerSecretEnv")).toEqual(["/workspace", "/root", "/data/agent"]);
    expect(carriedWith("  /data/agent/ ")).toEqual(["/workspace", "/root", "/data/agent"]);
    // A sibling whose name only starts with a carried folder's is a folder of its own.
    expect(carriedWith("/workspace-agent")).toEqual(["/workspace", "/root", "/workspace-agent"]);
  });

  it("reads a blank STIGMER_AGENT_HOME as unset, as the runner does", () => {
    for (const home of ["", "   "]) {
      expect(carriedWith(home)).toEqual(["/workspace", "/root", "/home/stigmer-agent"]);
    }
  });

  it("leaves out an agent home a carried folder already holds, or one that would hold them", () => {
    for (const home of ["/workspace/agent", "/root/agent", "/root", "agent", "./agent", "/", "/../"]) {
      expect(carriedWith(home), home).toEqual(["/workspace", "/root"]);
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
