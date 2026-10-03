/**
 * Pins how the SDK generators carry a proto3 `optional` scalar, a field with
 * explicit presence where unset and zero differ on the wire (an absent
 * entitlement limit is no limit and zero is refused; an absent clone depth
 * is a shallow clone and 0 the full history).
 *
 * The Python and Java inputs used to store such a field as a plain value
 * defaulting to zero and always send it, so a limit the caller never set
 * arrived as zero and was refused. Go's nested literal form skipped the
 * fields altogether, so a Go caller's plan limits and prices never reached
 * the wire. These tests run each generator over a copy of the real schemas,
 * with two top-level optional scalars added to the Plan spec so the
 * spec-level paths run too, and read what it wrote.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FieldSchema } from "../schema.js";
import { hasExplicitPresence } from "../gen-common.js";
import { runSDKClientGeneration } from "../sdk-client-go.js";
import { runSDKClientJavaGeneration } from "../sdk-client-java.js";
import { runSDKClientPythonGeneration } from "../sdk-client-python.js";

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

describe("hasExplicitPresence", () => {
  const scalars = ["string", "int32", "uint32", "int64", "bool", "float", "double"];
  for (const kind of scalars) {
    it(`is true for an optional ${kind}`, () => {
      expect(hasExplicitPresence(field(kind, "_f"))).toBe(true);
    });
  }
  it("is false for an optional bytes, which no emitter carries presence for yet", () => {
    expect(hasExplicitPresence(field("bytes", "_f"))).toBe(false);
  });
  it("is false for an optional message, whose presence is its own", () => {
    expect(hasExplicitPresence(field("message", "_f"))).toBe(false);
  });
  it("is false for a member of a real oneof", () => {
    expect(hasExplicitPresence(field("int32", "source"))).toBe(false);
  });
  it("is false for a plain scalar", () => {
    expect(hasExplicitPresence(field("int32"))).toBe(false);
  });
});

describe("the SDK generators keep an optional scalar's presence", () => {
  let root: string;
  let python: string;
  let java: string;
  let go: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-presence-"));
    const schemas = path.join(root, "schemas");
    fs.cpSync(SCHEMAS, schemas, { recursive: true });

    const planSpec = path.join(schemas, "billing/plan/plan.json");
    const spec = JSON.parse(fs.readFileSync(planSpec, "utf8")) as { fields: unknown[] };
    spec.fields.push(
      {
        name: "TrialDays",
        jsonName: "trialDays",
        protoField: "trial_days",
        type: { kind: "int32" },
        description: "A fixture field.",
        required: false,
        oneofGroup: "_trial_days",
      },
      {
        name: "Global",
        jsonName: "global",
        protoField: "global",
        type: { kind: "bool" },
        description: "A fixture field whose name is a Python keyword.",
        required: false,
        oneofGroup: "_global",
      },
    );
    fs.writeFileSync(planSpec, JSON.stringify(spec));

    runSDKClientPythonGeneration(schemas, path.join(root, "python"));
    runSDKClientJavaGeneration(schemas, path.join(root, "java"));
    runSDKClientGeneration(schemas, path.join(root, "go"));
    python = fs.readFileSync(path.join(root, "python/_license.py"), "utf8") + fs.readFileSync(path.join(root, "python/_plan.py"), "utf8");
    java = fs.readFileSync(path.join(root, "java/PlanInput.java"), "utf8");
    go = fs.readFileSync(path.join(root, "go/plan.go"), "utf8") + fs.readFileSync(path.join(root, "go/license.go"), "utf8");
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("Python defaults a nested optional scalar to None and sends it only when set", () => {
    expect(python).toContain("    max_orgs: int | None = None\n");
    expect(python).toContain("        if self.max_orgs is not None:\n            msg.max_orgs = self.max_orgs\n");
    expect(python).not.toContain("max_orgs=self.max_orgs");
  });

  it("Python does the same for a spec-level optional scalar, keyword names included", () => {
    expect(python).toContain("    trial_days: int | None = None\n");
    expect(python).toContain("        if self.trial_days is not None:\n            spec.trial_days = self.trial_days\n");
    expect(python).toMatch(/ {8}if self\.(\w+) is not None:\n {12}setattr\(spec, "global", self\.\1\)\n/);
  });

  it("Java stores an optional scalar boxed, takes the primitive, and sets it only when set", () => {
    expect(java).toContain("        private final Integer maxOrgs;\n");
    expect(java).toContain("            public Builder maxOrgs(int maxOrgs) { this.maxOrgs = maxOrgs; return this; }\n");
    expect(java).toContain("            if (this.maxOrgs != null) {\n                builder.setMaxOrgs(this.maxOrgs);\n            }\n");
    expect(java).toContain("    private final Integer trialDays;\n");
    expect(java).toContain("        if (this.trialDays != null) {\n            spec.setTrialDays(this.trialDays);\n        }\n");
  });

  it("Go sends a nested optional scalar the caller set, instead of an empty message", () => {
    expect(go).not.toContain("return &platformv1.EntitlementLimits{}, nil");
    expect(go).toContain("\tif i.MaxOrgs != 0 {\n\t\tv := i.MaxOrgs\n\t\tp.MaxOrgs = &v\n\t}\n");
    expect(go).toContain("\tif i.MonthlyMinimumMicros != 0 {\n\t\tv := i.MonthlyMinimumMicros\n\t\tp.MonthlyMinimumMicros = &v\n\t}\n");
  });
});
