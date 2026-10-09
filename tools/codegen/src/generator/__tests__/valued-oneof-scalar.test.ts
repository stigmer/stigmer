/**
 * Pins how the SDK generators carry a boolean or numeric member of a real
 * oneof, a member whose zero is a value the caller means: a score's
 * `passed`, where `false` is a thumbs-down. Each input used to read the
 * zero as unset (TypeScript `if (input.passed)`, Go `!= false`, Python
 * `if self.passed`) and drop it, leaving the oneof empty, or store it as a
 * primitive and always send it (Java), so a thumbs-down never reached the
 * server and a score with no value arrived as `false`. Such a member now
 * carries its presence in every input (isValuedOneofScalar), while a
 * string member keeps "" as unset (a run's `session_id`). The generators
 * run over the real schemas and the tests read what they wrote.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isValuedOneofScalar } from "../gen-common.js";
import type { FieldSchema } from "../schema.js";
import { runSDKClientGeneration } from "../sdk-client-go.js";
import { runSDKClientJavaGeneration } from "../sdk-client-java.js";
import { runSDKClientPythonGeneration } from "../sdk-client-python.js";
import { runSDKClientTSGeneration } from "../sdk-client-ts.js";

const SCHEMAS = path.resolve(__dirname, "../../../schemas");

function field(kind: string, oneofGroup?: string): FieldSchema {
  return {
    name: "F",
    jsonName: "f",
    protoField: "f",
    type: { kind },
    description: "",
    required: false,
    ...(oneofGroup === undefined ? {} : { oneofGroup }),
  } as FieldSchema;
}

describe("isValuedOneofScalar", () => {
  for (const kind of ["bool", "int32", "uint32", "int64", "float", "double"]) {
    it(`is true for a ${kind} member of a real oneof`, () => {
      expect(isValuedOneofScalar(field(kind, "value"))).toBe(true);
    });
  }
  it("is false for a string member, whose empty value stays unset", () => {
    expect(isValuedOneofScalar(field("string", "target"))).toBe(false);
  });
  it("is false for an optional scalar, which hasExplicitPresence carries", () => {
    expect(isValuedOneofScalar(field("bool", "_f"))).toBe(false);
  });
  it("is false for a message member, whose presence is its own", () => {
    expect(isValuedOneofScalar(field("message", "value"))).toBe(false);
  });
  it("is false for a plain scalar", () => {
    expect(isValuedOneofScalar(field("bool"))).toBe(false);
  });
});

describe("the SDK generators keep a valued oneof member's presence", () => {
  let root: string;
  let ts: string;
  let tsRun: string;
  let go: string;
  let goRun: string;
  let python: string;
  let pythonRun: string;
  let java: string;
  let javaRun: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-valued-oneof-"));
    // The Go generator writes re-export files two levels above its output,
    // so the output nests inside the temporary root.
    const goOut = path.join(root, "go", "internal", "gen");
    runSDKClientTSGeneration(SCHEMAS, path.join(root, "ts"));
    runSDKClientGeneration(SCHEMAS, goOut);
    runSDKClientPythonGeneration(SCHEMAS, path.join(root, "python"));
    runSDKClientJavaGeneration(SCHEMAS, path.join(root, "java"));
    ts = fs.readFileSync(path.join(root, "ts", "score.ts"), "utf8");
    tsRun = fs.readFileSync(path.join(root, "ts", "run.ts"), "utf8");
    go = fs.readFileSync(path.join(goOut, "score.go"), "utf8");
    goRun = fs.readFileSync(path.join(goOut, "run.go"), "utf8");
    python = fs.readFileSync(path.join(root, "python", "_score.py"), "utf8");
    pythonRun = fs.readFileSync(path.join(root, "python", "_run.py"), "utf8");
    java = fs.readFileSync(path.join(root, "java", "ScoreInput.java"), "utf8");
    javaRun = fs.readFileSync(path.join(root, "java", "RunInput.java"), "utf8");
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("TypeScript sets the member whenever the caller gave it, false included", () => {
    expect(ts).toContain("  if (input.passed !== undefined) {\n");
    expect(ts).toContain(
      '    spec.value = { case: "passed", value: input.passed };\n',
    );
    expect(ts).not.toContain("  if (input.passed) {\n");
  });

  it("Go holds the member as a pointer, sends it when non-nil and reads it back as one", () => {
    expect(go).toMatch(/\tPassed +\*bool\n/);
    expect(go).toContain(
      "\tif i.Passed != nil {\n\t\tresource.Spec.Value = &scorev1.ScoreSpec_Passed{Passed: *i.Passed}\n\t}\n",
    );
    expect(go).toContain(
      "\t\tif ov, ok := s.Value.(*scorev1.ScoreSpec_Passed); ok {\n\t\t\tv := ov.Passed\n\t\t\tinput.Passed = &v\n\t\t}\n",
    );
    expect(go).not.toContain("i.Passed != false");
  });

  it("Python defaults the member to None and sends it whenever it is not None", () => {
    expect(python).toContain("    passed: bool | None = None\n");
    expect(python).toContain(
      '        if self.passed is not None:\n            setattr(spec, "passed", self.passed)\n',
    );
  });

  it("Java stores the member boxed and sets it only when the caller did", () => {
    expect(java).toContain("    private final Boolean passed;\n");
    expect(java).toContain(
      "        if (this.passed != null) {\n            spec.setPassed(this.passed);\n        }\n",
    );
  });

  it("keeps a string member's empty value as unset in every SDK", () => {
    expect(tsRun).toContain("  if (input.sessionId) {\n");
    expect(goRun).toContain(
      '\tif i.SessionId != "" {\n\t\tresource.Spec.Target = &runv1.RunSpec_SessionId{SessionId: i.SessionId}\n\t}\n',
    );
    expect(pythonRun).toContain('    session_id: str = ""\n');
    expect(pythonRun).toContain(
      '        if self.session_id:\n            setattr(spec, "session_id", self.session_id)\n',
    );
    expect(javaRun).toContain("    private final String sessionId;\n");
    expect(javaRun).toContain(
      "        if (this.sessionId != null && !this.sessionId.isEmpty()) {\n",
    );
  });
});
