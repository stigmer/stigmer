/**
 * Byte-pins the physical-layout constants and the reflection helpers.
 * The kind names are the values of the `kind` column in every table the
 * Go server ever wrote (Go kind.String()); a drift here silently orphans
 * every row of that kind at cutover — these pins fail first.
 */
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  apiResourceKindName,
  extractFieldValue,
  extractLabelValue,
  toSnakeCase,
} from "../proto-fields.js";
import { makeOrganization } from "./support.js";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

describe("apiResourceKindName", () => {
  it.each([
    [ApiResourceKind.organization, "organization"],
    [ApiResourceKind.agent, "agent"],
    [ApiResourceKind.agent_execution, "agent_execution"],
    [ApiResourceKind.mcp_server, "mcp_server"],
    [ApiResourceKind.workflow_execution, "workflow_execution"],
    [ApiResourceKind.execution_context, "execution_context"],
    [ApiResourceKind.skill, "skill"],
  ])("maps kind %d to Go's kind.String() value %j", (kind, expected) => {
    expect(apiResourceKindName(kind)).toBe(expected);
  });

  it("throws on a value the schema does not know", () => {
    expect(() => apiResourceKindName(999_999 as ApiResourceKind)).toThrow(
      "999999 is not a value in enum ai.stigmer.commons.apiresource.apiresourcekind.ApiResourceKind",
    );
  });
});

describe("extractFieldValue", () => {
  const org = makeOrganization({ id: "acme", description: "hello" });

  it("resolves nested dot paths", () => {
    expect(extractFieldValue(OrganizationSchema, org, "spec.description")).toBe("hello");
    expect(extractFieldValue(OrganizationSchema, org, "metadata.slug")).toBe("acme");
  });

  it("falls back camelCase → snake_case, as Go's two-probe lookup", () => {
    expect(extractFieldValue(OrganizationSchema, org, "apiVersion")).toBe(
      "tenancy.stigmer.ai/v1",
    );
    expect(extractFieldValue(OrganizationSchema, org, "api_version")).toBe(
      "tenancy.stigmer.ai/v1",
    );
  });

  it("returns '' for unknown fields, non-message intermediates, and message terminals", () => {
    expect(extractFieldValue(OrganizationSchema, org, "spec.nope")).toBe("");
    expect(extractFieldValue(OrganizationSchema, org, "kind.inner")).toBe("");
    expect(extractFieldValue(OrganizationSchema, org, "metadata")).toBe("");
  });
});

describe("extractLabelValue", () => {
  it("reads metadata.labels entries and returns '' when absent", () => {
    const labeled = makeOrganization({ labels: { "stigmer.ai/system": "true" } });
    expect(extractLabelValue(OrganizationSchema, labeled, "stigmer.ai/system")).toBe("true");
    expect(extractLabelValue(OrganizationSchema, labeled, "missing")).toBe("");

    const unlabeled = makeOrganization();
    expect(extractLabelValue(OrganizationSchema, unlabeled, "stigmer.ai/system")).toBe("");
  });
});

describe("toSnakeCase", () => {
  it.each([
    ["executionId", "execution_id"],
    ["workflowInstanceId", "workflow_instance_id"],
    ["already_snake", "already_snake"],
    ["single", "single"],
  ])("converts %j to %j (Go toSnakeCase)", (input, expected) => {
    expect(toSnakeCase(input)).toBe(expected);
  });
});
