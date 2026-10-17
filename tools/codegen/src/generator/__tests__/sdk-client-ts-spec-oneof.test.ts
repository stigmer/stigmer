/**
 * Pins the TypeScript SDK generator's build<Kind>Proto for a kind whose spec
 * holds a oneof. The spec is built first and each oneof member assigned to
 * it imperatively, the first member the caller gave winning. A reference
 * member (an ApiResourceReference) is created from the
 * `@stigmer/apis` reference schema, which the module imports; any other
 * member is assigned as given. A versioned kind keeps its version message on
 * this path, set as metadata.version from the input's `versionMessage`
 * through the `@stigmer/apis` metadata version schema; a kind that is not
 * versioned carries none.
 *
 * No versioned kind's spec holds a oneof today, and no spec oneof holds a
 * reference, so the generator runs over a copy of the real schemas in which
 * a skill's spec gains one, a `template` reference beside a
 * `template_url` string, into a temporary directory, and these cases read
 * what it wrote. A channel's spec, whose `type` oneof is real and whose
 * kind is not versioned, is the contrast.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runSDKClientTSGeneration } from "../sdk-client-ts.js";

const SCHEMAS = path.resolve(__dirname, "../../../schemas");

/** The two members of the skill spec's `origin` oneof, as the schema generator writes them. */
const ORIGIN_MEMBERS = [
  {
    name: "Template",
    jsonName: "template",
    protoField: "template",
    type: { kind: "message", messageType: "ApiResourceReference" },
    description: "A skill this one is drawn from.",
    required: false,
    oneofGroup: "origin",
  },
  {
    name: "TemplateUrl",
    jsonName: "templateUrl",
    protoField: "template_url",
    type: { kind: "string" },
    description: "Where this skill's text was fetched from.",
    required: false,
    oneofGroup: "origin",
  },
];

/** The generated function that starts at `marker`, to its closing brace; a missing one fails the case. */
function from(text: string, marker: string): string {
  const at = text.indexOf(marker);
  expect(at, `${marker} was generated`).toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\n}\n", at);
  expect(end, `${marker} closes`).toBeGreaterThan(at);
  return text.slice(at, end);
}

let root: string;
let skill: string;
let channel: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-ts-spec-oneof-"));
  const schemas = path.join(root, "schemas");
  fs.cpSync(SCHEMAS, schemas, { recursive: true });
  const specPath = path.join(schemas, "agentic", "skill", "skill.json");
  const spec = JSON.parse(fs.readFileSync(specPath, "utf8")) as { fields: unknown[] };
  spec.fields.push(...ORIGIN_MEMBERS);
  fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));
  const out = path.join(root, "ts");
  runSDKClientTSGeneration(schemas, out);
  skill = fs.readFileSync(path.join(out, "skill.ts"), "utf8");
  channel = fs.readFileSync(path.join(out, "channel.ts"), "utf8");
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("a spec oneof in the TypeScript SDK's build<Kind>Proto", () => {
  it("builds the spec first, then assigns the first member the caller gave", () => {
    const build = from(skill, "export function buildSkillProto(");
    expect(build).toContain("  const spec = Object.assign(create(SkillSpecSchema), stripUndefined({\n");
    expect(build).toContain(
      "  if (input.template) {\n" +
        "    spec.origin = { case: \"template\", value: create(ApiResourceReferenceSchema, input.template) };\n" +
        "  } else if (input.templateUrl) {\n" +
        "    spec.origin = { case: \"templateUrl\", value: input.templateUrl };\n" +
        "  }\n",
    );
    expect(build).toContain("    spec,\n");
    expect(skill).toMatch(
      /^import \{[^}]*\bApiResourceReferenceSchema\b[^}]*\} from "@stigmer\/apis\/ai\/stigmer\/commons\/apiresource\/io_pb";$/m,
    );
  });

  it("keeps a versioned kind's version message", () => {
    const build = from(skill, "export function buildSkillProto(");
    expect(build).toContain(
      "      ...(input.versionMessage && { version: Object.assign(create(ApiResourceMetadataVersionSchema), { message: input.versionMessage }) }),\n",
    );
    expect(skill).toMatch(
      /^import \{[^}]*\bApiResourceMetadataVersionSchema\b[^}]*\} from "@stigmer\/apis\/ai\/stigmer\/commons\/apiresource\/metadata_pb";$/m,
    );
  });

  it("carries no version message for a kind that is not versioned", () => {
    const build = from(channel, "export function buildChannelProto(");
    expect(build).toContain("  const spec = Object.assign(create(ChannelSpecSchema), stripUndefined({\n");
    expect(build).toContain("spec.type = { case: \"web\"");
    expect(build).not.toContain("versionMessage");
  });
});
