/**
 * Unit tests for the platform STIGMER_SERVER_ADDRESS: the one dial-target
 * rule (shared with `toGrpcAddress` in `@stigmer/react`, same table), which
 * endpoint answers for which transport, and the fill that never overrides.
 */

import { describe, it, expect } from "vitest";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
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
): McpServer {
  const env = Object.fromEntries(declared.map((key) => [key, {}]));
  const serverType = transport === "stdio"
    ? { case: "stdio", value: { command: "stigmer", args: ["mcp-server"] } }
    : { case: "http", value: { url: "https://mcp.example.com/mcp", headers: {} } };
  return { metadata: { slug: "stigmer" }, spec: { serverType, env } } as unknown as McpServer;
}

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
    const result = fillPlatformServerAddress(server("stdio"), env, LOCAL);
    expect(result).toEqual({ OTHER: "x", [SERVER_ADDRESS_ENV_KEY]: "localhost:7234" });
    expect(env).toEqual({ OTHER: "x" });
  });

  it("fills a declared, empty address", () => {
    const result = fillPlatformServerAddress(
      server("stdio"),
      { [SERVER_ADDRESS_ENV_KEY]: "" },
      LOCAL,
    );
    expect(result[SERVER_ADDRESS_ENV_KEY]).toBe("localhost:7234");
  });

  it("never overrides a value already present", () => {
    const env = { [SERVER_ADDRESS_ENV_KEY]: "other.example:7234" };
    expect(fillPlatformServerAddress(server("stdio"), env, WITH_PUBLIC)).toBe(env);
  });

  it("gives nothing to a server that does not declare the key", () => {
    const env = {};
    expect(fillPlatformServerAddress(server("stdio", ["OTHER"]), env, LOCAL)).toBe(env);
  });

  it("fills a remote server only from the public endpoint", () => {
    expect(
      fillPlatformServerAddress(server("http"), {}, WITH_PUBLIC)[SERVER_ADDRESS_ENV_KEY],
    ).toBe("api.example.com:443");
    const env = {};
    expect(fillPlatformServerAddress(server("http"), env, LOCAL)).toBe(env);
  });
});
