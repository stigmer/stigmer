import { describe, expect, it } from "vitest";
import {
  hasResourceIdPrefix,
  isAgentId,
  isSessionId,
  isWorkflowId,
  parseReference,
  validateResourceId,
} from "./reference.js";

// A syntactically valid 26-char ULID body for building complete IDs in tests.
const ULID = "01arz3ndektsv4rrffq69g5fav";

describe("parseReference", () => {
  it("parses an org/slug pair", () => {
    expect(parseReference("acme/my-agent", "default-org", "agt")).toEqual({
      kind: "ref",
      org: "acme",
      slug: "my-agent",
    });
  });

  it("treats a bare id-prefixed token as an ID", () => {
    expect(parseReference("agt_abc123", "acme", "agt")).toEqual({ kind: "id", id: "agt_abc123" });
  });

  it("treats a bare token without the id prefix as a slug in the default org", () => {
    expect(parseReference("my-agent", "acme", "agt")).toEqual({
      kind: "ref",
      org: "acme",
      slug: "my-agent",
    });
  });

  it("does not mistake a slug that merely contains the prefix for an ID", () => {
    // "agent-foo" starts with "agt"? no — prefix match requires "agt_".
    expect(parseReference("agent-foo", "acme", "agt")).toEqual({
      kind: "ref",
      org: "acme",
      slug: "agent-foo",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(parseReference("  acme/release  ", "default", "wkf")).toEqual({
      kind: "ref",
      org: "acme",
      slug: "release",
    });
  });

  it("falls back to a slug when no id prefix is configured", () => {
    expect(parseReference("something", "acme", "")).toEqual({
      kind: "ref",
      org: "acme",
      slug: "something",
    });
  });
});

describe("resource-ID classification", () => {
  it("detects kind prefixes with either separator", () => {
    expect(isAgentId(`agt_${ULID}`)).toBe(true);
    expect(isAgentId(`agt-${ULID}`)).toBe(true);
    expect(isSessionId(`ses_${ULID}`)).toBe(true);
    expect(isWorkflowId(`wfl_${ULID}`)).toBe(true);
  });

  it("does not classify cross-kind prefixes", () => {
    expect(isAgentId(`ses_${ULID}`)).toBe(false);
    expect(isSessionId(`agt_${ULID}`)).toBe(false);
    expect(isWorkflowId(`agt_${ULID}`)).toBe(false);
  });

  it("does not mistake a slug that merely starts with a prefix for an ID", () => {
    // "agent-foo" begins with "agt"? No — the separator must immediately follow.
    expect(isAgentId("agent-foo")).toBe(false);
    expect(hasResourceIdPrefix("agent-foo")).toBe(false);
  });

  it("is case-sensitive (uppercase prefixes are not IDs)", () => {
    expect(isAgentId(`AGT_${ULID}`)).toBe(false);
  });

  it("recognizes any known prefix via hasResourceIdPrefix (length-agnostic)", () => {
    expect(hasResourceIdPrefix("agt_short")).toBe(true);
    expect(hasResourceIdPrefix("wex_anything")).toBe(true);
    expect(hasResourceIdPrefix("mcp-x")).toBe(true);
    expect(hasResourceIdPrefix("plain-slug")).toBe(false);
  });

  it("validates a complete ID (prefix + 26-char ULID)", () => {
    expect(validateResourceId(`agt_${ULID}`)).toBeNull();
    expect(validateResourceId(`ses-${ULID}`)).toBeNull();
  });

  it("reports an incomplete ID when the prefix matches but the body is wrong", () => {
    expect(validateResourceId("agt_tooshort")).toMatch(/incomplete/);
    expect(validateResourceId(`agt_${ULID}extra`)).toMatch(/incomplete/);
  });

  it("accepts a legacy UUID and rejects unrelated tokens", () => {
    expect(validateResourceId("123e4567-e89b-12d3-a456-426614174000")).toBeNull();
    expect(hasResourceIdPrefix("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(validateResourceId("just-a-slug")).toMatch(/not a recognized/);
  });
});
