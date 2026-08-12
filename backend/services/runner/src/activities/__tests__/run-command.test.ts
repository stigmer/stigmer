/**
 * Env contract tests for the workflow `run` task (oss#384).
 *
 * These spawn REAL subprocesses through the RunShell / RunScript
 * activities and inspect the environment the child actually received —
 * the leak-reproduction style established by the #256 fix (PR #383).
 * Subprocess output is env variable NAMES only, never values.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRunCommandActivities } from "../run-command.js";
import { buildRunEnv, RUN_ENV_BASE_KEYS } from "../run-env.js";
import { RuntimePlaceholderResolutionError } from "../../workflow-engine/resolve.js";

/**
 * Credentials planted into the runner process env before each test.
 * Includes a name outside every known denylist to prove the contract
 * is declare-to-receive, not deny-known-names.
 */
const PLANTED_SENTINELS: Record<string, string> = {
  STIGMER_RUNNER_HITL_SECRET: "sentinel-hitl",
  STIGMER_TOKEN: "sentinel-token",
  CURSOR_API_KEY: "sentinel-cursor",
  ANTHROPIC_API_KEY: "sentinel-anthropic",
  OPERATOR_PRIVATE_CREDENTIAL: "sentinel-arbitrary",
};

const PRINT_ENV_KEYS_SHELL = `node -p 'JSON.stringify(Object.keys(process.env))'`;
const PRINT_ENV_KEYS_SCRIPT = `console.log(JSON.stringify(Object.keys(process.env)))`;

const activities = createRunCommandActivities();

async function childEnvKeysViaShell(
  environment?: Record<string, string>,
  runtimeEnv: Record<string, unknown> = {},
): Promise<string[]> {
  const stdout = await activities.RunShell({
    mode: "shell",
    command: PRINT_ENV_KEYS_SHELL,
    environment,
    runtimeEnv,
  });
  return JSON.parse(String(stdout)) as string[];
}

async function childEnvKeysViaScript(
  environment?: Record<string, string>,
  runtimeEnv: Record<string, unknown> = {},
): Promise<string[]> {
  const stdout = await activities.RunScript({
    mode: "script",
    language: "js",
    code: PRINT_ENV_KEYS_SCRIPT,
    environment,
    runtimeEnv,
  });
  return JSON.parse(String(stdout)) as string[];
}

describe("run task env contract (oss#384)", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const [key, value] of Object.entries(PLANTED_SENTINELS)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
  });

  afterEach(() => {
    for (const key of Object.keys(PLANTED_SENTINELS)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  describe("RunShell", () => {
    it("does not leak runner process credentials to the child", async () => {
      const keys = await childEnvKeysViaShell();

      for (const sentinel of Object.keys(PLANTED_SENTINELS)) {
        expect(keys, `runner credential "${sentinel}" leaked to shell child`)
          .not.toContain(sentinel);
      }
    });

    it("provides the minimal base env and the declared overlay", async () => {
      const keys = await childEnvKeysViaShell({ DECLARED_VAR: "value" });

      for (const base of RUN_ENV_BASE_KEYS) {
        if (process.env[base] !== undefined) {
          expect(keys, `base key "${base}" missing from shell child`).toContain(base);
        }
      }
      expect(keys).toContain("DECLARED_VAR");
    });

    it("resolves ${.secrets.KEY} placeholders in declared values just-in-time", async () => {
      const stdout = await activities.RunShell({
        mode: "shell",
        command: `node -p 'process.env.API_KEY'`,
        environment: { API_KEY: "${.secrets.TEST_API_KEY}" },
        runtimeEnv: { TEST_API_KEY: "resolved-secret-value" },
      });

      expect(stdout).toBe("resolved-secret-value");
    });

    it("fails non-retryably, naming the variable, when a placeholder key is missing", async () => {
      await expect(
        activities.RunShell({
          mode: "shell",
          command: "true",
          environment: { API_KEY: "${.secrets.NOT_PROVIDED}" },
          runtimeEnv: {},
        }),
      ).rejects.toMatchObject({
        nonRetryable: true,
        type: "RUN_ENV_UNRESOLVED_PLACEHOLDER",
        message: expect.stringContaining("NOT_PROVIDED"),
      });
    });
  });

  describe("RunScript", () => {
    it("does not leak runner process credentials to the child", async () => {
      const keys = await childEnvKeysViaScript();

      for (const sentinel of Object.keys(PLANTED_SENTINELS)) {
        expect(keys, `runner credential "${sentinel}" leaked to script child`)
          .not.toContain(sentinel);
      }
    });

    it("provides the minimal base env and the declared overlay", async () => {
      const keys = await childEnvKeysViaScript({ DECLARED_VAR: "value" });

      for (const base of RUN_ENV_BASE_KEYS) {
        if (process.env[base] !== undefined) {
          expect(keys, `base key "${base}" missing from script child`).toContain(base);
        }
      }
      expect(keys).toContain("DECLARED_VAR");
    });

    it("resolves ${.env_vars.KEY} placeholders in declared values just-in-time", async () => {
      const stdout = await activities.RunScript({
        mode: "script",
        language: "js",
        code: "console.log(process.env.REGION)",
        environment: { REGION: "${.env_vars.DEPLOY_REGION}" },
        runtimeEnv: { DEPLOY_REGION: "us-east-1" },
      });

      expect(stdout).toBe("us-east-1");
    });
  });
});

describe("buildRunEnv", () => {
  it("copies only the base keys present in the runner env", () => {
    const base = {
      PATH: "/usr/bin",
      HOME: "/home/runner",
      TERM: "xterm",
    };

    const env = buildRunEnv(undefined, {}, base);

    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/home/runner", TERM: "xterm" });
  });

  it("never copies undeclared runner variables — the oss#384 tripwire", () => {
    // Guards against a future reintroduction of `{ ...process.env }`:
    // credentials must be structurally absent, whatever their names.
    const base = {
      PATH: "/usr/bin",
      STIGMER_RUNNER_HITL_SECRET: "secret",
      ANY_FUTURE_CREDENTIAL: "secret",
    };

    const env = buildRunEnv({ DECLARED: "yes" }, {}, base);

    expect(Object.keys(env).sort()).toEqual(["DECLARED", "PATH"]);
  });

  it("lets a declared variable override a base variable", () => {
    const base = { PATH: "/usr/bin" };

    const env = buildRunEnv({ PATH: "/custom/bin" }, {}, base);

    expect(env.PATH).toBe("/custom/bin");
  });

  it("passes non-placeholder declared values through untouched", () => {
    const env = buildRunEnv(
      { LITERAL: "plain-value", TEMPLATED: "prefix-${.secrets.KEY}-suffix" },
      { KEY: "mid" },
      {},
    );

    expect(env.LITERAL).toBe("plain-value");
    expect(env.TEMPLATED).toBe("prefix-mid-suffix");
  });

  it("throws a named error for a missing placeholder key", () => {
    expect(() =>
      buildRunEnv({ API_KEY: "${.secrets.MISSING}" }, {}, {}),
    ).toThrowError(RuntimePlaceholderResolutionError);

    try {
      buildRunEnv({ API_KEY: "${.secrets.MISSING}" }, {}, {});
    } catch (err) {
      expect((err as RuntimePlaceholderResolutionError).variableName).toBe("MISSING");
      expect((err as Error).message).toContain('environment "API_KEY"');
    }
  });
});
