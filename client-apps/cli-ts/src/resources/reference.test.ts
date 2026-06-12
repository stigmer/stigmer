import { describe, expect, it } from "vitest";
import { parseReference } from "./reference.js";

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
