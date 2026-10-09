// Unit arms for the sign-in fixture builders the suites create servers and
// login apps with.
// - An OAuth McpServer is always an HTTP server at its address, carrying
//   the variable its login fills, and oauth_only and scope hints only when
//   given.
// - A login app lists one address of its own by default, unique per app
//   name, so two apps of one organization never claim the same address;
//   given addresses and an account endpoint replace the defaults.
// Pure: hand-built shapes, no target.
// Domain: conformance support (sign-in).
import { describe, expect, it } from "vitest";

import { makeOAuthMcpServer } from "../mcpservers";
import { defaultOAuthAppAddress, makeOAuthApp } from "../oauthapps";

describe("makeOAuthMcpServer", () => {
  it("is an HTTP server at its address with the login's variable, hints and oauth_only only when given", () => {
    const plain = makeOAuthMcpServer({ org: "acme", name: "linear", targetEnvVar: "LINEAR_TOKEN", url: "https://mcp.linear.test/mcp" });
    expect(plain.spec?.serverType).toEqual({ case: "http", value: { url: "https://mcp.linear.test/mcp" } });
    expect(plain.spec?.auth).toEqual({ targetEnvVar: "LINEAR_TOKEN" });

    const full = makeOAuthMcpServer({
      org: "acme",
      name: "notion",
      targetEnvVar: "NOTION_TOKEN",
      url: "https://mcp.notion.test/mcp",
      oauthOnly: true,
      scopeHints: ["read"],
    });
    expect(full.spec?.auth).toEqual({ targetEnvVar: "NOTION_TOKEN", oauthOnly: true, scopeHints: ["read"] });
  });
});

describe("makeOAuthApp", () => {
  it("lists one address of its own by default, unique per app name", () => {
    expect(makeOAuthApp("acme", "Slack App").spec?.addresses).toEqual([defaultOAuthAppAddress("Slack App")]);
    expect(defaultOAuthAppAddress("Slack App")).not.toBe(defaultOAuthAppAddress("Figma App"));
    expect(makeOAuthApp("acme", "Slack App").spec?.userinfoUrl).toBeUndefined();
  });

  it("takes the addresses and the account endpoint a test gives", () => {
    const app = makeOAuthApp("acme", "GitHub", { addresses: ["github.com"], userinfoUrl: "https://api.github.test/user" });
    expect(app.spec?.addresses).toEqual(["github.com"]);
    expect(app.spec?.userinfoUrl).toBe("https://api.github.test/user");
  });
});
