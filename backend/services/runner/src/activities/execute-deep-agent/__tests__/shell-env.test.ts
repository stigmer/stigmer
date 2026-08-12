import { describe, it, expect } from "vitest";
import { buildShellEnv, SHELL_ENV_DENYLIST } from "../shell-env.js";
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
