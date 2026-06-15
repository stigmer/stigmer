import { create } from "@bufbuild/protobuf";
import { ApiResourceKindMetaSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import {
  protoToJsonValue,
  renderProtoJson,
  renderProtoListJson,
  renderProtoListYaml,
  renderProtoYaml,
} from "./proto.js";

// A small, stable generated message exercising snake_case fields (display_name,
// id_prefix, is_versioned) and default-omission (group/version/tier enums = 0).
function sampleMeta() {
  return create(ApiResourceKindMetaSchema, {
    name: "Agent",
    displayName: "Agent",
    idPrefix: "agt",
    isVersioned: true,
  });
}

describe("renderProtoJson — protojson parity", () => {
  it("uses proto (snake_case) field names", () => {
    const parsed = JSON.parse(renderProtoJson(ApiResourceKindMetaSchema, sampleMeta()));
    expect(parsed).toEqual({
      name: "Agent",
      display_name: "Agent",
      id_prefix: "agt",
      is_versioned: true,
    });
  });

  it("omits unpopulated (default-valued) fields", () => {
    const parsed = JSON.parse(renderProtoJson(ApiResourceKindMetaSchema, sampleMeta()));
    expect(parsed).not.toHaveProperty("group");
    expect(parsed).not.toHaveProperty("tier");
    expect(parsed).not.toHaveProperty("authorization");
  });

  it("pretty-prints with a trailing newline", () => {
    const rendered = renderProtoJson(ApiResourceKindMetaSchema, sampleMeta());
    expect(rendered.endsWith("\n")).toBe(true);
    expect(rendered).toContain('  "name": "Agent"');
  });
});

describe("renderProtoYaml — round-trips through the same JSON value", () => {
  it("yields the same field names and values as the JSON renderer", () => {
    const meta = sampleMeta();
    const fromYaml = parseYaml(renderProtoYaml(ApiResourceKindMetaSchema, meta));
    expect(fromYaml).toEqual(protoToJsonValue(ApiResourceKindMetaSchema, meta));
  });
});

describe("list renderers", () => {
  it("renders a JSON array of messages", () => {
    const parsed = JSON.parse(
      renderProtoListJson(ApiResourceKindMetaSchema, [sampleMeta(), sampleMeta()]),
    );
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id_prefix).toBe("agt");
  });

  it("renders a YAML array equal to the JSON-value array", () => {
    const items = [sampleMeta()];
    const fromYaml = parseYaml(renderProtoListYaml(ApiResourceKindMetaSchema, items));
    expect(fromYaml).toEqual(items.map((m) => protoToJsonValue(ApiResourceKindMetaSchema, m)));
  });
});
