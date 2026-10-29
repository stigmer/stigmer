/**
 * Byte-pins the physical-layout constants and the reflection helpers.
 * The kind names are the values of the `kind` column in every table; a
 * drift here silently orphans every stored row of that kind — these pins
 * fail first.
 */
import { create, toBinary } from "@bufbuild/protobuf";
import { BytesValueSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  apiResourceKindName,
  extractFieldValue,
  extractLabelValue,
  scanForFieldMatch,
  toSnakeCase,
} from "../proto-fields.js";
import { makeOrganization } from "./support.js";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";

describe("apiResourceKindName", () => {
  it.each([
    [ApiResourceKind.organization, "organization"],
    [ApiResourceKind.agent, "agent"],
    [ApiResourceKind.run, "run"],
    [ApiResourceKind.channel_app, "channel_app"],
    [ApiResourceKind.channel, "channel"],
    [ApiResourceKind.skill, "skill"],
  ])("maps kind %d to its proto enum name %j", (kind, expected) => {
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

  it("falls back camelCase → snake_case, a two-probe lookup", () => {
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

  it("renders a bytes field as its raw bytes, one character per byte", () => {
    const bytes = create(BytesValueSchema, { value: new Uint8Array([0x68, 0x69, 0xe9]) });
    expect(extractFieldValue(BytesValueSchema, bytes, "value")).toBe("hi\u00e9");
  });
});

describe("scanForFieldMatch", () => {
  it("skips a record that does not decode and returns the first match after it", () => {
    const org = makeOrganization({ id: "acme", description: "hello" });
    const malformed = new Uint8Array([0xff, 0xff, 0xff]);
    const found = scanForFieldMatch(
      [malformed, toBinary(OrganizationSchema, org)],
      OrganizationSchema,
      "metadata.slug",
      "acme",
    );
    expect(found?.metadata?.slug).toBe("acme");
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
    ["supersedesRunId", "supersedes_run_id"],
    ["already_snake", "already_snake"],
    ["single", "single"],
  ])("converts %j to %j", (input, expected) => {
    expect(toSnakeCase(input)).toBe(expected);
  });
});
