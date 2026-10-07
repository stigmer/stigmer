// Pins that the custom option numbers retired with the workflow product stay
// unused. ai/stigmer/commons/apiresource/field_options.proto once declared
// is_expression (90203) and discriminated_by (90205) on FieldOptions and
// discriminator_value (90301) on MessageOptions; a descriptor written with
// one of them must never read as a different option, so no extension the
// generated TypeScript stubs define may take any of those numbers. Before
// this, only a comment in that file held the rule.
//
// The scan is every `*_pb.ts` module of the stubs package (`@stigmer/protos`,
// located through its own export map), imported by its package path, and the
// files those import, with every extension each file declares, top-level or
// nested. The resource
// api.proto closure alone is not enough: an option file only command or
// query protos import (rpc_service_options.proto, rpc/method_options.proto)
// sits outside it, so the scan is pinned to reach both of those and every
// file of that closure.
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type { DescExtension, DescFile } from "@bufbuild/protobuf";
import { nestedTypes } from "@bufbuild/protobuf/reflect";
import { describe, expect, it } from "vitest";

import { allStigmerFiles } from "../stigmer-registry.js";

const RETIRED_NUMBERS: ReadonlyMap<number, string> = new Map([
  [90203, "is_expression"],
  [90205, "discriminated_by"],
  [90301, "discriminator_value"],
]);

const PACKAGE = "@stigmer/protos";
const ANCHOR = "ai/stigmer/commons/apiresource/field_options_pb";

/** The stubs package's root: the anchor module resolves to `<root>/dist/<ANCHOR>.js`. */
function stubsRoot(): string {
  const resolved = createRequire(import.meta.url).resolve(`${PACKAGE}/${ANCHOR}`);
  const suffix = path.join("dist", `${ANCHOR}.js`);
  if (!resolved.endsWith(suffix)) throw new Error(`${PACKAGE}/${ANCHOR} resolved to ${resolved}, not <root>/${suffix}`);
  return resolved.slice(0, resolved.length - suffix.length);
}

/** Every generated descriptor module's package subpath (`ai/.../api_pb`), build output and dependencies aside. */
function descriptorModules(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (dir === root && (entry.name === "dist" || entry.name === "node_modules")) continue;
        walk(full);
      } else if (entry.name.endsWith("_pb.ts")) {
        out.push(path.relative(root, full).slice(0, -".ts".length).split(path.sep).join("/"));
      }
    }
  };
  walk(root);
  return out.sort();
}

function isDescFile(value: unknown): value is DescFile {
  return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "file";
}

/**
 * Every file descriptor the stubs package exports, with the files they import
 * (the well-known types come from @bufbuild/protobuf, not the stubs), by
 * proto file name.
 */
async function stubFiles(): Promise<Map<string, DescFile>> {
  const files = new Map<string, DescFile>();
  const visit = (file: DescFile): void => {
    if (files.has(file.proto.name)) return;
    files.set(file.proto.name, file);
    for (const dep of file.dependencies) visit(dep);
  };
  for (const subpath of descriptorModules(stubsRoot())) {
    const mod: Record<string, unknown> = await import(`${PACKAGE}/${subpath}`);
    for (const value of Object.values(mod)) {
      if (isDescFile(value)) visit(value);
    }
  }
  return files;
}

function extensionsOf(files: Iterable<DescFile>): DescExtension[] {
  const out: DescExtension[] = [];
  for (const file of files) {
    for (const desc of nestedTypes(file)) {
      if (desc.kind === "extension") out.push(desc);
    }
  }
  return out;
}

describe("retired custom option numbers", () => {
  it("are taken by no extension the generated stubs define", async () => {
    const files = await stubFiles();
    const extensions = extensionsOf(files.values());

    // The scan found something, and reaches past the resource api.proto
    // closure: field_options.proto's live options, the service option
    // rpc_service_options.proto declares and the method options
    // rpc/method_options.proto declares are all in it.
    const numberOf = (typeName: string): number | undefined =>
      extensions.find((ext) => ext.typeName === typeName)?.number;
    expect(numberOf("ai.stigmer.commons.apiresource.computed")).toBe(90201);
    expect(numberOf("ai.stigmer.commons.apiresource.api_resource_kind")).toBe(90100);
    expect(numberOf("ai.stigmer.commons.rpc.config")).toBe(50056);
    const missing = allStigmerFiles()
      .map((file) => file.proto.name)
      .filter((name) => !files.has(name));
    expect(missing, "every file of the resource api.proto closure is scanned").toEqual([]);

    const reused = extensions
      .filter((ext) => RETIRED_NUMBERS.has(ext.number))
      .map((ext) => `${ext.typeName} = ${ext.number} (retired ${RETIRED_NUMBERS.get(ext.number)})`);
    expect(reused).toEqual([]);
  });
});
