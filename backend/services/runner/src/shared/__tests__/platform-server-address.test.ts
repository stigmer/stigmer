/**
 * Unit tests for the platform STIGMER_SERVER_ADDRESS: the one dial-target
 * rule, which endpoint answers for which transport, the fill that never
 * overrides, and that the address is the only key the platform fills: a
 * declared STIGMER_API_KEY is the user's to save (stigmer/stigmer#1446).
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  HttpMcpServerSchema,
  McpServerEntrySchema,
  StdioMcpServerSchema,
  type McpServerEntry,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import {
  SERVER_ADDRESS_ENV_KEY,
  fillPlatformServerAddress,
  grpcTarget,
  platformServerAddress,
  type PlatformEndpoints,
} from "../platform-server-address.js";

const LOCAL: PlatformEndpoints = {
  stigmerBackendEndpoint: "http://localhost:7234",
  mcpPublicEndpoint: null,
};

const WITH_PUBLIC: PlatformEndpoints = {
  stigmerBackendEndpoint: "http://stigmer-server.internal:80",
  mcpPublicEndpoint: "https://api.example.com",
};

function server(
  transport: "stdio" | "http",
  declared: readonly string[] = [SERVER_ADDRESS_ENV_KEY],
): McpServerEntry {
  return create(McpServerEntrySchema, {
    name: "stigmer",
    transport: transport === "stdio"
      ? { case: "stdio", value: create(StdioMcpServerSchema, { command: "stigmer", args: ["mcp-server"] }) }
      : { case: "http", value: create(HttpMcpServerSchema, { url: "https://mcp.example.com/mcp" }) },
    env: [...declared],
  });
}

/** The name the fill's log line gives the server. */
const SLUG = "plugin_stigmer_stigmer";

describe("grpcTarget", () => {
  it.each([
    ["http://localhost:7234", "localhost:7234"],
    ["https://api.stigmer.ai", "api.stigmer.ai:443"],
    ["https://api.stigmer.ai:8443", "api.stigmer.ai:8443"],
    ["http://api.local", "api.local:80"],
    ["http://stigmer.lan:80", "stigmer.lan:80"],
    ["http://[::1]:7234", "[::1]:7234"],
    ["http://localhost:7234/", "localhost:7234"],
    ["https://api.stigmer.ai/v1/rpc", "api.stigmer.ai:443"],
  ])("takes an http(s) URL apart with an explicit port: %s -> %s", (input, expected) => {
    expect(grpcTarget(input)).toBe(expected);
  });

  it.each([
    ["localhost:7234"],
    ["stigmer-server.stigmer-prod.svc.cluster.local:80"],
    ["api.stigmer.ai"],
    ["not a url"],
  ])("passes a value that is not an http(s) URL through: %s", (input) => {
    expect(grpcTarget(input)).toBe(input);
  });
});

describe("platformServerAddress", () => {
  it("answers the operator's public endpoint for every transport", () => {
    expect(platformServerAddress("http", WITH_PUBLIC)).toBe("api.example.com:443");
    expect(platformServerAddress("stdio", WITH_PUBLIC)).toBe("api.example.com:443");
  });

  it("answers the runner's own backend endpoint for a stdio child", () => {
    expect(platformServerAddress("stdio", LOCAL)).toBe("localhost:7234");
  });

  it("knows no address for a remote server without a public endpoint", () => {
    expect(platformServerAddress("http", LOCAL)).toBeNull();
    expect(platformServerAddress(undefined, LOCAL)).toBeNull();
  });
});

describe("fillPlatformServerAddress", () => {
  it("fills a declared, missing address for a stdio server", () => {
    const env = { OTHER: "x" };
    const result = fillPlatformServerAddress(server("stdio"), SLUG, env, LOCAL);
    expect(result).toEqual({ OTHER: "x", [SERVER_ADDRESS_ENV_KEY]: "localhost:7234" });
    expect(env).toEqual({ OTHER: "x" });
  });

  it("fills a declared, empty address", () => {
    const result = fillPlatformServerAddress(server("stdio"), SLUG, { [SERVER_ADDRESS_ENV_KEY]: "" }, LOCAL);
    expect(result[SERVER_ADDRESS_ENV_KEY]).toBe("localhost:7234");
  });

  it("never overrides a value already present", () => {
    const env = { [SERVER_ADDRESS_ENV_KEY]: "other.example:7234" };
    expect(fillPlatformServerAddress(server("stdio"), SLUG, env, WITH_PUBLIC)).toBe(env);
  });

  it("gives nothing to a server that does not declare the key", () => {
    const env = {};
    expect(fillPlatformServerAddress(server("stdio", ["OTHER"]), SLUG, env, LOCAL)).toBe(env);
  });

  it("fills a remote server only from the public endpoint", () => {
    expect(
      fillPlatformServerAddress(server("http"), SLUG, {}, WITH_PUBLIC)[SERVER_ADDRESS_ENV_KEY],
    ).toBe("api.example.com:443");
    const env = {};
    expect(fillPlatformServerAddress(server("http"), SLUG, env, LOCAL)).toBe(env);
  });

  it("fills the address alone, never a declared STIGMER_API_KEY", () => {
    const result = fillPlatformServerAddress(server("http", [SERVER_ADDRESS_ENV_KEY, "STIGMER_API_KEY"]), SLUG, {}, WITH_PUBLIC);
    expect(result).toEqual({ [SERVER_ADDRESS_ENV_KEY]: "api.example.com:443" });
  });
});
