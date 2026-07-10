import { afterEach, describe, expect, it } from "vitest";
import { CliExitError } from "../errors/index.js";
import type { Config } from "./config.js";
import {
  DEFAULT_CLOUD_CONSOLE_URL,
  ensureAuthenticated,
  resolveConsoleURL,
  resolveContextOrganization,
  resolveEndpoint,
  resolveOrganization,
  resolveToken,
} from "./resolve.js";

const ENV_KEYS = ["STIGMER_SERVER_ADDRESS", "STIGMER_API_KEY", "STIGMER_ORG_ID"] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

function cloudConfig(overrides: Partial<Config["backend"]["cloud"]> = {}): Config {
  return { backend: { type: "cloud", cloud: { endpoint: "cloud.example:443", ...overrides } } };
}

describe("resolveEndpoint", () => {
  it("defaults to the local daemon address in local mode", () => {
    expect(resolveEndpoint({ backend: { type: "local" } })).toBe("localhost:7234");
  });

  it("uses the cloud default when no endpoint is configured", () => {
    expect(resolveEndpoint({ backend: { type: "cloud" } })).toBe("api.stigmer.ai:443");
  });

  it("prefers the configured cloud endpoint", () => {
    expect(resolveEndpoint(cloudConfig())).toBe("cloud.example:443");
  });

  it("lets STIGMER_SERVER_ADDRESS override everything", () => {
    process.env.STIGMER_SERVER_ADDRESS = "override:7234";
    expect(resolveEndpoint(cloudConfig())).toBe("override:7234");
  });
});

describe("resolveToken", () => {
  it("prefers STIGMER_API_KEY over the config token", () => {
    process.env.STIGMER_API_KEY = "env-key";
    expect(resolveToken(cloudConfig({ token: "config-token" }))).toBe("env-key");
  });

  it("falls back to the config token", () => {
    expect(resolveToken(cloudConfig({ token: "config-token" }))).toBe("config-token");
  });

  it("returns empty string when unauthenticated", () => {
    expect(resolveToken({ backend: { type: "cloud" } })).toBe("");
  });
});

describe("resolveOrganization", () => {
  it("prefers the --org flag override", () => {
    process.env.STIGMER_ORG_ID = "env-org";
    const config = cloudConfig({ org_id: "config-org" });
    expect(resolveOrganization(config, "flag-org")).toBe("flag-org");
  });

  it("falls back to STIGMER_ORG_ID, then context, then cloud org_id", () => {
    process.env.STIGMER_ORG_ID = "env-org";
    expect(resolveOrganization(cloudConfig({ org_id: "config-org" }))).toBe("env-org");
  });

  it("uses context organization when no flag/env is set", () => {
    const config: Config = {
      backend: { type: "cloud", cloud: { org_id: "legacy" } },
      context: { organization: "ctx-org" },
    };
    expect(resolveOrganization(config)).toBe("ctx-org");
    expect(resolveContextOrganization(config)).toBe("ctx-org");
  });

  it("falls back to legacy cloud org_id", () => {
    expect(resolveContextOrganization(cloudConfig({ org_id: "legacy" }))).toBe("legacy");
  });

  it("defaults to the seedpack org in local mode when nothing is configured", () => {
    expect(resolveOrganization({ backend: { type: "local" } })).toBe("stigmer");
  });

  it("prefers an explicit context org over the local default", () => {
    const config: Config = { backend: { type: "local" }, context: { organization: "my-local-org" } };
    expect(resolveOrganization(config)).toBe("my-local-org");
  });

  it("does not apply the local default in cloud mode (org stays empty)", () => {
    expect(resolveOrganization({ backend: { type: "cloud" } })).toBe("");
  });

  it("reports an unset local org as empty via resolveContextOrganization (no implicit default)", () => {
    // The implicit local default lives only in resolveOrganization (effective
    // org for operations); the context query must stay faithful so config/context
    // display can show "(not set)".
    expect(resolveContextOrganization({ backend: { type: "local" } })).toBe("");
  });
});

describe("resolveConsoleURL", () => {
  it("prefers the STIGMER_CONSOLE_URL override", () => {
    expect(resolveConsoleURL("cloud", { STIGMER_CONSOLE_URL: "https://console.example" } as NodeJS.ProcessEnv)).toBe(
      "https://console.example",
    );
  });

  it("uses the local web-console port for the local backend", () => {
    expect(resolveConsoleURL("local", {} as NodeJS.ProcessEnv)).toBe("http://localhost:8234");
  });

  it("uses the cloud console URL for the cloud backend", () => {
    expect(resolveConsoleURL("cloud", {} as NodeJS.ProcessEnv)).toBe(DEFAULT_CLOUD_CONSOLE_URL);
  });
});

describe("ensureAuthenticated", () => {
  it("never requires auth in local mode", () => {
    expect(() => ensureAuthenticated({ backend: { type: "local" } })).not.toThrow();
  });

  it("throws in cloud mode with no credentials", () => {
    expect(() => ensureAuthenticated(cloudConfig())).toThrow(CliExitError);
  });

  it("passes with a stored access token", () => {
    expect(() => ensureAuthenticated(cloudConfig({ token: "t" }))).not.toThrow();
  });

  it("passes with only a refresh token", () => {
    expect(() => ensureAuthenticated(cloudConfig({ refresh_token: "r" }))).not.toThrow();
  });

  it("passes with STIGMER_API_KEY set", () => {
    process.env.STIGMER_API_KEY = "env-key";
    expect(() => ensureAuthenticated(cloudConfig())).not.toThrow();
  });
});
