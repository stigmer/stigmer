/**
 * Pins the value an SDK resource page's example writes for each field type
 * the real schemas do not reach yet, so a field of that type added to the
 * contract renders a literal each SDK takes: floats, doubles, bytes, a
 * Struct and an untyped list in a protobuf input; Go's `proto.X` helper for
 * each optional scalar; Go's list and map types of enums, bytes, floats
 * and messages; and an SDK input's int64, float, bytes, `Value` and a list
 * of enums, whose package Go imports. A field whose message no package
 * declares, or whose type no language can write, is left out of the
 * example; an enum Python cannot find, or one with no named value, fails
 * the run; a TypeScript enum whose stub is missing falls back to the
 * value's own name. With nothing imported, no language has an imports
 * block, and a kind with no Get and no imports has no "Client Access".
 *
 * The cases build examples against the agent's real schema and config,
 * with synthetic fields.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import type { ServiceSchemaFile } from "../gen-common.js";
import { pyMethodTypePb2Map } from "../sdk-client-python.js";
import { docWriteClientAccess } from "../sdk-docs.js";
import {
  DocImports,
  docProtoInput,
  docSdkInput,
  protoCapCamel,
  readPythonPublicNames,
  type DocExampleEnv,
  type DocLang,
} from "../sdk-docs-examples.js";
import { deriveResourceConfig } from "../sdk-resource-config.js";
import type { FieldSchema, TypeSchema, TypeSpec } from "../schema.js";

const SCHEMAS = path.resolve(__dirname, "../../../schemas");
const SCHEMA = JSON.parse(fs.readFileSync(path.join(SCHEMAS, "services", "agent.json"), "utf8")) as ServiceSchemaFile;
const CFG = deriveResourceConfig(SCHEMA, SCHEMAS);

/** The input the protobuf cases build: a method type the agent's schema declares. */
const INPUT = "UpdateAgentInput";
const INPUT_FULL = "ai.stigmer.agentic.agent.v1.UpdateAgentInput";

const HARNESS = "ai.stigmer.agentic.session.v1.Harness";

function env(methodTypes: readonly TypeSchema[] = SCHEMA.methodTypes ?? []): DocExampleEnv {
  return {
    schema: SCHEMA,
    cfg: CFG,
    specTypes: new Map(),
    methodTypes: new Map(methodTypes.map((t) => [t.name, t])),
    pyModules: pyMethodTypePb2Map(SCHEMA),
    pyPublic: null,
    imports: new DocImports(),
  };
}

function field(protoField: string, type: TypeSpec, oneofGroup?: string): FieldSchema {
  return { name: protoCapCamel(protoField), jsonName: protoField, protoField, type, description: "", required: false, oneofGroup };
}

/** A protobuf input example over `fields`, and the imports block it left. */
function proto(lang: DocLang, fields: readonly FieldSchema[], e = env()): { code: string | null; imports: string | null } {
  const code = docProtoInput(e, lang, INPUT, INPUT_FULL, fields);
  return { code, imports: e.imports.render(lang) };
}

function sdk(lang: DocLang, fields: readonly FieldSchema[]): { code: string; imports: string | null } {
  const e = env();
  const code = docSdkInput(
    e,
    lang,
    fields.map((f) => ({ field: f })),
  );
  return { code, imports: e.imports.render(lang) };
}

const SCALARS = [
  field("ratio", { kind: "float" }),
  field("weight", { kind: "double" }),
  field("blob", { kind: "bytes" }),
  field("meta", { kind: "struct" }),
  field("tags", { kind: "array" }),
];

describe("a protobuf input's example values", () => {
  it("writes floats, doubles, bytes, a Struct and an untyped list as each language takes them", () => {
    expect(proto("typescript", SCALARS).code).toBe(
      "{\n  ratio: 0,\n  weight: 0,\n  blob: new Uint8Array(),\n  meta: {},\n  tags: [],\n}",
    );

    const go = proto("go", SCALARS);
    expect(go.code).toBe(
      "&agentv1.UpdateAgentInput{\n  Ratio:  0,\n  Weight: 0,\n  Blob:   []byte{},\n  Meta:   &structpb.Struct{},\n  Tags:   []string{},\n}",
    );
    expect(go.imports).toContain('"google.golang.org/protobuf/types/known/structpb"');

    const py = proto("python", SCALARS);
    expect(py.code).toBe(
      'io_pb2.UpdateAgentInput(\n    ratio=0.0,\n    weight=0.0,\n    blob=b"",\n    meta=struct_pb2.Struct(),\n    tags=[],\n)',
    );
    expect(py.imports).toContain("from google.protobuf import struct_pb2");

    const java = proto("java", SCALARS);
    expect(java.code).toBe(
      "UpdateAgentInput.newBuilder()\n" +
        "    .setRatio(0f)\n" +
        "    .setWeight(0)\n" +
        "    .setBlob(ByteString.EMPTY)\n" +
        "    .setMeta(Struct.getDefaultInstance())\n" +
        "    .addAllTags(List.of())\n" +
        "    .build()",
    );
    expect(java.imports).toContain("import com.google.protobuf.ByteString;");
    expect(java.imports).toContain("import com.google.protobuf.Struct;");
  });

  it("boxes each optional scalar in Go with the proto package's helper", () => {
    const optional = (name: string, kind: string) => field(name, { kind }, `_${name}`);
    const go = proto("go", [
      optional("a", "int32"),
      optional("b", "uint32"),
      optional("c", "bool"),
      optional("d", "float"),
      optional("e", "double"),
      optional("f", "string"),
    ]);
    for (const box of ["proto.Int32(0)", "proto.Uint32(0)", "proto.Bool(false)", "proto.Float32(0)", "proto.Float64(0)", 'proto.String("...")']) {
      expect(go.code).toContain(box);
    }
    expect(go.imports).toContain('"google.golang.org/protobuf/proto"');
  });

  it("types Go's lists and maps by their elements: enums, bytes, floats, doubles and messages", () => {
    const go = proto("go", [
      field("harnesses", { kind: "array", elementType: { kind: "string", enumType: HARNESS, enumValues: ["HARNESS_STIGMER"] } }),
      field("blobs", { kind: "array", elementType: { kind: "bytes" } }),
      field("ratios", { kind: "array", elementType: { kind: "float" } }),
      field("weights", { kind: "map", keyType: { kind: "string" }, valueType: { kind: "double" } }),
      field("inputs", { kind: "array", elementType: { kind: "message", messageType: INPUT } }),
    ]);
    expect(go.code).toContain("Harnesses: []sessionv1.Harness{},");
    expect(go.code).toContain("Blobs:     [][]byte{},");
    expect(go.code).toContain("Ratios:    []float32{},");
    expect(go.code).toContain("Weights:   map[string]float64{},");
    expect(go.code).toContain("Inputs:    []*agentv1.UpdateAgentInput{},");
    expect(go.imports).toContain('sessionv1 "go.stigmer.ai/sdk/proto/ai/stigmer/agentic/session/v1"');
  });

  it("leaves out a field whose message no package declares, or whose type a language cannot write", () => {
    const ghost: TypeSpec = { kind: "message", messageType: "Ghost" };
    const fields = [
      field("name", { kind: "string" }),
      field("ghost", ghost),
      field("ghosts", { kind: "array", elementType: ghost }),
      field("ghost_map", { kind: "map", keyType: { kind: "string" }, valueType: ghost }),
      field("stamps", { kind: "array", elementType: { kind: "timestamp" } }),
      field("anything", { kind: "any" }),
    ];
    for (const lang of ["typescript", "python", "java"] as const) {
      const code = proto(lang, fields).code ?? "";
      expect(code, lang).not.toMatch(/ghost|anything/i);
    }
    const go = proto("go", fields).code ?? "";
    expect(go).toContain('Name: "...",');
    expect(go).not.toMatch(/Ghost|Stamps|Anything/);
  });

  it("leaves out a Python message whose module no file records", () => {
    const ghost: TypeSchema = { name: "Ghost", description: "", protoType: "ai.stigmer.agentic.agent.v1.Ghost", protoFile: "", fields: [] };
    const e = env([...(SCHEMA.methodTypes ?? []), ghost]);
    const py = proto("python", [field("name", { kind: "string" }), field("ghost", { kind: "message", messageType: "Ghost" })], e).code;
    expect(py).toBe('io_pb2.UpdateAgentInput(\n    name="...",\n)');
  });

  it("fails on an enum Python cannot find, or one with no named value", () => {
    const enumField = (enumType: string, enumValues: string[]) => [field("mode", { kind: "string", enumType, enumValues })];
    expect(() => proto("python", enumField("ai.stigmer.nowhere.v1.Mode", ["MODE_A"]))).toThrow(/no \.proto declares enum ai\.stigmer\.nowhere\.v1\.Mode/);
    expect(() => proto("python", enumField("ai.stigmer.agentic.agent.v1.NoSuchMode", ["MODE_A"]))).toThrow(/no \.proto declares enum/);
    expect(() => proto("go", enumField(HARNESS, []))).toThrow(/enum ai\.stigmer\.agentic\.session\.v1\.Harness lists no named value/);
  });

  it("writes a TypeScript enum value by its own name when the stub does not declare the enum or the value", () => {
    const value = (enumType: string, v: string) =>
      proto("typescript", [field("mode", { kind: "string", enumType, enumValues: [v] })]).code;
    expect(value("ai.stigmer.nowhere.v1.Mode", "MODE_A")).toBe("{\n  mode: Mode.MODE_A,\n}");
    expect(value(HARNESS, "HARNESS_NOT_A_VALUE")).toBe("{\n  mode: Harness.HARNESS_NOT_A_VALUE,\n}");
  });

  it("names no message it cannot import: a TypeScript message parameter or a Python module no schema records", () => {
    const e = env();
    expect(docProtoInput(e, "typescript", "Ghost", "ai.stigmer.nowhere.v1.Ghost", [], true)).toBeNull();
    expect(docProtoInput(e, "python", "Ghost", "ai.stigmer.nowhere.v1.Ghost", [])).toBeNull();
  });
});

describe("an SDK input's example values", () => {
  const FIELDS = [
    field("limit", { kind: "int64" }),
    field("ratio", { kind: "float" }),
    field("blob", { kind: "bytes" }),
    field("value", { kind: "value" }),
    field("other", { kind: "any" }),
  ];

  it("writes int64, float, bytes, a Value and an unknown type as each language takes them", () => {
    expect(sdk("typescript", FIELDS).code).toBe(
      '{\n  limit: 0n,\n  ratio: 0,\n  blob: new Uint8Array(),\n  value: null,\n  other: "...",\n}',
    );
    expect(sdk("go", FIELDS).code).toBe(
      '&stigmer.AgentInput{\n  Limit: 0,\n  Ratio: 0,\n  Blob:  []byte{},\n  Value: nil,\n  Other: "...",\n}',
    );
    expect(sdk("python", FIELDS).code).toBe('AgentInput(\n    limit=0,\n    ratio=0.0,\n    blob=b"",\n    value=None,\n    other="...",\n)');
    expect(sdk("java", FIELDS).code).toBe(
      "AgentInput.builder()\n" +
        "    .limit(0L)\n" +
        "    .ratio(0f)\n" +
        "    .blob(new byte[0])\n" +
        "    .value(null)\n" +
        '    .other("...")\n' +
        "    .build()",
    );
  });

  it("imports the package of a Go list's enum elements", () => {
    const go = sdk("go", [field("harnesses", { kind: "array", elementType: { kind: "string", enumType: HARNESS, enumValues: ["HARNESS_STIGMER"] } })]);
    expect(go.code).toContain("Harnesses: []sessionv1.Harness{},");
    expect(go.imports).toContain('sessionv1 "go.stigmer.ai/sdk/proto/ai/stigmer/agentic/session/v1"');
  });
});

describe("what a page imports", () => {
  it("has no imports block in a language whose examples import nothing", () => {
    const imports = new DocImports();
    for (const lang of ["typescript", "go", "python", "java"] as const) expect(imports.render(lang), lang).toBeNull();
  });

  it("takes every Python name as exported when the package's __init__.py is not beside the API tree", () => {
    expect(readPythonPublicNames("")).toBeNull();
    expect(readPythonPublicNames(path.join(SCHEMAS, "no-such-apis"))).toBeNull();
  });

  it("writes no Client Access for a kind with no Get whose examples import nothing", () => {
    const buf: string[] = [];
    const noGet: ServiceSchemaFile = { ...SCHEMA, services: [] };
    docWriteClientAccess(buf, noGet, CFG, { ts: "agent", go: "Agent", py: "agent", java: "agent" }, env());
    expect(buf).toEqual([]);
  });
});
