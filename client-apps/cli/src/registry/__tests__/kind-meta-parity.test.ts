// Pins the CLI's hand-kept kind table (registry/metadata.ts) to the contract
// it copies: every row's name, display name and id prefix equal the
// `kind_meta` option on its ApiResourceKind value, read at runtime the way
// the server reads it. A row that drifts from the proto (a renamed kind, a
// changed prefix) fails here instead of misclassifying ids in the field.

import { getOption } from "@bufbuild/protobuf";
import {
  ApiResourceKind,
  ApiResourceKindSchema,
  kind_meta,
} from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { describe, expect, it } from "vitest";

import { KIND_META } from "../metadata.js";

describe("the CLI's kind table", () => {
  it.each([...KIND_META.entries()].map(([kind, meta]) => [ApiResourceKind[kind], kind, meta] as const))(
    "%s equals its kind_meta in the contract",
    (_name, kind, meta) => {
      const value = ApiResourceKindSchema.values.find((v) => v.number === kind);
      expect(value, `ApiResourceKind ${kind} is in the contract`).toBeDefined();
      const contract = getOption(value!, kind_meta);
      expect({
        name: meta.name,
        displayName: meta.displayName,
        idPrefix: meta.idPrefix,
      }).toEqual({
        name: contract.name,
        displayName: contract.displayName,
        idPrefix: contract.idPrefix,
      });
    },
  );
});
