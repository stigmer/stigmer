/**
 * Pins one docker sandbox's `docker run` (docker.ts, buildDockerRun) with
 * no Docker: the label and env contract in argv, the operator's plain
 * runner settings by value, and every credential (the token, the Temporal
 * connection settings, the operator's runner secrets) as a value-less
 * `--env NAME` whose value only the CLI's environment holds.
 */
import { describe, expect, it } from "vitest";

import { buildDockerRun } from "../docker.js";
import { sandboxBaseName } from "../naming.js";
import type { SandboxDriverConfig } from "../provisioner.js";
import { runnerCommand } from "../runner-launch.js";

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
    expect(args.slice(-3)).toEqual([
      "ghcr.io/stigmer/runner:latest",
      ...runnerCommand(),
    ]);
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
      "workflow",
      "wex_1",
      { ...env, taskQueue: "wfexec:wex_1", stigmerToken: "" },
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
