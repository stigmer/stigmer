/**
 * Pins the reserved-label predicates (apiresource-labels.ts, the TS twin
 * of backend/libs/go/apiresource/labels.go): isDefaultInstance is true
 * ONLY for the exact DEFAULT_INSTANCE_LABEL key with the exact "true"
 * value — any other value is inert (matching cloud's "true".equals(...))
 * and missing metadata is undefined-safe.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import {
  DEFAULT_INSTANCE_LABEL,
  RESERVED_LABEL_TRUE,
  isDefaultInstance,
} from "../apiresource-labels.js";

function metadataWithLabels(labels: Record<string, string>) {
  return create(ApiResourceMetadataSchema, {
    id: "ain_test",
    name: "Test Instance",
    org: "acme",
    labels,
  });
}

describe("isDefaultInstance", () => {
  it("is true for the exact label key and the exact 'true' value", () => {
    expect(
      isDefaultInstance(
        metadataWithLabels({ [DEFAULT_INSTANCE_LABEL]: RESERVED_LABEL_TRUE }),
      ),
    ).toBe(true);
  });

  it("is false for any other value of the label — other values are inert", () => {
    expect(
      isDefaultInstance(
        metadataWithLabels({ [DEFAULT_INSTANCE_LABEL]: "false" }),
      ),
    ).toBe(false);
    expect(
      isDefaultInstance(
        metadataWithLabels({ [DEFAULT_INSTANCE_LABEL]: "TRUE" }),
      ),
    ).toBe(false);
    expect(
      isDefaultInstance(metadataWithLabels({ [DEFAULT_INSTANCE_LABEL]: "" })),
    ).toBe(false);
  });

  it("is false when the label is missing entirely", () => {
    expect(isDefaultInstance(metadataWithLabels({}))).toBe(false);
    expect(
      isDefaultInstance(
        metadataWithLabels({
          "stigmer.ai/system-managed": RESERVED_LABEL_TRUE,
        }),
      ),
    ).toBe(false);
  });

  it("is false (not a crash) for undefined metadata", () => {
    expect(isDefaultInstance(undefined)).toBe(false);
  });
});
