import { describe, it, expect } from "vitest";
import { buildShellEnv, SHELL_ENV_DENYLIST } from "../shell-env.js";

describe("buildShellEnv", () => {
  it("strips runner-internal credentials from the base env", () => {
    const base = {
      PATH: "/usr/bin",
      HOME: "/home/runner",
      STIGMER_RUNNER_HITL_SECRET: "secret",
      CURSOR_API_KEY: "cursor-key",
      STIGMER_TOKEN: "stigmer-token",
    };

    const env = buildShellEnv({}, base);

    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/runner");
    for (const key of SHELL_ENV_DENYLIST) {
      expect(env[key]).toBeUndefined();
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
