/**
 * What My vault says about one plugin server, the rule `connect plugin` and
 * `get plugin` share. Pins the edges the commands meet: a server the runner
 * starts as a local program has no login key and no address, so it is never
 * signed in; the login key is read from the Authorization header alone,
 * whatever other headers come first; and a key a server sends under another
 * header is no login.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { McpServerEntrySchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import { VaultSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultConnectionSource } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/spec_pb";
import { loginKeyOf, serverLogin } from "../my-vault.js";

const LOCAL = create(McpServerEntrySchema, {
  name: "runbooks",
  transport: { case: "stdio", value: { command: "npx", args: ["runbooks-mcp"] } },
  env: ["RUNBOOKS_KEY"],
});

describe("loginKeyOf", () => {
  it("has no login key for a local program", () => {
    expect(loginKeyOf(LOCAL)).toBeUndefined();
  });

  it("reads the Authorization header's key past the headers before it, and no other header's", () => {
    const server = create(McpServerEntrySchema, {
      name: "linear",
      transport: {
        case: "http",
        value: { url: "https://mcp.linear.app/mcp", headers: { "X-Team": "${TEAM}", Authorization: "Bearer ${LINEAR_TOKEN}" } },
      },
    });
    expect(loginKeyOf(server)).toBe("LINEAR_TOKEN");
    const keyOnly = create(McpServerEntrySchema, {
      name: "search",
      transport: { case: "http", value: { url: "https://search.example/mcp", headers: { "X-Api-Key": "${SEARCH_KEY}" } } },
    });
    expect(loginKeyOf(keyOnly)).toBeUndefined();
  });
});

describe("serverLogin", () => {
  it("never reads a local program as signed in, whatever My vault holds", () => {
    const vault = create(VaultSchema, {
      spec: { connections: { "https://mcp.linear.app/mcp": { source: VaultConnectionSource.sign_in } } },
    });
    expect(serverLogin(vault, LOCAL)).toEqual({ signedIn: false, savedLogin: false, savedSignIn: false });
  });
});
