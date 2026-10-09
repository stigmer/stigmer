/**
 * Pins the one address rule a login is saved and found by: a tool's full
 * URL, normalized (scheme and host lowercased, a default port dropped, one
 * trailing slash trimmed, query and fragment dropped), and a Git host's
 * bare lowercased name. The refusals name the rule. Two tools on one host
 * under different paths keep different addresses, so they never share a
 * login. A tool's own address is its HTTP URL; a local program has none,
 * and a URL holding a placeholder names none.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";

import {
  ADDRESS_RULE,
  InvalidAddressError,
  gitHostOf,
  normalizeAddress,
  isGitHostAddress,
  toolAddressOf,
} from "../address.js";

describe("normalizeAddress", () => {
  it.each([
    ["https://mcp.linear.app/mcp", "https://mcp.linear.app/mcp"],
    ["HTTPS://MCP.Linear.APP/mcp", "https://mcp.linear.app/mcp"],
    ["https://mcp.linear.app:443/mcp", "https://mcp.linear.app/mcp"],
    ["http://localhost:80/mcp", "http://localhost/mcp"],
    ["http://localhost:8080/mcp", "http://localhost:8080/mcp"],
    ["https://mcp.linear.app/mcp/", "https://mcp.linear.app/mcp"],
    ["https://mcp.linear.app/mcp?team=1#top", "https://mcp.linear.app/mcp"],
    ["https://mcp.linear.app/", "https://mcp.linear.app"],
    ["  https://mcp.linear.app/mcp  ", "https://mcp.linear.app/mcp"],
    ["github.com", "github.com"],
    ["GitHub.com", "github.com"],
    ["github.com/", "github.com"],
    ["github.com:443", "github.com"],
    ["git.example.com:8443", "git.example.com:8443"],
  ])("%s is %s", (input, expected) => {
    expect(normalizeAddress(input)).toBe(expected);
  });

  it("keeps the path's case: two paths differing only in case are two tools", () => {
    expect(normalizeAddress("https://api.example.com/MCP")).toBe(
      "https://api.example.com/MCP",
    );
  });

  it("gives two tools on one host under different paths different addresses", () => {
    expect(normalizeAddress("https://api.example.com/crm/mcp")).not.toBe(
      normalizeAddress("https://api.example.com/billing/mcp"),
    );
  });

  it.each([
    ["", "it is empty"],
    ["https://api.example.com/${TEAM}/mcp", "placeholder"],
    ["ftp://files.example.com", "is not http or https"],
    ["https://user:pass@api.example.com/mcp", "credentials"],
    ["not a host!", "neither a URL nor a host name"],
    ["https://", "not a valid URL"],
  ])("refuses %j, naming the rule", (input, reason) => {
    let thrown: unknown;
    try {
      normalizeAddress(input);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InvalidAddressError);
    expect((thrown as Error).message).toContain(reason);
    expect((thrown as Error).message).toContain(ADDRESS_RULE);
  });

  it.each([
    ["https://user:S3CRET-TOKEN@api.example.com/x", "S3CRET-TOKEN"],
    ["ghp_S3CRETTOKEN", "S3CRETTOKEN"],
    ["S3CRETTOKEN://api.example.com/x", "S3CRETTOKEN"],
  ])("never repeats the refused input %j, which may be a pasted credential", (input, secret) => {
    let thrown: unknown;
    try {
      normalizeAddress(input);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InvalidAddressError);
    expect((thrown as Error).message.toLowerCase()).not.toContain(secret.toLowerCase());
  });
});

describe("gitHostOf", () => {
  it("is the clone URL's bare host", () => {
    expect(gitHostOf("https://github.com/acme/repo.git")).toBe("github.com");
    expect(gitHostOf("https://GitHub.com/acme/repo")).toBe("github.com");
    expect(gitHostOf("https://git.example.com:8443/acme/repo")).toBe(
      "git.example.com:8443",
    );
    expect(gitHostOf("https://github.com:443/acme/repo")).toBe("github.com");
  });

  it("is undefined for something that is not a URL", () => {
    expect(gitHostOf("acme/repo")).toBeUndefined();
    // A URL that names no host (a local path) has no Git host to match.
    expect(gitHostOf("file:///srv/repo.git")).toBeUndefined();
  });

  it("is undefined for a URL that is not HTTPS: the runner sends a token only over HTTPS", () => {
    expect(gitHostOf("http://github.com/acme/repo")).toBeUndefined();
    expect(gitHostOf("ssh://git@github.com/acme/repo.git")).toBeUndefined();
    expect(gitHostOf("git://github.com/acme/repo.git")).toBeUndefined();
  });
});

describe("toolAddressOf", () => {
  it("is an HTTP tool's URL, normalized", () => {
    const server = create(McpServerSchema, {
      spec: {
        serverType: {
          case: "http",
          value: { url: "https://MCP.Linear.app/mcp/" },
        },
      },
    });
    expect(toolAddressOf(server)).toBe("https://mcp.linear.app/mcp");
  });

  it("is none for a local program, and for a URL holding a placeholder", () => {
    expect(
      toolAddressOf(
        create(McpServerSchema, {
          spec: { serverType: { case: "stdio", value: { command: "npx" } } },
        }),
      ),
    ).toBeUndefined();
    expect(
      toolAddressOf(
        create(McpServerSchema, {
          spec: {
            serverType: {
              case: "http",
              value: { url: "https://${HOST}/mcp" },
            },
          },
        }),
      ),
    ).toBeUndefined();
  });

  it("tells a Git host from a tool's URL", () => {
    expect(isGitHostAddress("github.com")).toBe(true);
    expect(isGitHostAddress("https://api.githubcopilot.com/mcp")).toBe(false);
  });
});
