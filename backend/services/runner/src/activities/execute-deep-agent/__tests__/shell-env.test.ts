import { describe, it, expect } from "vitest";
import { buildShellEnv, SHELL_ENV_DENYLIST, shellRunValues } from "../shell-env.js";
import type { ProvisionResult } from "../../../shared/workspace/types.js";
import { RUNNER_CREDENTIAL_ENV_KEYS } from "../../../shared/runner-credential-keys.js";

describe("buildShellEnv", () => {
  it("strips every runner credential from the base env", () => {
    // Plant a value for every name in the source-of-truth list, so a key
    // added to runner-credential-keys.ts is covered here automatically.
    const base: NodeJS.ProcessEnv = { PATH: "/usr/bin", HOME: "/home/runner" };
    for (const key of RUNNER_CREDENTIAL_ENV_KEYS) {
      base[key] = `leaked-${key}`;
    }

    const env = buildShellEnv({}, base);

    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/runner");
    for (const key of RUNNER_CREDENTIAL_ENV_KEYS) {
      expect(env[key], `runner credential '${key}' must not reach the shell env`).toBeUndefined();
    }
  });

  it("denies the full credential list, not just the original three (issue #385)", () => {
    // Pins the five names #385 added. The parameterized test above would
    // pass even if the list regressed to three; this one cannot.
    for (const key of [
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "STIGMER_AUTH_TOKEN",
      "ANTHROPIC_FOUNDRY_API_KEY",
      "AWS_BEARER_TOKEN_BEDROCK",
    ]) {
      expect(SHELL_ENV_DENYLIST, `'${key}' must be in the shell denylist`).toContain(key);
    }
  });

  it("overlays ExecutionContext vars on top of the base env", () => {
    const base = { PATH: "/usr/bin", PLATFORM_CLI: "old" };
    const env = buildShellEnv({ PLATFORM_CLI: "planton", API_URL: "https://api.test" }, base);

    expect(env.PATH).toBe("/usr/bin");
    expect(env.PLATFORM_CLI).toBe("planton");
    expect(env.API_URL).toBe("https://api.test");
  });

  it("lets mergedEnvVars override a runtime-rotated STIGMER_TOKEN in base", () => {
    const base = { STIGMER_TOKEN: "rotated-runner-token", PATH: "/bin" };
    const env = buildShellEnv({ STIGMER_TOKEN: "execution-context-token" }, base);

    expect(env.STIGMER_TOKEN).toBe("execution-context-token");
  });

  it("drops undefined base values", () => {
    const base = { DEFINED: "yes", UNDEFINED: undefined };
    const env = buildShellEnv({}, base as NodeJS.ProcessEnv);

    expect(env.DEFINED).toBe("yes");
    expect(env.UNDEFINED).toBeUndefined();
  });
});

describe("shellRunValues", () => {
  const RUN_VALUES = {
    AGENT_KEY: "agent-secret",
    LINEAR_TOKEN: "mcp-only-token",
    LINEAR_OAUTH_TOKEN: "oauth-access-token",
    GITHUB_TOKEN: "ghp-run",
    WORKSPACE_PROVISION_DEPLOY_KEY: "provision-only",
  };
  const NO_SERVERS: readonly { declaredEnvKeys: readonly string[] }[] = [];

  function gitResult(consumedKeys: readonly string[]): ProvisionResult {
    return {
      rootDir: "/ws",
      sourceType: "git_repo",
      consumedKeys,
      workspaceDescription: "a clone",
      entryName: "",
    };
  }

  it("gives the shell only the keys the agent declares, never a key only an MCP server declares", () => {
    expect(shellRunValues(RUN_VALUES, { AGENT_KEY: {} }, NO_SERVERS, [])).toEqual({
      AGENT_KEY: "agent-secret",
    });
  });

  it("withholds every key an MCP server of the run claims, though agent save copied it into the agent's env", () => {
    // Agent save merges its servers' declarations into agent.spec.env, so
    // the agent's env lists the server's key and its OAuth target too.
    const agentEnv = { AGENT_KEY: {}, LINEAR_TOKEN: {}, LINEAR_OAUTH_TOKEN: {} };
    const linear = { declaredEnvKeys: ["LINEAR_TOKEN", "LINEAR_OAUTH_TOKEN"] };
    expect(shellRunValues(RUN_VALUES, agentEnv, [linear], [])).toEqual({
      AGENT_KEY: "agent-secret",
    });
  });

  it("an agent that declares nothing gets no run values; the built-in assistant (no agent) neither", () => {
    expect(shellRunValues(RUN_VALUES, {}, NO_SERVERS, [])).toEqual({});
    expect(shellRunValues(RUN_VALUES, undefined, NO_SERVERS, [])).toEqual({});
  });

  it("adds the token a git clone consumed, which the clone already left in the shell's reach", () => {
    expect(
      shellRunValues(RUN_VALUES, undefined, NO_SERVERS, [
        gitResult(["GITHUB_TOKEN", "WORKSPACE_PROVISION_DEPLOY_KEY"]),
      ]),
    ).toEqual({ GITHUB_TOKEN: "ghp-run" });
  });

  it("adds no token when no git source consumed it, and never a provisioning-only key", () => {
    expect(shellRunValues(RUN_VALUES, { AGENT_KEY: {} }, NO_SERVERS, [gitResult([])])).toEqual({
      AGENT_KEY: "agent-secret",
    });
    expect(
      shellRunValues(RUN_VALUES, undefined, NO_SERVERS, [
        { ...gitResult(["GITHUB_TOKEN"]), sourceType: "local_path" },
      ]),
    ).toEqual({});
  });

  it("an agent that declares GITHUB_TOKEN gets it whatever the workspace", () => {
    expect(shellRunValues(RUN_VALUES, { GITHUB_TOKEN: {} }, NO_SERVERS, [])).toEqual({
      GITHUB_TOKEN: "ghp-run",
    });
  });
});
