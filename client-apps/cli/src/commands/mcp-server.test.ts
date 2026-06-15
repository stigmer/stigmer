import { describe, expect, it } from "vitest";
import type { Config } from "../config/config.js";
import { applyConfigEnv, applyFlagsEnv } from "./mcp-server.js";

describe("applyConfigEnv", () => {
  it("points a local backend at the local server", () => {
    const env: NodeJS.ProcessEnv = {};
    applyConfigEnv({ backend: { type: "local" } }, env);
    expect(env.STIGMER_SERVER_ADDRESS).toBe("localhost:7234");
    expect(env.STIGMER_API_KEY).toBeUndefined();
  });

  it("contributes the cloud endpoint and token", () => {
    const env: NodeJS.ProcessEnv = {};
    const config: Config = {
      backend: { type: "cloud", cloud: { endpoint: "api.stigmer.ai:443", token: "tok-123" } },
    };
    applyConfigEnv(config, env);
    expect(env.STIGMER_SERVER_ADDRESS).toBe("api.stigmer.ai:443");
    expect(env.STIGMER_API_KEY).toBe("tok-123");
  });

  it("never overrides a value already present in the environment", () => {
    const env: NodeJS.ProcessEnv = { STIGMER_SERVER_ADDRESS: "preset:7234" };
    applyConfigEnv({ backend: { type: "local" } }, env);
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
