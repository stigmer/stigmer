import { describe, it, expect } from "vitest";
import { buildShellEnv, SHELL_ENV_DENYLIST, shellRunValues } from "../shell-env.js";
import type { RunValues } from "../run-values.js";
import { RUNNER_CREDENTIAL_ENV_KEYS } from "../runner-credential-keys.js";

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

  it("overlays the run values on top of the base env", () => {
    const base = { PATH: "/usr/bin", PLATFORM_CLI: "old" };
    const env = buildShellEnv({ PLATFORM_CLI: "planton", API_URL: "https://api.test" }, base);

    expect(env.PATH).toBe("/usr/bin");
    expect(env.PLATFORM_CLI).toBe("planton");
    expect(env.API_URL).toBe("https://api.test");
  });

  it("lets mergedEnvVars override a runtime-rotated STIGMER_TOKEN in base", () => {
    const base = { STIGMER_TOKEN: "rotated-runner-token", PATH: "/bin" };
    const env = buildShellEnv({ STIGMER_TOKEN: "agent-declared-token" }, base);

    expect(env.STIGMER_TOKEN).toBe("agent-declared-token");
  });

  it("drops undefined base values", () => {
    const base = { DEFINED: "yes", UNDEFINED: undefined };
    const env = buildShellEnv({}, base as NodeJS.ProcessEnv);

    expect(env.DEFINED).toBe("yes");
    expect(env.UNDEFINED).toBeUndefined();
  });
});

describe("shellRunValues", () => {
  // A run whose fetch answered the agent's own key, a Linear tool's login
  // and env key, and a repository's token: each in its declarer's group.
  const RUN_VALUES: RunValues = {
    agent: { AGENT_KEY: "agent-secret" },
    tools: new Map([
      ["mcp_linear", { url: "https://mcp.linear.app/mcp", values: { LINEAR_TOKEN: "mcp-only-token", LINEAR_OAUTH_TOKEN: "oauth-access-token" } }],
    ]),
    repositories: [{ name: "app", url: "https://github.com/acme/app", token: "ghp-run" }],
  };

  it("gives the shell the agent's own group as delivered, and nothing a tool or a clone holds", () => {
    expect(shellRunValues(RUN_VALUES)).toEqual({ AGENT_KEY: "agent-secret" });
  });

  it("holds a tool's key even when that tool did not resolve this turn: the key was never the agent's", () => {
    // The skipped server's keys live only in its own group, so whether the
    // runner reaches that server changes nothing about the shell.
    const values = shellRunValues(RUN_VALUES);
    expect(values).not.toHaveProperty("LINEAR_TOKEN");
    expect(values).not.toHaveProperty("LINEAR_OAUTH_TOKEN");
  });

  it("never holds a repository's token: an agent whose shell runs gh saves a GITHUB_TOKEN secret", () => {
    expect(shellRunValues(RUN_VALUES)).not.toHaveProperty("GITHUB_TOKEN");
    expect(shellRunValues({ agent: { GITHUB_TOKEN: "ghp-secret" } })).toEqual({ GITHUB_TOKEN: "ghp-secret" });
  });

  it("an agent the fetch gave nothing gets no run values", () => {
    expect(shellRunValues({ agent: {} })).toEqual({});
  });

  it("returns a copy the caller may change without touching the run's values", () => {
    const values = shellRunValues(RUN_VALUES);
    values.AGENT_KEY = "changed";
    expect(RUN_VALUES.agent.AGENT_KEY).toBe("agent-secret");
  });
});
