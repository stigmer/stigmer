/**
 * Pins one docker sandbox's `docker run` (docker.ts, buildDockerRun) with
 * no Docker: the label and env contract in argv, the runner as root with
 * root's HOME in /workspace (runner-launch.ts), the operator's plain
 * runner settings by value, the server's release only for a release
 * server (stigmer/stigmer#1831), and every credential (the token, the
 * Temporal connection settings, the operator's runner secrets) as a
 * value-less `--env NAME` whose value only the CLI's environment holds;
 * a session's Environment as `--env STIGMER_SANDBOX_ENVIRONMENT=<json>`
 * (the runner's half) only when it has one, and the driver installs an
 * Environment's packages but cannot limit a container's network.
 */
import { describe, expect, it } from "vitest";

import { createLogger } from "../../boot/logger.js";
import { buildDockerRun, newDockerSandboxProvisioner } from "../docker.js";
import { runnerEnvironmentOf } from "../environment.js";
import { sandboxBaseName } from "../naming.js";
import type { EnvironmentFacts, SandboxDriverConfig } from "../provisioner.js";
import {
  RUNNER_HOME,
  RUNNER_UID,
  SANDBOX_ENVIRONMENT_ENV,
  SERVER_RELEASE_ENV,
  runnerCommand,
} from "../runner-launch.js";

const config: SandboxDriverConfig = {
  backendEndpoint: "http://host.docker.internal:7234",
  mcpPublicEndpoint: "",
  temporalAddress: "host.docker.internal:7233",
  temporalNamespace: "default",
  temporalConnectionEnv: { STIGMER_TEMPORAL_API_KEY: "temporal-key" },
  runnerImage: "ghcr.io/stigmer/runner:latest",
  runnerCommand: "unused",
  kubernetesNamespace: "unused",
  runnerEnv: { ANTHROPIC_BASE_URL: "http://gateway.example:8080" },
  runnerSecretEnv: { ANTHROPIC_API_KEY: "sk-test" },
  serverRelease: "",
};
const env = {
  taskQueue: "session:ses_1",
  stigmerToken: "tok",
  callerClass: "user" as const,
};

describe("buildDockerRun", () => {
  it("names, labels and configures the container, plain settings by value", () => {
    const { args } = buildDockerRun("session", "ses_1", env, config);
    expect(args.slice(0, 4)).toEqual([
      "run",
      "--detach",
      "--name",
      sandboxBaseName("session", "ses_1"),
    ]);
    expect(args).toContain("STIGMER_TASK_QUEUE=session:ses_1");
    expect(args).toContain("ANTHROPIC_BASE_URL=http://gateway.example:8080");
    expect(args).not.toContain("STIGMER_MCP_PUBLIC_ENDPOINT=");
    // The start script as the entrypoint, so a base image's own ENTRYPOINT
    // never wraps it; the entry as the image's arguments.
    expect(args.slice(-4)).toEqual([
      "--entrypoint",
      runnerCommand()[0],
      "ghcr.io/stigmer/runner:latest",
      ...runnerCommand().slice(1),
    ]);
  });

  it("runs the runner as root with root's HOME, in /workspace", () => {
    const { args } = buildDockerRun("session", "ses_1", env, config);
    expect(args[args.indexOf("--user") + 1]).toBe(`${RUNNER_UID}:${RUNNER_UID}`);
    expect(args[args.indexOf("--workdir") + 1]).toBe("/workspace");
    expect(args).toContain(`HOME=${RUNNER_HOME}`);
    expect(args.indexOf("--user")).toBeLessThan(args.indexOf(config.runnerImage));
  });

  it("keeps only the capabilities that start the agent user, and no new privileges", () => {
    const { args } = buildDockerRun("session", "ses_1", env, config);
    const before = args.slice(0, args.indexOf(config.runnerImage));
    expect(before.join(" ")).toContain("--cap-drop ALL --cap-add SETUID --cap-add SETGID --cap-add CHOWN --cap-add KILL --cap-add DAC_OVERRIDE --security-opt no-new-privileges");
  });

  it("hands the start script the server's release only when the server is a release", () => {
    const released = buildDockerRun("session", "ses_1", env, { ...config, serverRelease: "3.42.0" }).args;
    expect(released[released.indexOf(`${SERVER_RELEASE_ENV}=3.42.0`) - 1]).toBe("--env");
    expect(released.indexOf(`${SERVER_RELEASE_ENV}=3.42.0`)).toBeLessThan(released.indexOf(config.runnerImage));
    const dev = buildDockerRun("session", "ses_1", env, config).args;
    expect(dev.filter((arg) => arg.startsWith(`${SERVER_RELEASE_ENV}=`))).toEqual([]);
  });

  it("passes every credential by name only, its value through the CLI's environment", () => {
    const { args, secretEnv } = buildDockerRun("session", "ses_1", env, config);
    for (const name of [
      "ANTHROPIC_API_KEY",
      "STIGMER_TEMPORAL_API_KEY",
      "STIGMER_TOKEN",
    ]) {
      expect(args[args.indexOf(name) - 1]).toBe("--env");
    }
    expect(secretEnv).toEqual({
      ANTHROPIC_API_KEY: "sk-test",
      STIGMER_TEMPORAL_API_KEY: "temporal-key",
      STIGMER_TOKEN: "tok",
    });
    expect(args.join(" ")).not.toMatch(/sk-test|temporal-key|=tok\b/);
  });

  it("carries no token when none was minted, and the public address when one is named", () => {
    const { args, secretEnv } = buildDockerRun(
      "session",
      "ses_2",
      { ...env, taskQueue: "session:ses_2", stigmerToken: "" },
      {
        ...config,
        mcpPublicEndpoint: "https://api.example.com",
        runnerSecretEnv: {},
        temporalConnectionEnv: {},
      },
    );
    expect(secretEnv).toEqual({});
    expect(args).not.toContain("STIGMER_TOKEN");
    expect(args).toContain(
      "STIGMER_MCP_PUBLIC_ENDPOINT=https://api.example.com",
    );
  });
});

describe("a session's Environment", () => {
  const environment: EnvironmentFacts = {
    id: "env_1",
    network: {
      mode: "limited",
      hosts: [{ host: "example.com", cleartext: false }],
    },
    packages: { apt: ["ripgrep"], cargo: [], gem: [], go: [], npm: ["typescript"], pip: [] },
  };

  it("rides argv as the runner's half in JSON, before the image, only when the sandbox has one", () => {
    const { args } = buildDockerRun("session", "ses_1", { ...env, environment }, config);
    const set = args.filter((arg) => arg.startsWith(`${SANDBOX_ENVIRONMENT_ENV}=`));
    expect(set).toHaveLength(1);
    const [entry] = set;
    expect(args[args.indexOf(entry ?? "") - 1]).toBe("--env");
    expect(args.indexOf(entry ?? "")).toBeLessThan(args.indexOf(config.runnerImage));
    expect(JSON.parse((entry ?? "").slice(SANDBOX_ENVIRONMENT_ENV.length + 1))).toEqual(
      runnerEnvironmentOf(environment),
    );
    expect(args.join(" ")).not.toContain("example.com");

    const none = buildDockerRun("session", "ses_1", env, config).args;
    expect(none.filter((arg) => arg.includes(SANDBOX_ENVIRONMENT_ENV))).toEqual([]);
  });

  it("installs packages but cannot limit a container's network", () => {
    const provisioner = newDockerSandboxProvisioner({
      config,
      logger: createLogger({ level: "error", pretty: false, write: () => {} }),
    });
    expect(provisioner.environmentSupport).toEqual({
      limitedNetworking: false,
      packages: true,
    });
  });
});
