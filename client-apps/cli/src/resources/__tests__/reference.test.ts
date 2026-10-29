// Unit tests for resource-reference parsing and id classification
// (resources/reference.ts). Pinned: org/slug versus id parsing, each kind's id
// prefix, and the strict reading the run and resume resolvers rely on: an id is
// a known prefix, "_" and a 26-char ULID, so a dashed spelling or a bare UUID
// reads as a slug or an unrecognized token, never as an id.

import { describe, expect, it } from "vitest";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  hasResourceIdPrefix,
  idPrefixOf,
  isAgentId,
  isRoutineId,
  isSessionId,
  parseReference,
  validateResourceId,
} from "../reference.js";

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

describe("a kind's id prefix", () => {
  it("is the kind's id_prefix", () => {
    expect(idPrefixOf(ApiResourceKind.run)).toBe("run");
    expect(idPrefixOf(ApiResourceKind.federation_issuer)).toBe("fis");
    expect(idPrefixOf(ApiResourceKind.agent)).toBe("agt");
  });

  it("is empty for a kind the CLI's table does not carry", () => {
    expect(idPrefixOf(ApiResourceKind.grant)).toBe("");
  });

  it("classifies a run id as an id of the kind, for every reader", () => {
    const id = `run_${ULID}`;
    expect(hasResourceIdPrefix(id)).toBe(true);
    expect(validateResourceId(id)).toBeNull();
    expect(parseReference(id, "acme", idPrefixOf(ApiResourceKind.run))).toEqual({ kind: "id", id });
    expect(validateResourceId("run_tooshort")).toMatch(/incomplete/);
  });

  it("leaves an agent slug that starts with run- an agent reference", () => {
    for (const slug of ["run-nightly-report", `run-${ULID}`]) {
      expect(hasResourceIdPrefix(slug), slug).toBe(false);
      expect(validateResourceId(slug), slug).toMatch(/not a recognized/);
    }
  });
});

describe("resource-ID classification", () => {
  it("detects kind prefixes followed by an underscore, and only those", () => {
    expect(isAgentId(`agt_${ULID}`)).toBe(true);
    expect(isAgentId(`agt-${ULID}`)).toBe(false);
    expect(isSessionId(`ses_${ULID}`)).toBe(true);
    expect(isRoutineId(`rtn_${ULID}`)).toBe(true);
    expect(isRoutineId(`rtn-${ULID}`)).toBe(false);
    expect(isRoutineId(`ses_${ULID}`)).toBe(false);
  });

  it("does not classify cross-kind prefixes", () => {
    expect(isAgentId(`ses_${ULID}`)).toBe(false);
    expect(isSessionId(`agt_${ULID}`)).toBe(false);
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
    expect(hasResourceIdPrefix("ses_anything")).toBe(true);
    expect(hasResourceIdPrefix("plg_x")).toBe(true);
    expect(hasResourceIdPrefix("plg-x")).toBe(false);
    expect(hasResourceIdPrefix("plain-slug")).toBe(false);
  });

  it("validates a complete ID (prefix + 26-char ULID)", () => {
    expect(validateResourceId(`agt_${ULID}`)).toBeNull();
    expect(validateResourceId(`ses_${ULID}`)).toBeNull();
    expect(validateResourceId(`ses-${ULID}`)).toMatch(/not a recognized/);
  });

  it("reports an incomplete ID when the prefix matches but the body is wrong", () => {
    expect(validateResourceId("agt_tooshort")).toMatch(/incomplete/);
    expect(validateResourceId(`agt_${ULID}extra`)).toMatch(/incomplete/);
  });

  it("rejects a bare UUID and unrelated tokens", () => {
    expect(validateResourceId("123e4567-e89b-12d3-a456-426614174000")).toMatch(/not a recognized/);
    expect(hasResourceIdPrefix("123e4567-e89b-12d3-a456-426614174000")).toBe(false);
    expect(validateResourceId("just-a-slug")).toMatch(/not a recognized/);
  });
});
