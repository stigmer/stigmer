/**
 * The MCP transport guard: a runner's stdio posture by mode and override,
 * and a conversation without a computer refusing stdio on every runner,
 * whatever the override, with its own sentence.
 */
import { describe, it, expect } from "vitest";
import {
  assertTransportAllowed,
  McpTransportError,
  resolveMcpTransportPosture,
} from "../mcp-transport-guard.js";

describe("resolveMcpTransportPosture", () => {
  it("forbids stdio on cloud runners", () => {
    expect(resolveMcpTransportPosture("cloud", true, {})).toBe("stdio-forbidden");
  });

  it("allows stdio on local runners", () => {
    expect(resolveMcpTransportPosture("local", true, {})).toBe("stdio-allowed");
  });

  it("honors the explicit allow override on a cloud runner (kill-switch)", () => {
    expect(
      resolveMcpTransportPosture("cloud", true, { STIGMER_MCP_ALLOW_STDIO: "true" }),
    ).toBe("stdio-allowed");
  });

  it("honors the explicit forbid override on a local runner", () => {
    expect(
      resolveMcpTransportPosture("local", true, { STIGMER_MCP_ALLOW_STDIO: "false" }),
    ).toBe("stdio-forbidden");
  });

  it("ignores malformed override values", () => {
    expect(
      resolveMcpTransportPosture("cloud", true, { STIGMER_MCP_ALLOW_STDIO: "yes" }),
    ).toBe("stdio-forbidden");
  });
});

describe("resolveMcpTransportPosture without a computer", () => {
  it.each([
    ["local", {}],
    ["cloud", {}],
    ["local", { STIGMER_MCP_ALLOW_STDIO: "true" }],
    ["cloud", { STIGMER_MCP_ALLOW_STDIO: "true" }],
  ] as const)("is no-computer on a %s runner with %o", (mode, env) => {
    expect(resolveMcpTransportPosture(mode, false, env)).toBe("no-computer");
  });
});

describe("assertTransportAllowed", () => {
  it("refuses stdio for a conversation without a computer, with that sentence", () => {
    expect(() => assertTransportAllowed("filesystem", "stdio", "no-computer")).toThrow(McpTransportError);
    expect(() => assertTransportAllowed("filesystem", "stdio", "no-computer")).toThrow(
      "MCP server 'filesystem' uses the stdio transport: it is a program on this machine, which a " +
        "conversation without a computer can't start. Replace 'filesystem' with a remote (HTTP) MCP " +
        "server, or give the agent a computer.",
    );
  });

  it("lets http and sse through for a conversation without a computer", () => {
    expect(() => assertTransportAllowed("github", "http", "no-computer")).not.toThrow();
    expect(() => assertTransportAllowed("sse-server", "sse", "no-computer")).not.toThrow();
  });


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
