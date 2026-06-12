// Unit tests for stigmer:// resource URI parsing and construction.
// Asserts parity with the Go server's behavior (scheme check, segment counts,
// version handling, and the kind→authority round-trip).

import { describe, expect, it } from "vitest";

import {
  buildResourceURI,
  kindToAuthority,
  parseResourceURI,
  parseVersionedResourceURI,
} from "./resourceuri";

describe("parseResourceURI", () => {
  it("extracts org and slug from a two-segment URI", () => {
    expect(parseResourceURI("stigmer://agents/acme/code-reviewer")).toEqual({
      org: "acme",
      slug: "code-reviewer",
    });
  });

  it("ignores the authority (kind) segment", () => {
    // The authority differs but the org/slug are taken from the path only.
    expect(parseResourceURI("stigmer://mcp-servers/acme/github")).toEqual({
      org: "acme",
      slug: "github",
    });
  });

  it("rejects a non-stigmer scheme", () => {
    expect(() => parseResourceURI("https://agents/acme/code-reviewer")).toThrow(/expected "stigmer"/);
  });

  it("rejects the wrong number of segments", () => {
    expect(() => parseResourceURI("stigmer://agents/acme")).toThrow(/got 1/);
    expect(() => parseResourceURI("stigmer://agents/acme/code-reviewer/v1")).toThrow(/got 3/);
  });

  it("rejects a malformed URI", () => {
    expect(() => parseResourceURI("not a uri")).toThrow(/malformed resource URI/);
  });
});

describe("parseVersionedResourceURI", () => {
  it("treats two segments as latest (empty version)", () => {
    expect(parseVersionedResourceURI("stigmer://skills/acme/my-skill")).toEqual({
      org: "acme",
      slug: "my-skill",
      version: "",
    });
  });

  it("extracts an explicit version from three segments", () => {
    expect(parseVersionedResourceURI("stigmer://skills/acme/my-skill/v1.2.0")).toEqual({
      org: "acme",
      slug: "my-skill",
      version: "v1.2.0",
    });
  });

  it("rejects more than three segments", () => {
    expect(() => parseVersionedResourceURI("stigmer://skills/acme/my-skill/v1/extra")).toThrow(
      /got 4/,
    );
  });

  it("rejects a single segment", () => {
    expect(() => parseVersionedResourceURI("stigmer://skills/acme")).toThrow(/got 1/);
  });
});

describe("buildResourceURI", () => {
  it("builds a URI for every templated kind", () => {
    expect(buildResourceURI("agent", "acme", "a")).toBe("stigmer://agents/acme/a");
    expect(buildResourceURI("mcp_server", "acme", "m")).toBe("stigmer://mcp-servers/acme/m");
    expect(buildResourceURI("skill", "acme", "s")).toBe("stigmer://skills/acme/s");
    expect(buildResourceURI("workflow", "acme", "w")).toBe("stigmer://workflows/acme/w");
  });

  it("round-trips with parseResourceURI", () => {
    const uri = buildResourceURI("agent", "acme", "code-reviewer");
    expect(parseResourceURI(uri)).toEqual({ org: "acme", slug: "code-reviewer" });
  });

  it("returns empty string for an unknown kind", () => {
    expect(buildResourceURI("organization", "acme", "x")).toBe("");
  });

  it("returns empty string when org or slug is empty", () => {
    expect(buildResourceURI("agent", "", "x")).toBe("");
    expect(buildResourceURI("agent", "acme", "")).toBe("");
  });

  it("covers exactly the four templated kinds", () => {
    expect(Object.keys(kindToAuthority).sort()).toEqual(["agent", "mcp_server", "skill", "workflow"]);
  });
});
