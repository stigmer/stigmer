// Byte-parity pins for the internalcomment port: every case is carried
// verbatim from the Go package's tests (tools/codegen/internalcomment) so
// the TS implementation provably matches the semantics the committed
// schemas and stubs were produced with.
import { describe, expect, it } from "vitest";

import { stripLines, stripText } from "./internalcomment.js";

describe("stripText", () => {
  const cases: Array<[name: string, input: string, expected: string]> = [
    [
      "no marker passes through trimmed",
      "  Resource slug (unique within org).\n Format: lowercase alphanumeric.  ",
      "Resource slug (unique within org).\n Format: lowercase alphanumeric.",
    ],
    [
      "marker mid-text keeps only the SDK-facing prefix",
      "When true the value is treated as a secret.\n\n@internal\nWhen is_secret is true the value is encrypted at rest.",
      "When true the value is treated as a secret.",
    ],
    [
      "marker on the first line yields empty",
      "@internal\nAuthorization: requires can_edit on the resource.",
      "",
    ],
    [
      "whitespace-padded marker line still counts",
      "Public text.\n   @internal   \nHandler strategy notes.",
      "Public text.",
    ],
    [
      "multi-paragraph SDK prefix is preserved byte-for-byte",
      "First paragraph.\n\nSecond paragraph with detail.\n\n@internal\nInternal only.",
      "First paragraph.\n\nSecond paragraph with detail.",
    ],
    [
      "truncates at the first of several markers",
      "Public.\n@internal\nInternal one.\n@internal\nInternal two.",
      "Public.",
    ],
    [
      "inline @internal inside prose is not a marker",
      "See the @internal tag convention for details.",
      "See the @internal tag convention for details.",
    ],
    [
      "line with trailing text after @internal is not a marker",
      "Public text.\n@internal note that stays\nMore public text.",
      "Public text.\n@internal note that stays\nMore public text.",
    ],
    ["marker only yields empty", "@internal", ""],
    ["empty input", "", ""],
    [
      "@generated trailer after the internal section survives",
      "API version for this resource type.\n\n@internal\nFormat: 'agentic.stigmer.ai/v1'\nValidated as const.\n\n@generated from field: string api_version = 1;",
      "API version for this resource type.\n\n@generated from field: string api_version = 1;",
    ],
    [
      "fully internal block keeps only the @generated trailer",
      "@internal\nInternal only.\n\n@generated from message a.b.C",
      "@generated from message a.b.C",
    ],
    [
      "non-@generated tags after the marker are dropped like prose",
      "Public.\n\n@internal\nNotes.\n\n@since Agent Versioning (future)",
      "Public.",
    ],
  ];

  for (const [name, input, expected] of cases) {
    it(name, () => {
      expect(stripText(input)).toBe(expected);
    });
  }
});

describe("stripLines", () => {
  it("no marker returns input unmodified with false", () => {
    const input = ["Doc line.", "", "More doc."];
    const [got, stripped] = stripLines(input);
    expect(stripped).toBe(false);
    expect(got).toEqual(input);
  });

  it("marker with trailer keeps blank separator shape", () => {
    const input = ["Summary.", "", "@internal", "Secret notes.", "", "@generated from field: string x = 1;"];
    const want = ["Summary.", "", "@generated from field: string x = 1;"];
    const [got, stripped] = stripLines(input);
    expect(stripped).toBe(true);
    expect(got).toEqual(want);
  });

  it("fully internal block strips to nothing", () => {
    const [got, stripped] = stripLines(["@internal", "Only internal."]);
    expect(stripped).toBe(true);
    expect(got).toEqual([]);
  });
});
