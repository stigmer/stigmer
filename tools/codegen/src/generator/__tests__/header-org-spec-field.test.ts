/**
 * Pins how every SDK generator fills a spec field named `org` from the
 * input's own org. The contract spells every organization field `org`, and
 * a credential's owner oneof has two members: `person` and `org`. The input
 * already carries an `org` (the organization the resource is written in),
 * so it declares no second one; the builders set the spec's `org` member
 * from the header, and the oneof keeps its first-member-wins order, so a
 * set `person` still holds it. The update mappers carry the org back
 * through the header alone. A spec `name` (a skill's, a plugin's) is not an
 * organization field and stays out of the builders.
 *
 * The generators run over the real schemas into temporary directories, and
 * these cases read what they wrote.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FieldSchema } from "../schema.js";
import { runSDKClientGeneration } from "../sdk-client-go.js";
import { runSDKClientJavaGeneration } from "../sdk-client-java.js";
import { runSDKClientPythonGeneration } from "../sdk-client-python.js";
import { isHeaderOrgSpecField, specBuildFields } from "../sdk-resource-config.js";
import { runSDKClientTSGeneration } from "../sdk-client-ts.js";

const SCHEMAS = path.resolve(__dirname, "../../../schemas");

const field = (name: string, kind = "string", oneofGroup = ""): FieldSchema =>
  ({ name, protoField: name.toLowerCase(), oneofGroup, type: { kind } }) as FieldSchema;

describe("specBuildFields", () => {
  it("adds a string org to the declared fields and leaves out every other header name", () => {
    const names = specBuildFields([
      field("Person", "string", "owner"),
      field("Org", "string", "owner"),
      field("Name"),
      field("Labels", "map"),
      field("Description"),
    ]).map((f) => f.name);
    expect(names).toEqual(["Person", "Org", "Description"]);
  });

  it("takes only a plain string org from the header", () => {
    expect(isHeaderOrgSpecField(field("Org", "message"))).toBe(false);
    expect(
      isHeaderOrgSpecField({ ...field("Org"), type: { kind: "string", enumType: "ai.stigmer.X" } }),
    ).toBe(false);
  });
});

describe("a credential's org owner comes from the input's org", () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-header-org-"));
    runSDKClientTSGeneration(SCHEMAS, path.join(root, "ts"));
    runSDKClientGeneration(SCHEMAS, path.join(root, "go", "internal", "gen"));
    runSDKClientPythonGeneration(SCHEMAS, path.join(root, "py"));
    runSDKClientJavaGeneration(SCHEMAS, path.join(root, "java"));
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const read = (...parts: string[]): string => fs.readFileSync(path.join(root, ...parts), "utf8");

  it("TypeScript: the input declares one org and the builder sets the owner from it, person first", () => {
    const ts = read("ts", "credential.ts");
    const start = ts.indexOf("export interface CredentialInput {");
    const input = ts.slice(start, ts.indexOf("\n}\n", start));
    expect(input.match(/\n {2}org[?]?: /g)).toHaveLength(1);
    expect(ts).toContain(
      '  if (input.person) {\n    spec.owner = { case: "person", value: input.person };\n' +
        '  } else if (input.org) {\n    spec.owner = { case: "org", value: input.org };\n  }\n',
    );
    const mapper = ts.slice(ts.indexOf("export function toCredentialUpdateInput("));
    expect(mapper).toContain('person: spec.owner?.case === "person" ? spec.owner.value : undefined,');
    expect(mapper).not.toContain('spec.owner?.case === "org"');
  });

  it("Go: the org member is assigned before person, so a set person wins", () => {
    const go = read("go", "internal", "gen", "credential.go");
    const org = go.indexOf("resource.Spec.Owner = &credentialv1.CredentialSpec_Org{Org: i.Org}");
    const person = go.indexOf("resource.Spec.Owner = &credentialv1.CredentialSpec_Person{Person: i.Person}");
    expect(org).toBeGreaterThan(-1);
    expect(person).toBeGreaterThan(org);
  });

  it("Python: the org member is set from self.org before person", () => {
    const py = read("py", "_credential.py");
    const org = py.indexOf('        if self.org:\n            setattr(spec, "org", self.org)\n');
    const person = py.indexOf('        if self.person:\n            setattr(spec, "person", self.person)\n');
    expect(org).toBeGreaterThan(-1);
    expect(person).toBeGreaterThan(org);
  });

  it("Java: the org member is set from this.org before person", () => {
    const java = read("java", "CredentialInput.java");
    const org = java.indexOf("            spec.setOrg(this.org);\n");
    const person = java.indexOf("            spec.setPerson(this.person);\n");
    expect(org).toBeGreaterThan(-1);
    expect(person).toBeGreaterThan(org);
  });

  it("leaves a spec name out of the builders", () => {
    expect(read("go", "internal", "gen", "skill.go")).not.toContain("resource.Spec.Name = i.Name");
  });
});
