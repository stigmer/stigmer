import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { describe, expect, it } from "vitest";
import { schemaForValidate, validateDocument } from "./validate.js";

describe("schemaForValidate", () => {
  it("resolves a schema for each file-based kind", () => {
    expect(schemaForValidate(ApiResourceKind.agent)).toBeDefined();
    expect(schemaForValidate(ApiResourceKind.workflow)).toBeDefined();
    expect(schemaForValidate(ApiResourceKind.mcp_server)).toBeDefined();
    expect(schemaForValidate(ApiResourceKind.project)).toBeDefined();
  });

  it("returns undefined for non-file-based kinds", () => {
    expect(schemaForValidate(ApiResourceKind.organization)).toBeUndefined();
    expect(schemaForValidate(ApiResourceKind.api_key)).toBeUndefined();
  });
});

describe("validateDocument", () => {
  const agentSchema = schemaForValidate(ApiResourceKind.agent);
  if (agentSchema === undefined) throw new Error("agent schema unavailable");

  it("accepts a structurally valid agent document", () => {
    expect(() =>
      validateDocument(agentSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Agent",
        metadata: { name: "Reviewer", slug: "reviewer", org: "acme" },
        spec: { description: "reviews code" },
      }),
    ).not.toThrow();
  });

  it("ignores unknown fields for forward compatibility", () => {
    expect(() =>
      validateDocument(agentSchema, {
        kind: "Agent",
        metadata: { name: "Reviewer" },
        spec: { description: "reviews code" },
        somethingNewerServersAdd: true,
      }),
    ).not.toThrow();
  });

  it("rejects a document with a type-mismatched field", () => {
    expect(() =>
      validateDocument(agentSchema, {
        kind: "Agent",
        // metadata must be an object, not a string.
        metadata: "not-an-object",
      }),
    ).toThrow();
  });
});
