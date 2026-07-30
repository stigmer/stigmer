import { describe, it, expect } from "vitest";
import {
  assertTransportAllowed,
  McpTransportError,
  resolveMcpTransportPosture,
} from "../mcp-transport-guard.js";

describe("resolveMcpTransportPosture", () => {
  it("forbids stdio on cloud runners", () => {
    expect(resolveMcpTransportPosture("cloud", {})).toBe("stdio-forbidden");
  });

  it("allows stdio on local runners", () => {
    expect(resolveMcpTransportPosture("local", {})).toBe("stdio-allowed");
  });

  it("honors the explicit allow override on a cloud runner (kill-switch)", () => {
    expect(
      resolveMcpTransportPosture("cloud", { STIGMER_MCP_ALLOW_STDIO: "true" }),
    ).toBe("stdio-allowed");
  });

  it("honors the explicit forbid override on a local runner", () => {
    expect(
      resolveMcpTransportPosture("local", { STIGMER_MCP_ALLOW_STDIO: "false" }),
    ).toBe("stdio-forbidden");
  });

  it("ignores malformed override values", () => {
    expect(
      resolveMcpTransportPosture("cloud", { STIGMER_MCP_ALLOW_STDIO: "yes" }),
    ).toBe("stdio-forbidden");
  });
});

describe("assertTransportAllowed", () => {
  it("throws McpTransportError for stdio under a forbidding posture", () => {
    expect(() =>
      assertTransportAllowed("filesystem", "stdio", "stdio-forbidden"),
    ).toThrow(McpTransportError);
  });

  it("names the server and both remediations in the error message", () => {
    try {
      assertTransportAllowed("filesystem", "stdio", "stdio-forbidden");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(McpTransportError);
      const message = (err as Error).message;
      expect(message).toContain("'filesystem'");
      expect(message).toContain("local runner");
      expect(message).toContain("execution_target: local");
      expect(message).toContain("HTTP");
    }
  });

  it("allows stdio under an allowing posture", () => {
    expect(() =>
      assertTransportAllowed("filesystem", "stdio", "stdio-allowed"),
    ).not.toThrow();
  });

  it("allows http and sse regardless of posture", () => {
    expect(() =>
      assertTransportAllowed("github", "http", "stdio-forbidden"),
    ).not.toThrow();
    expect(() =>
      assertTransportAllowed("sse-server", "sse", "stdio-forbidden"),
    ).not.toThrow();
  });
});
