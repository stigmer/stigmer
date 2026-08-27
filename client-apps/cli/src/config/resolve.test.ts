// Pins the effective-value resolvers over the named-backend model (O3):
// env > active entry > defaults for endpoint/token/org/console-URL, the
// selfhost credential lane (api_key), and the auth gate's three postures
// (local never, selfhost never client-side, cloud requires a credential).

import { afterEach, describe, expect, it } from "vitest";
import { CliExitError } from "../errors/index.js";
import type { Config, NamedBackendConfig } from "./config.js";
import {
  DEFAULT_CLOUD_CONSOLE_URL,
  ensureAuthenticated,
  resolveConsoleURL,
  resolveContextOrganization,
  resolveEndpoint,
  resolveOrganization,
  resolveToken,
} from "./resolve.js";

const ENV_KEYS = [
  "STIGMER_SERVER_ADDRESS",
  "STIGMER_API_KEY",
  "STIGMER_ORG_ID",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

function localConfig(context?: Config["context"]): Config {
  return {
    backend: { type: "local" },
    backends: {},
    current_backend: "local",
    context,
  };
}

function cloudConfig(
  overrides: Partial<NamedBackendConfig> = {},
  context?: Config["context"],
): Config {
  return {
    backend: { type: "cloud" },
    backends: {
      cloud: { type: "cloud", endpoint: "cloud.example:443", ...overrides },
    },
    current_backend: "cloud",
    context,
  };
}

function selfhostConfig(overrides: Partial<NamedBackendConfig> = {}): Config {
  return {
    backend: { type: "cloud" },
    backends: {
      staging: {
        type: "selfhost",
        endpoint: "stigmer.example.com:7234",
        ...overrides,
      },
    },
    current_backend: "staging",
  };
}

describe("resolveEndpoint", () => {
  it("defaults to the local daemon address in local mode", () => {
    expect(resolveEndpoint(localConfig())).toBe("localhost:7234");
  });

  it("uses the cloud default when no endpoint is configured", () => {
    expect(resolveEndpoint(cloudConfig({ endpoint: undefined }))).toBe(
      "api.stigmer.ai:443",
    );
  });

  it("prefers the configured cloud endpoint", () => {
    expect(resolveEndpoint(cloudConfig())).toBe("cloud.example:443");
  });

  it("uses the selfhost entry's endpoint", () => {
    expect(resolveEndpoint(selfhostConfig())).toBe("stigmer.example.com:7234");
  });

  it("refuses a selfhost entry without an endpoint (hand-edited config)", () => {
    expect(() =>
      resolveEndpoint(selfhostConfig({ endpoint: undefined })),
    ).toThrow(CliExitError);
  });

  it("lets STIGMER_SERVER_ADDRESS override everything", () => {
    process.env.STIGMER_SERVER_ADDRESS = "override:7234";
    expect(resolveEndpoint(cloudConfig())).toBe("override:7234");
  });
});

describe("resolveToken", () => {
  it("prefers STIGMER_API_KEY over the config token", () => {
    process.env.STIGMER_API_KEY = "env-key";
    expect(resolveToken(cloudConfig({ token: "config-token" }))).toBe(
      "env-key",
    );
  });

  it("falls back to the cloud entry's login token", () => {
    expect(resolveToken(cloudConfig({ token: "config-token" }))).toBe(
      "config-token",
    );
  });

  it("uses the selfhost entry's api_key", () => {
    expect(resolveToken(selfhostConfig({ api_key: "stk_stored" }))).toBe(
      "stk_stored",
    );
  });

  it("returns empty string when unauthenticated", () => {
    expect(resolveToken(cloudConfig({ endpoint: undefined }))).toBe("");
    expect(resolveToken(selfhostConfig())).toBe("");
    expect(resolveToken(localConfig())).toBe("");
  });
});

describe("resolveOrganization", () => {
  it("prefers the --org flag override", () => {
    process.env.STIGMER_ORG_ID = "env-org";
    const config = cloudConfig({ org_id: "config-org" });
    expect(resolveOrganization(config, "flag-org")).toBe("flag-org");
  });

  it("falls back to STIGMER_ORG_ID, then context, then the entry's org_id", () => {
    process.env.STIGMER_ORG_ID = "env-org";
    expect(resolveOrganization(cloudConfig({ org_id: "config-org" }))).toBe(
      "env-org",
    );
  });

  it("uses context organization when no flag/env is set", () => {
    const config = cloudConfig(
      { org_id: "legacy" },
      { organization: "ctx-org" },
    );
    expect(resolveOrganization(config)).toBe("ctx-org");
    expect(resolveContextOrganization(config)).toBe("ctx-org");
  });

  it("falls back to the entry's org_id", () => {
    expect(resolveContextOrganization(cloudConfig({ org_id: "legacy" }))).toBe(
      "legacy",
    );
  });

  it("defaults to the seedpack org in local mode when nothing is configured", () => {
    expect(resolveOrganization(localConfig())).toBe("stigmer");
  });

  it("defaults to the seedpack org on a selfhost backend (it IS the OSS server)", () => {
    expect(resolveOrganization(selfhostConfig())).toBe("stigmer");
  });

  it("prefers an explicit context org over the local default", () => {
    expect(
      resolveOrganization(localConfig({ organization: "my-local-org" })),
    ).toBe("my-local-org");
  });

  it("does not apply the local default in cloud mode (org stays empty)", () => {
    expect(resolveOrganization(cloudConfig({ endpoint: undefined }))).toBe("");
  });

  it("reports an unset local org as empty via resolveContextOrganization (no implicit default)", () => {
    // The implicit local default lives only in resolveOrganization (effective
    // org for operations); the context query must stay faithful so config/context
    // display can show "(not set)".
    expect(resolveContextOrganization(localConfig())).toBe("");
  });
});

describe("resolveConsoleURL", () => {
  it("prefers the STIGMER_CONSOLE_URL override", () => {
    expect(
      resolveConsoleURL(cloudConfig(), {
        STIGMER_CONSOLE_URL: "https://console.example",
      } as NodeJS.ProcessEnv),
    ).toBe("https://console.example");
  });

  it("uses the local web-console port for the local backend", () => {
    expect(resolveConsoleURL(localConfig(), {} as NodeJS.ProcessEnv)).toBe(
      "http://localhost:7234",
    );
  });

  it("uses the cloud console URL for the cloud backend", () => {
    expect(resolveConsoleURL(cloudConfig(), {} as NodeJS.ProcessEnv)).toBe(
      DEFAULT_CLOUD_CONSOLE_URL,
    );
  });

  it("derives the selfhost console from the entry's endpoint (one-origin rule)", () => {
    expect(resolveConsoleURL(selfhostConfig(), {} as NodeJS.ProcessEnv)).toBe(
      "http://stigmer.example.com:7234",
    );
    expect(
      resolveConsoleURL(
        selfhostConfig({ endpoint: "stigmer.example.com:443" }),
        {} as NodeJS.ProcessEnv,
      ),
    ).toBe("https://stigmer.example.com");
  });
});

describe("ensureAuthenticated", () => {
  it("never requires auth in local mode", () => {
    expect(() => ensureAuthenticated(localConfig())).not.toThrow();
  });

  it("never gates selfhost client-side (the server owns that decision)", () => {
    expect(() => ensureAuthenticated(selfhostConfig())).not.toThrow();
  });

  it("throws in cloud mode with no credentials", () => {
    expect(() => ensureAuthenticated(cloudConfig())).toThrow(CliExitError);
  });

  it("passes with a stored access token", () => {
    expect(() =>
      ensureAuthenticated(cloudConfig({ token: "t" })),
    ).not.toThrow();
  });

  it("passes with only a refresh token (silent refresh will mint one)", () => {
    expect(() =>
      ensureAuthenticated(cloudConfig({ refresh_token: "r" })),
    ).not.toThrow();
  });

  it("passes with STIGMER_API_KEY in the environment", () => {
    process.env.STIGMER_API_KEY = "stk_env";
    expect(() => ensureAuthenticated(cloudConfig())).not.toThrow();
  });
});
