/**
 * Pins how the generated SDK inputs carry a reference that is a member of a
 * oneof. A plain reference field has its kind filled from its
 * reference_kind option, so a caller names only an organization and a slug;
 * a reference inside a oneof gets the same, or the server's kind check
 * refuses every call that left it out. In Go the reference is a ResourceRef
 * value, not a generated input type, so the member is set only when it
 * names something. No message of the contract holds such a member today,
 * so the generators run over a copy of the real schemas in which an
 * agent's hook source gains one, a `plugin` reference beside its `inline`
 * hooks block (the shape it once had), into a temporary directory, and
 * these cases read what they wrote.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runSDKClientGeneration } from "../sdk-client-go.js";
import { runSDKClientTSGeneration } from "../sdk-client-ts.js";

const SCHEMAS = path.resolve(__dirname, "../../../schemas");

let root: string;
let go: string;
let ts: string;

/** A reference member of the hook source's oneof, as the schema generator writes one. */
const PLUGIN_MEMBER = {
  name: "Plugin",
  jsonName: "plugin",
  protoField: "plugin",
  type: { kind: "message", messageType: "ApiResourceReference" },
  description: "A plugin whose recorded hooks apply to this agent.",
  required: false,
  referenceKind: 58,
  oneofGroup: "source",
};

beforeAll(() => {
  // The Go generator writes re-export files two levels above its output, so
  // the output nests inside the temporary root.
  root = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-oneof-ref-"));
  const schemas = path.join(root, "schemas");
  fs.cpSync(SCHEMAS, schemas, { recursive: true });
  const hookSourcePath = path.join(schemas, "agentic", "agent", "types", "hooksource.json");
  const hookSource = JSON.parse(fs.readFileSync(hookSourcePath, "utf8")) as { fields: unknown[] };
  hookSource.fields.unshift(PLUGIN_MEMBER);
  fs.writeFileSync(hookSourcePath, JSON.stringify(hookSource, null, 2));
  const goOut = path.join(root, "go", "internal", "gen");
  const tsOut = path.join(root, "ts");
  runSDKClientGeneration(schemas, goOut);
  runSDKClientTSGeneration(schemas, tsOut);
  go = fs.readFileSync(path.join(goOut, "agent.go"), "utf8");
  ts = fs.readFileSync(path.join(tsOut, "agent.ts"), "utf8");
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("a reference member of a oneof", () => {
  it("is set in Go only when it names something, with the plugin kind filled", () => {
    expect(go).toContain(
      "\tif i.Plugin.Org != \"\" || i.Plugin.Slug != \"\" {\n" +
        "\t\tref := i.Plugin.toProto()\n" +
        "\t\tref.Kind = apiresourcekind.ApiResourceKind_plugin\n" +
        "\t\tp.Source = &agentv1.HookSource_Plugin{Plugin: ref}\n" +
        "\t}\n",
    );
    expect(go).not.toContain("i.Plugin != nil");
  });

  it("carries the plugin kind in TypeScript", () => {
    expect(ts).toContain(
      'msg.source = { case: "plugin", value: create(ApiResourceReferenceSchema, { ...input.plugin, kind: 58 }) };',
    );
  });
});
