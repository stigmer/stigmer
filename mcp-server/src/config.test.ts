import { beforeAll, describe, expect, it } from "vitest";

import { loadConfigFromEnv, validateConfig, type Config } from "./config";
import { configureLogger } from "./logger";

// Quiet the soft-validation warnings during these tests.
beforeAll(() => configureLogger({ level: "error", format: "text" }));

/** Build a config from an isolated env (defaults applied; process.env ignored). */
function fromEnv(env: Record<string, string> = {}): Config {
  return loadConfigFromEnv(env);
}

describe("loadConfigFromEnv", () => {
  it("applies development defaults", () => {
    const c = fromEnv();
    expect(c.stigmerServerAddress).toBe("localhost:7234");
    expect(c.apiKey).toBe("");
    expect(c.transport).toBe("stdio");
    expect(c.httpPort).toBe("8080");
    expect(c.httpAuthEnabled).toBe(true);
    expect(c.logFormat).toBe("text");
    expect(c.logLevel).toBe("info");
    expect(c.oauth.enabled).toBe(false);
  });

  it("reads overrides and lowercases the transport", () => {
    const c = fromEnv({
      STIGMER_MCP_TRANSPORT: "HTTP",
      STIGMER_API_KEY: "sk_live",
      STIGMER_MCP_HTTP_AUTH_ENABLED: "false",
    });
    expect(c.transport).toBe("http");
    expect(c.apiKey).toBe("sk_live");
    expect(c.httpAuthEnabled).toBe(false);
  });

  it("only the exact string 'true' enables boolean flags (Go parity)", () => {
    expect(fromEnv({ STIGMER_MCP_HTTP_AUTH_ENABLED: "TRUE" }).httpAuthEnabled).toBe(false);
    expect(fromEnv({ STIGMER_MCP_OAUTH_ENABLED: "1" }).oauth.enabled).toBe(false);
  });

  it("parses comma-separated lists, dropping blanks", () => {
    const c = fromEnv({
      STIGMER_MCP_OAUTH_ENABLED: "true",
      STIGMER_MCP_OAUTH_RESOURCE: "https://mcp.stigmer.ai",
      STIGMER_MCP_OAUTH_AUTHORIZATION_SERVERS: "https://a , , https://b",
    });
    expect(c.oauth.authorizationServers).toEqual(["https://a", "https://b"]);
  });
});

describe("validateConfig", () => {
  it("accepts the default config", () => {
    expect(() => validateConfig(fromEnv())).not.toThrow();
  });

  it("rejects an invalid transport", () => {
    expect(() => validateConfig(fromEnv({ STIGMER_MCP_TRANSPORT: "carrier-pigeon" }))).toThrow(
      /STIGMER_MCP_TRANSPORT/,
    );
  });

  it("rejects an empty server address", () => {
    expect(() => validateConfig({ ...fromEnv(), stigmerServerAddress: "" })).toThrow(
      /STIGMER_SERVER_ADDRESS/,
    );
  });

  it("rejects an invalid log format and level", () => {
    expect(() => validateConfig(fromEnv({ STIGMER_MCP_LOG_FORMAT: "xml" }))).toThrow(/LOG_FORMAT/);
    expect(() => validateConfig(fromEnv({ STIGMER_MCP_LOG_LEVEL: "trace" }))).toThrow(/LOG_LEVEL/);
  });

  it("requires oauth resource and servers when oauth is enabled", () => {
    expect(() => validateConfig(fromEnv({ STIGMER_MCP_OAUTH_ENABLED: "true" }))).toThrow(
      /OAUTH_RESOURCE/,
    );
    expect(() =>
      validateConfig(
        fromEnv({
          STIGMER_MCP_OAUTH_ENABLED: "true",
          STIGMER_MCP_OAUTH_RESOURCE: "https://mcp.stigmer.ai",
        }),
      ),
    ).toThrow(/AUTHORIZATION_SERVERS/);
  });
});
