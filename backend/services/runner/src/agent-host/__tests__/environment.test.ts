/**
 * The agent host's environment (`agent-host/environment.ts`): what every
 * process the agent's turn starts in the host inherits.
 *
 * Pinned: no name of the runner's secrets ever reaches it, even one planted
 * in the runner's environment after the boot capture; everything else the
 * agent's tools have always seen passes unchanged (the operator's settings,
 * a local user's own environment).
 */

import { describe, expect, it } from "vitest";

import { RUNNER_SECRET_ENV_KEYS } from "../../shared/runner-credential-keys.js";
import { agentHostEnvironment } from "../environment.js";

describe("the agent host's environment", () => {
  it("carries none of the runner's secrets, whatever the runner's environment holds", () => {
    const planted = Object.fromEntries(RUNNER_SECRET_ENV_KEYS.map((name) => [name, `canary-${name}`]));
    const env = agentHostEnvironment({ ...planted, PATH: "/usr/bin", HOME: "/home/user" });

    for (const name of RUNNER_SECRET_ENV_KEYS) expect(env[name], name).toBeUndefined();
    expect(JSON.stringify(env)).not.toContain("canary-");
  });

  it("passes everything else the agent's tools have always seen", () => {
    const runner = { PATH: "/usr/bin", HOME: "/home/user", HTTPS_PROXY: "http://proxy:3128", AWS_PROFILE: "dev", NPM_CONFIG_REGISTRY: "https://registry.internal" };
    expect(agentHostEnvironment(runner)).toEqual(runner);
  });
});
