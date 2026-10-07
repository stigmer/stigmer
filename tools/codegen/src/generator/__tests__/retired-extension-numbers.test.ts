// Pins that the custom option numbers retired with the workflow product stay
// unused. ai/stigmer/commons/apiresource/field_options.proto once declared
// is_expression (90203) and discriminated_by (90205) on FieldOptions and
// discriminator_value (90301) on MessageOptions; a descriptor written with
// one of them must never read as a different option, so no extension in the
// proto closure may take any of those numbers. Before this, only a comment in
// that file held the rule.
import { describe, expect, it } from "vitest";

import type { DescExtension } from "@bufbuild/protobuf";

import { stigmerRegistry } from "../stigmer-registry.js";

const RETIRED_NUMBERS: ReadonlyMap<number, string> = new Map([
  [90203, "is_expression"],
  [90205, "discriminated_by"],
  [90301, "discriminator_value"],
]);

function registeredExtensions(): DescExtension[] {
  const out: DescExtension[] = [];
  for (const desc of stigmerRegistry()) {
    if (desc.kind === "extension") out.push(desc);
  }
  return out;
}

describe("retired custom option numbers", () => {
  it("are taken by no extension in the registry", () => {
    const extensions = registeredExtensions();
    // The scan covers field_options.proto itself: its live options are here.
    expect(
      extensions.find((ext) => ext.typeName === "ai.stigmer.commons.apiresource.computed")?.number,
    ).toBe(90201);

    const reused = extensions
      .filter((ext) => RETIRED_NUMBERS.has(ext.number))
      .map((ext) => `${ext.typeName} = ${ext.number} (retired ${RETIRED_NUMBERS.get(ext.number)})`);
    expect(reused).toEqual([]);
  });
});
