/**
 * Pins the OAuth-challenge rule: the runner's cases, moved here when the
 * rule became shared, and the `resource_metadata` pointer read.
 */
import { describe, expect, it } from "vitest";

import { isOAuthChallenge, parseResourceMetadataUrl } from "../mcp-oauth/challenge.js";

describe("isOAuthChallenge", () => {
  it("matches the MCP auth spec Bearer + OAuth realm challenge", () => {
    expect(isOAuthChallenge('Bearer realm="OAuth", resource_metadata="https://mcp.vendor.test/.well-known/oauth-protected-resource"')).toBe(true);
  });

  it("matches a Bearer challenge that only advertises resource_metadata", () => {
    expect(isOAuthChallenge('Bearer resource_metadata="https://mcp.vendor.test/.well-known/oauth-protected-resource"')).toBe(true);
  });

  it("does not match a plain Bearer 401 (an invalid API key, not an OAuth requirement)", () => {
    expect(isOAuthChallenge('Bearer error="invalid_token"')).toBe(false);
  });

  it("does not match a non-Bearer scheme", () => {
    expect(isOAuthChallenge('Basic realm="OAuth"')).toBe(false);
  });

  it("is empty-safe", () => {
    expect(isOAuthChallenge("")).toBe(false);
  });
});

describe("parseResourceMetadataUrl", () => {
  it("extracts the resource_metadata URL", () => {
    expect(parseResourceMetadataUrl('Bearer realm="OAuth", resource_metadata="https://mcp.vendor.test/.well-known/oauth-protected-resource"')).toBe(
      "https://mcp.vendor.test/.well-known/oauth-protected-resource",
    );
  });

  it("returns undefined when absent", () => {
    expect(parseResourceMetadataUrl('Bearer realm="OAuth"')).toBeUndefined();
  });
});
