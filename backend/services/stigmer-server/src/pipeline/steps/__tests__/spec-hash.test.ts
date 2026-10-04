/**
 * Pins the canonical spec hash (spec-hash.ts): a hash moves when the
 * stored content does and never otherwise. Stable across a map's
 * insertion order and across a field left unset versus set to its
 * default; sensitive to every content change, the order of a repeated
 * field included (a list's order is content).
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";

import { canonicalJson, canonicalSpecHash } from "../spec-hash.js";

const hashOf = (init: Parameters<typeof create<typeof AgentSpecSchema>>[1]) =>
  canonicalSpecHash(AgentSpecSchema, create(AgentSpecSchema, init));

describe("canonicalSpecHash", () => {
  it("is a 64-hex SHA-256", () => {
    expect(hashOf({ instructions: "Review pull requests." })).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  it("does not move with a map's insertion order", () => {
    const one = hashOf({
      instructions: "Use the tokens.",
      env: {
        GITHUB_TOKEN: { description: "GitHub", isSecret: true },
        LINEAR_TOKEN: { description: "Linear", isSecret: true },
      },
    });
    const other = hashOf({
      instructions: "Use the tokens.",
      env: {
        LINEAR_TOKEN: { description: "Linear", isSecret: true },
        GITHUB_TOKEN: { description: "GitHub", isSecret: true },
      },
    });
    expect(other).toBe(one);
  });

  it("does not move when a field is set to its default rather than left unset", () => {
    expect(hashOf({ instructions: "Same.", description: "" })).toBe(
      hashOf({ instructions: "Same." }),
    );
  });

  it("moves with every content change, a repeated field's order included", () => {
    const base = hashOf({
      instructions: "Same.",
      skillRefs: [
        { org: "acme", slug: "a" },
        { org: "acme", slug: "b" },
      ],
    });
    expect(hashOf({ instructions: "Changed.", skillRefs: [{ org: "acme", slug: "a" }, { org: "acme", slug: "b" }] })).not.toBe(base);
    expect(
      hashOf({
        instructions: "Same.",
        skillRefs: [
          { org: "acme", slug: "b" },
          { org: "acme", slug: "a" },
        ],
      }),
    ).not.toBe(base);
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every depth and keeps arrays in order", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[3,1]},"b":1}',
    );
  });
});
