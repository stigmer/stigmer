/**
 * Pins how the Java SDK generator writes a map field of a nested input's
 * `toProto()`: a map of messages puts each entry's own `toProto()`, and a
 * map of scalars is put whole. No current schema nests a map of messages,
 * so the generator's run over the real schemas never reaches that arm; these
 * cases drive the emitter directly with a field shaped like one.
 */
import { describe, expect, it } from "vitest";

import { emitJavaNestedToProtoField } from "../sdk-client-java.js";
import type { FieldSchema } from "../schema.js";

function mapField(valueType: FieldSchema["type"]): FieldSchema {
  return {
    name: "Labels",
    jsonName: "labels",
    protoField: "labels",
    type: { kind: "map", keyType: { kind: "string" }, valueType },
    description: "",
    required: false,
  };
}

describe("a nested input's map field in toProto()", () => {
  it("puts each entry of a map of messages through its own toProto()", () => {
    const buf: string[] = [];
    emitJavaNestedToProtoField(buf, mapField({ kind: "message", messageType: "Label" }), "  ");
    expect(buf.join("")).toBe(
      "  if (this.labels != null && !this.labels.isEmpty()) {\n" +
        "      for (java.util.Map.Entry<String, LabelInput> entry : this.labels.entrySet()) {\n" +
        "          builder.putLabels(entry.getKey(), entry.getValue().toProto());\n" +
        "      }\n" +
        "  }\n",
    );
  });

  it("puts a map of scalars whole", () => {
    const buf: string[] = [];
    emitJavaNestedToProtoField(buf, mapField({ kind: "string" }), "  ");
    expect(buf.join("")).toBe(
      "  if (this.labels != null && !this.labels.isEmpty()) {\n" +
        "      builder.putAllLabels(this.labels);\n" +
        "  }\n",
    );
  });
});
