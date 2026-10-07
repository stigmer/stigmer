/**
 * Pins the schema plugin's resource output over real descriptors from
 * @stigmer/protos: a resource's Spec message becomes one schema under its
 * namespace and subdomain, named for the message less "Spec", every type it
 * reaches lands under that resource's `types/`, and the spec's fields are the
 * ones the committed schema tree (tools/codegen/schemas) holds. Comments are
 * not under test here (the descriptors carry no source info).
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { create, createFileRegistry, type DescFile } from "@bufbuild/protobuf";
import {
  FileDescriptorSetSchema,
  type FileDescriptorProto,
} from "@bufbuild/protobuf/wkt";
import { file_ai_stigmer_agentic_agent_v1_spec } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { file_ai_stigmer_commons_apiresource_apiresourcekind_api_resource_group } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_group_pb";
import { describe, expect, it } from "vitest";

import { CommentIndex } from "../comments.js";
import { generateSchemas } from "../generate.js";
import { OptionsReader } from "../options.js";

/** Every file `roots` reaches, dependencies first, as a descriptor set's files. */
function closure(
  files: readonly DescFile[],
  seen = new Map<string, FileDescriptorProto>(),
): Map<string, FileDescriptorProto> {
  for (const file of files) {
    closure(file.dependencies, seen);
    if (!seen.has(file.name)) seen.set(file.name, file.proto);
  }
  return seen;
}

function generate() {
  const roots = [
    file_ai_stigmer_agentic_agent_v1_spec,
    file_ai_stigmer_commons_apiresource_apiresourcekind_api_resource_group,
  ];
  const registry = createFileRegistry(
    create(FileDescriptorSetSchema, { file: [...closure(roots).values()] }),
  );
  const moduleFiles = roots.map((root) => {
    const file = registry.getFile(root.proto.name);
    if (file === undefined)
      throw new Error(`${root.proto.name} is not in the registry`);
    return file;
  });
  return generateSchemas(moduleFiles, {
    comments: new CommentIndex(),
    options: new OptionsReader(registry),
  });
}

const COMMITTED = path.resolve(
  import.meta.dirname,
  "../../../schemas/agentic/agent/agent.json",
);

describe("the schema plugin's resource output", () => {
  it("writes a resource's Spec as one schema named for the message, with the reached types under types/", () => {
    const names = generate().map((file) => file.name);
    expect(names).toContain("agentic/agent/agent.json");
    expect(names).toContain("agentic/agent/types/runconfig.json");
    expect(
      names.filter(
        (name) =>
          name.startsWith("agentic/agent/") && !name.includes("/types/"),
      ),
    ).toEqual(["agentic/agent/agent.json"]);
  });

  it("gives the spec schema the committed schema's message and fields", () => {
    const generated = JSON.parse(
      generate().find((file) => file.name === "agentic/agent/agent.json")!
        .content,
    ) as {
      name: string;
      protoType: string;
      fields: { name: string }[];
    };
    const committed = JSON.parse(
      fs.readFileSync(COMMITTED, "utf8"),
    ) as typeof generated;
    expect(generated.name).toBe("AgentSpec");
    expect(generated.protoType).toBe(committed.protoType);
    expect(generated.fields.map((field) => field.name)).toEqual(
      committed.fields.map((field) => field.name),
    );
  });
});
