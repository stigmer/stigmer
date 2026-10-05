/**
 * Pins the reserved marker-label predicate (apiresource-labels.ts, the TS
 * twin of backend/libs/go/apiresource/labels.go): isSystemContent is true
 * ONLY for the exact SYSTEM_LABEL key with the exact "true" value — any
 * other value is inert (matching cloud's "true".equals(...)) and missing
 * metadata is undefined-safe.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import {
  RESERVED_LABEL_TRUE,
  SYSTEM_LABEL,
  isSystemContent,
} from "../apiresource-labels.js";

function metadataWithLabels(labels: Record<string, string>) {
  return create(ApiResourceMetadataSchema, {
    id: "skl_test",
    name: "Test Skill",
    org: "acme",
    labels,
  });
}

describe("isSystemContent", () => {
  it("is true for the exact label key and the exact 'true' value", () => {
    expect(
      isSystemContent(
        metadataWithLabels({ [SYSTEM_LABEL]: RESERVED_LABEL_TRUE }),
      ),
    ).toBe(true);
  });

  it("is false for any other value of the label — other values are inert", () => {
    expect(
      isSystemContent(metadataWithLabels({ [SYSTEM_LABEL]: "false" })),
    ).toBe(false);
    expect(
      isSystemContent(metadataWithLabels({ [SYSTEM_LABEL]: "TRUE" })),
    ).toBe(false);
    expect(isSystemContent(metadataWithLabels({ [SYSTEM_LABEL]: "" }))).toBe(
      false,
    );
  });

  it("is false when the label is missing entirely", () => {
    expect(isSystemContent(metadataWithLabels({}))).toBe(false);
    expect(
      isSystemContent(
        metadataWithLabels({
          "stigmer.ai/system-managed": RESERVED_LABEL_TRUE,
        }),
      ),
    ).toBe(false);
  });

  it("is false (not a crash) for undefined metadata", () => {
    expect(isSystemContent(undefined)).toBe(false);
  });
});
