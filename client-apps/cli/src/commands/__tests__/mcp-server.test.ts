// Unit tests for how `stigmer mcp-server` bridges CLI configuration into the
// embedded server's environment (commands/mcp-server.ts). Pinned: the active
// named backend supplies the endpoint and its credential (a cloud login's token,
// a self-hosted entry's API key), read from a config file as `stigmer auth login`
// writes it; the local daemon gets its fixed address and no credential; a value
// already in the environment or set by a flag always wins.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Config, getDefault, load, save } from "../../config/config.js";
import { applyConfigEnv, applyFlagsEnv } from "../mcp-server.js";

/** Save a config the way the CLI's own commands do, then read it back from disk. */
function roundTrip(config: Config): Config {
  const dir = mkdtempSync(join(tmpdir(), "stigmer-mcp-config-"));
  try {
    const path = join(dir, "config.yaml");
    save(config, path);
    return load(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("applyConfigEnv", () => {
  it("points a local backend at the local server", () => {
    const env: NodeJS.ProcessEnv = {};
    applyConfigEnv(getDefault(), env);
    expect(env.STIGMER_SERVER_ADDRESS).toBe("localhost:7234");
    expect(env.STIGMER_API_KEY).toBeUndefined();
  });

  it("bridges the signed-in cloud backend's endpoint and token from the saved config", () => {
    const signedIn = getDefault();
    signedIn.backends = {
      cloud: { type: "cloud", endpoint: "api.stigmer.ai:443", token: "tok-cloud" },
    };
    signedIn.current_backend = "cloud";
    const env: NodeJS.ProcessEnv = {};
    applyConfigEnv(roundTrip(signedIn), env);
    expect(env.STIGMER_SERVER_ADDRESS).toBe("api.stigmer.ai:443");
    expect(env.STIGMER_API_KEY).toBe("tok-cloud");
  });

  it("bridges a self-hosted backend's endpoint and API key from the saved config", () => {
    const selfHosted = getDefault();
    selfHosted.backends = {
      staging: { type: "selfhost", endpoint: "stigmer.example.com:7234", api_key: "stk_x" },
    };
    selfHosted.current_backend = "staging";
    const env: NodeJS.ProcessEnv = {};
    applyConfigEnv(roundTrip(selfHosted), env);
    expect(env.STIGMER_SERVER_ADDRESS).toBe("stigmer.example.com:7234");
    expect(env.STIGMER_API_KEY).toBe("stk_x");
  });

  it("never overrides a value already present in the environment", () => {
    const env: NodeJS.ProcessEnv = { STIGMER_SERVER_ADDRESS: "preset:7234" };
    applyConfigEnv(getDefault(), env);
    expect(env.STIGMER_SERVER_ADDRESS).toBe("preset:7234");
  });
});

describe("applyFlagsEnv", () => {
  it("maps every set flag to its environment variable", () => {
    const env: NodeJS.ProcessEnv = {};
    applyFlagsEnv(
      {
        transport: "http",
        port: "9090",
        serverAddress: "host:7234",
        apiKey: "key",
        logFormat: "json",
        logLevel: "debug",
      },
      env,
    );
    expect(env).toMatchObject({
      STIGMER_MCP_TRANSPORT: "http",
      STIGMER_MCP_HTTP_PORT: "9090",
      STIGMER_SERVER_ADDRESS: "host:7234",
      STIGMER_API_KEY: "key",
      STIGMER_MCP_LOG_FORMAT: "json",
      STIGMER_MCP_LOG_LEVEL: "debug",
    });
  });

  it("overrides config-derived values (flags win)", () => {
    const env: NodeJS.ProcessEnv = { STIGMER_SERVER_ADDRESS: "from-config:7234" };
    applyFlagsEnv({ serverAddress: "from-flag:7234" }, env);
    expect(env.STIGMER_SERVER_ADDRESS).toBe("from-flag:7234");
  });

  it("ignores unset flags", () => {
    const env: NodeJS.ProcessEnv = {};
    applyFlagsEnv({}, env);
    expect(Object.keys(env)).toHaveLength(0);
  });
});
