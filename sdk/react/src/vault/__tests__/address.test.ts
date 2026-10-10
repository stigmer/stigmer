/**
 * Pins the console's mirror of the server's address rule, case for case
 * with the server's own address tests: the shapes a saved login is matched
 * by (scheme and host case, default ports, one trailing slash, query and
 * fragment), the refusals (a scheme other than http or https, credentials
 * in the URL, a placeholder), the bare host for Git with its HTTPS port
 * dropped, a clone URL's host for HTTPS only, two tools on one host keeping
 * two addresses, which variable a plugin server's login fills (the one its
 * bearer header names), and which saved
 * connection fills it (a sign-in and a pasted login alike for every HTTP
 * tool at their address, whichever tool or page signed in; never a local
 * program, which has no address; the github.com login for an HTTP tool on
 * GitHub's own API), and which saved login "Sign in again" can renew (a
 * sign-in's, never a pasted one).
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { McpServerEntrySchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { VaultConnectionSchema, VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import {
  gitHostOf,
  isSignInConnection,
  normalizeAddress,
  toolAddressOf,
  toolLoginKeyOf,
  vaultLoginServes,
} from "../address.js";

describe("normalizeAddress", () => {
  it.each([
    ["HTTPS://MCP.Linear.App/mcp/", "https://mcp.linear.app/mcp"],
    ["https://mcp.linear.app:443/mcp", "https://mcp.linear.app/mcp"],
    ["http://localhost:80/x", "http://localhost/x"],
    ["http://localhost:8080/mcp", "http://localhost:8080/mcp"],
    ["https://example.com:8443/a/", "https://example.com:8443/a"],
    ["https://example.com/a?token=1#frag", "https://example.com/a"],
    ["https://example.com/", "https://example.com"],
    ["  https://mcp.linear.app/mcp  ", "https://mcp.linear.app/mcp"],
    ["github.com", "github.com"],
    ["GitHub.com", "github.com"],
    ["github.com/", "github.com"],
    ["github.com:443", "github.com"],
    ["git.example.com:8443", "git.example.com:8443"],
  ])("normalizes %s", (input, want) => {
    expect(normalizeAddress(input)).toBe(want);
  });

  it("keeps two tools on one host apart", () => {
    expect(normalizeAddress("https://api.example.com/a")).not.toBe(
      normalizeAddress("https://api.example.com/b"),
    );
  });

  it("keeps the path's case: two paths differing only in case are two tools", () => {
    expect(normalizeAddress("https://api.example.com/MCP")).toBe("https://api.example.com/MCP");
  });

  it.each([
    "",
    "   ",
    "https://${HOST}/mcp",
    "https://api.example.com/${TEAM}/mcp",
    "ftp://files.example.com",
    "https://user:pass@api.example.com/mcp",
    "https://token@api.example.com/mcp",
    "not a host!",
    "https://",
  ])("refuses %j", (input) => {
    expect(normalizeAddress(input)).toBeNull();
  });
});

describe("gitHostOf", () => {
  it("is the clone URL's bare host, its HTTPS port dropped and another port kept", () => {
    expect(gitHostOf("https://GitHub.com/acme/app.git")).toBe("github.com");
    expect(gitHostOf("https://github.com:443/acme/repo")).toBe("github.com");
    expect(gitHostOf("https://git.example.com:8443/acme/repo")).toBe("git.example.com:8443");
  });

  it("is null for a URL that names no host, and for one that is not HTTPS: the runner sends a token only over HTTPS", () => {
    expect(gitHostOf("acme/repo")).toBeNull();
    expect(gitHostOf("file:///srv/repo.git")).toBeNull();
    expect(gitHostOf("http://github.com/acme/repo")).toBeNull();
    expect(gitHostOf("ssh://git@github.com/acme/repo.git")).toBeNull();
    expect(gitHostOf("git://github.com/acme/repo.git")).toBeNull();
  });
});

describe("toolLoginKeyOf", () => {
  const http = (headers: Record<string, string>) =>
    create(McpServerEntrySchema, {
      name: "linear",
      transport: { case: "http", value: { url: "https://mcp.example.com/mcp", headers } },
    });

  it("reads the variable a bearer header names", () => {
    expect(toolLoginKeyOf(http({ authorization: "Bearer ${ZENDESK_API_KEY}" }))).toBe("ZENDESK_API_KEY");
  });

  it("has none for a header that is not a bare bearer placeholder", () => {
    expect(toolLoginKeyOf(http({ Authorization: "Basic ${CREDS}" }))).toBeNull();
    expect(toolLoginKeyOf(http({}))).toBeNull();
  });

  it("gives an HTTP tool its URL as its address", () => {
    expect(toolAddressOf(http({}))).toBe("https://mcp.example.com/mcp");
  });
});

describe("the edges of the address rule", () => {
  const stdio = () =>
    create(McpServerEntrySchema, { name: "linear", transport: { case: "stdio", value: { command: "linear-mcp" } } });

  it("refuses a value with a scheme that does not parse as a URL", () => {
    expect(normalizeAddress("https://exa mple.com/mcp")).toBeNull();
  });

  it("gives a local program no address", () => {
    expect(toolAddressOf(stdio())).toBeNull();
    expect(toolAddressOf(null)).toBeNull();
  });

  it("has no Git host for a clone URL that does not parse", () => {
    expect(gitHostOf("not a url")).toBeNull();
  });

  it("gives a local program without a sign-in no login key, and skips headers other than Authorization", () => {
    expect(toolLoginKeyOf(stdio())).toBeNull();
    expect(toolLoginKeyOf(null)).toBeNull();
    const withOtherHeaders = create(McpServerEntrySchema, {
      name: "linear",
      transport: {
        case: "http",
        value: { url: "https://mcp.example.com/mcp", headers: { "X-Org": "acme", Authorization: "Bearer ${TOKEN}" } },
      },
    });
    expect(toolLoginKeyOf(withOtherHeaders)).toBe("TOKEN");
  });
});

describe("vaultLoginServes", () => {
  const URL_ADDRESS = "https://mcp.example.com/mcp";
  const httpTool = create(McpServerEntrySchema, {
    name: "linear",
    transport: { case: "http", value: { url: "https://MCP.example.com/mcp/" } },
    signIn: {},
  });
  const localTool = create(McpServerEntrySchema, {
    name: "local",
    transport: { case: "stdio", value: { command: "linear-mcp" } },
    env: ["LINEAR_ACCESS_TOKEN"],
  });
  const pastedLogin = create(VaultConnectionSchema, { source: VaultConnectionSource.pasted });
  const pasted = { [URL_ADDRESS]: pastedLogin };
  const signedIn = {
    [URL_ADDRESS]: create(VaultConnectionSchema, {
      source: VaultConnectionSource.sign_in,
      signIn: { loginApp: "" },
    }),
  };

  it("takes a sign-in at the address for every HTTP tool there, whichever tool or page signed in", () => {
    expect(vaultLoginServes(signedIn, httpTool)).toBe(true);
    const anotherToolThere = create(McpServerEntrySchema, {
      name: "other",
      transport: { case: "http", value: { url: URL_ADDRESS } },
    });
    expect(vaultLoginServes(signedIn, anotherToolThere)).toBe(true);
  });

  it("never fills a local program, which has no address", () => {
    expect(vaultLoginServes(signedIn, localTool)).toBe(false);
  });

  it("takes the github.com login for an HTTP tool on GitHub's own API at its default port, and for nothing else", () => {
    const github = { "github.com": pastedLogin };
    const at = (url: string) => create(McpServerEntrySchema, { name: "github", transport: { case: "http", value: { url } } });
    expect(vaultLoginServes(github, at("https://api.githubcopilot.com/mcp/"))).toBe(true);
    expect(vaultLoginServes(github, at("https://api.github.com:443/mcp"))).toBe(true);
    expect(vaultLoginServes(github, at("https://api.github.com:8443/mcp"))).toBe(false);
    expect(vaultLoginServes(github, at("http://api.github.com/mcp"))).toBe(false);
    expect(vaultLoginServes(github, at("https://mcp.example.com/mcp"))).toBe(false);
    const localOnGitHub = create(McpServerEntrySchema, { name: "gh", transport: { case: "stdio", value: { command: "gh-mcp" } } });
    expect(vaultLoginServes(github, localOnGitHub)).toBe(false);
  });

  it("takes a pasted login for an HTTP tool at its URL, never for a local program", () => {
    expect(vaultLoginServes(pasted, httpTool)).toBe(true);
    expect(vaultLoginServes(pasted, localTool)).toBe(false);
  });

  it("finds nothing at another address or for a tool without one", () => {
    expect(vaultLoginServes({ "https://mcp.example.com/other": pastedLogin }, httpTool)).toBe(false);
    expect(vaultLoginServes(pasted, create(McpServerEntrySchema, {}))).toBe(false);
    expect(vaultLoginServes(pasted, null)).toBe(false);
  });
});

describe("isSignInConnection", () => {
  it("is true for a sign-in's login and false for a pasted one", () => {
    expect(isSignInConnection(create(VaultConnectionSchema, { source: VaultConnectionSource.sign_in }))).toBe(true);
    expect(isSignInConnection(create(VaultConnectionSchema, { source: VaultConnectionSource.pasted }))).toBe(false);
  });
});
