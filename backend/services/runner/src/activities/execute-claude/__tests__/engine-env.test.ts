/**
 * Pins the Claude engine's whole environment (`engine-env.ts`) as a golden:
 * the exact variable names and values, nothing more.
 *
 * The SDK hands the engine exactly this record and never merges the host's,
 * so the record IS the engine's environment. The golden is the guard: a new
 * variable (a provider key, a Stigmer token, `ANTHROPIC_AUTH_TOKEN`, a
 * `process.env` spread) changes the key set and fails here, and the one
 * credential the engine holds is proven to be the turn's own key at the
 * runner's proxy.
 */

import { describe, it, expect, afterEach } from "vitest";

import { DEFAULT_MAX_CONCURRENT } from "../../../shared/subagent-gate.js";
import { CLAUDE_CLIENT_APP, ENGINE_SWITCHES, engineEnvironment, type EngineEnvironmentInputs } from "../engine-env.js";

const INPUTS: EngineEnvironmentInputs = {
  home: "/sessions/ses_1/claude/inv_1",
  anthropicBaseUrl: "http://127.0.0.1:43111/anthropic",
  turnKey: "turn-key-abc",
  projectKey: "ses_1",
  path: "/usr/local/bin:/usr/bin:/bin",
};

const GOLDEN: Record<string, string> = {
  PATH: "/usr/local/bin:/usr/bin:/bin",
  HOME: "/sessions/ses_1/claude/inv_1",
  CLAUDE_CONFIG_DIR: "/sessions/ses_1/claude/inv_1",
  CLAUDE_CODE_PROJECT_DIR_NAME: "ses_1",
  ANTHROPIC_BASE_URL: "http://127.0.0.1:43111/anthropic",
  ANTHROPIC_API_KEY: "turn-key-abc",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  DISABLE_AUTOUPDATER: "1",
  CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS: "1",
  CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
  CLAUDE_CODE_DISABLE_WEB_FETCH: "1",
  CLAUDE_CODE_ENABLE_TASKS: "0",
  CLAUDE_CODE_FORK_SUBAGENT: "0",
  CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: "1",
  CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "3",
  CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1",
  CLAUDE_AGENT_SDK_CLIENT_APP: "stigmer-runner",
};

const PLANTED = ["ANTHROPIC_AUTH_TOKEN", "STIGMER_TOKEN", "OPENAI_API_KEY", "CLAUDE_TEST_LEAK_PROBE"] as const;

afterEach(() => {
  for (const name of PLANTED) delete process.env[name];
});

describe("the engine's environment", () => {
  it("is exactly the golden: every name and value, nothing more", () => {
    expect(engineEnvironment(INPUTS)).toEqual(GOLDEN);
    expect(Object.keys(engineEnvironment(INPUTS)).sort()).toEqual(Object.keys(GOLDEN).sort());
  });

  it("carries the turn's key as its one credential, never ANTHROPIC_AUTH_TOKEN", () => {
    const env = engineEnvironment(INPUTS);
    expect(env.ANTHROPIC_API_KEY).toBe(INPUTS.turnKey);
    expect(env).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
    const credentialNames = Object.keys(env).filter((name) => /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(name));
    expect(credentialNames).toEqual(["ANTHROPIC_API_KEY"]);
  });

  it("leaks nothing of the host's process environment, even a host token planted in it", () => {
    process.env.ANTHROPIC_AUTH_TOKEN = "host-oauth-token";
    process.env.STIGMER_TOKEN = "host-stigmer-token";
    process.env.OPENAI_API_KEY = "host-openai-key";
    process.env.CLAUDE_TEST_LEAK_PROBE = "leak";
    const env = engineEnvironment(INPUTS);
    expect(env).toEqual(GOLDEN);
    for (const value of Object.values(env)) {
      expect(["host-oauth-token", "host-stigmer-token", "host-openai-key", "leak"]).not.toContain(value);
    }
  });

  it("homes the engine and its configuration in the invocation's directory", () => {
    const env = engineEnvironment({ ...INPUTS, home: "/elsewhere" });
    expect(env.HOME).toBe("/elsewhere");
    expect(env.CLAUDE_CONFIG_DIR).toBe("/elsewhere");
  });

  it("names the runner as the client app and exports the switches it turns on", () => {
    expect(CLAUDE_CLIENT_APP).toBe("stigmer-runner");
    expect(ENGINE_SWITCHES).toEqual(
      Object.fromEntries(
        Object.entries(GOLDEN).filter(([name]) => !["PATH", "HOME", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_PROJECT_DIR_NAME", "ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "CLAUDE_AGENT_SDK_CLIENT_APP"].includes(name)),
      ),
    );
  });

  it("caps concurrent sub-agents at the Stigmer harness's own number", () => {
    expect(ENGINE_SWITCHES.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS).toBe(String(DEFAULT_MAX_CONCURRENT));
  });

  it("lets no switch override an input-derived variable", () => {
    const inputNames = ["PATH", "HOME", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_PROJECT_DIR_NAME", "ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "CLAUDE_AGENT_SDK_CLIENT_APP"];
    for (const name of inputNames) expect(ENGINE_SWITCHES).not.toHaveProperty(name);
  });
});
