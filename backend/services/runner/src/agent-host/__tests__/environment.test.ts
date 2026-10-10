/**
 * The agent host's environment (`agent-host/environment.ts`): what every
 * process the agent's turn starts in the host inherits.
 *
 * Pinned: no name of the runner's secrets ever reaches it, even one planted
 * in the runner's environment after the boot capture; on a runner that does
 * not separate, everything else the agent's tools have always seen passes
 * unchanged (the operator's settings, a local user's own environment); on a
 * separating runner only the allow-list passes, a cloud credential never,
 * and the operator's pass-through names too.
 */

import { describe, expect, it } from "vitest";

import { RUNNER_SECRET_ENV_KEYS } from "../../shared/runner-credential-keys.js";
import { agentHostEnvironment } from "../environment.js";

describe("the agent host's environment", () => {
  it("carries none of the runner's secrets, whatever the runner's environment holds", () => {
    const planted = Object.fromEntries(RUNNER_SECRET_ENV_KEYS.map((name) => [name, `canary-${name}`]));
    for (const separating of [false, true]) {
      const env = agentHostEnvironment({ ...planted, PATH: "/usr/bin", HOME: "/home/user" }, separating);
      for (const name of RUNNER_SECRET_ENV_KEYS) expect(env[name], name).toBeUndefined();
      expect(JSON.stringify(env)).not.toContain("canary-");
    }
  });

  it("passes everything else the agent's tools have always seen", () => {
    const runner = { PATH: "/usr/bin", HOME: "/home/user", HTTPS_PROXY: "http://proxy:3128", AWS_PROFILE: "dev", NPM_CONFIG_REGISTRY: "https://registry.internal" };
    expect(agentHostEnvironment(runner, false)).toEqual(runner);
  });

  it("passes only the allow-list on a runner that starts its host as the agent user", () => {
    const runner = {
      PATH: "/usr/bin",
      HOME: "/root",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      HTTPS_PROXY: "http://proxy:3128",
      CURSOR_STREAM_STALL_TIMEOUT_MS: "1000",
      STIGMER_RUNNER_LAYER: "1",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel:4318",
      NODE_OPTIONS: "--max-old-space-size=2048",
      AWS_ACCESS_KEY_ID: "AKIA-canary",
      AWS_SECRET_ACCESS_KEY: "aws-canary",
      GOOGLE_APPLICATION_CREDENTIALS: "/secrets/gcp.json",
      AZURE_CLIENT_SECRET: "azure-canary",
      KUBERNETES_SERVICE_HOST: "10.0.0.1",
      PIP_INDEX_URL: "https://pypi.internal",
      STIGMER_AGENT_ENV_PASSTHROUGH: "PIP_INDEX_URL, ",
    };
    expect(agentHostEnvironment(runner, true)).toEqual({
      PATH: "/usr/bin",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      HTTPS_PROXY: "http://proxy:3128",
      CURSOR_STREAM_STALL_TIMEOUT_MS: "1000",
      STIGMER_RUNNER_LAYER: "1",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel:4318",
      NODE_OPTIONS: "--max-old-space-size=2048",
      PIP_INDEX_URL: "https://pypi.internal",
      STIGMER_AGENT_ENV_PASSTHROUGH: "PIP_INDEX_URL, ",
    });
  });
});
