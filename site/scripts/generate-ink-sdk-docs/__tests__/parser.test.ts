/**
 * Tests for the Ink SDK reference parser's props tables: a component's
 * `<Name>Props` interface becomes its field list, and a field typed by a
 * message from `@stigmer/protos` links to the run resource page (the
 * one protos type the Ink components take), while a field typed from any
 * other package, or by a local type, carries no link. The input is a minimal
 * TypeDoc JSON written to a temporary file.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseTypeDocJson } from "../parser";
import { ReflectionKind } from "../typedoc-types";
import type { Reflection, TypeDocProject, TypeDocType } from "../typedoc-types";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ink-sdk-docs-parser-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function property(id: number, name: string, type: TypeDocType, isOptional = false): Reflection {
  return { id, name, variant: "declaration", kind: ReflectionKind.Property, flags: { isOptional }, type };
}

function externalRef(name: string, packageName: string): TypeDocType {
  return {
    type: "reference",
    name,
    package: packageName,
    target: { packageName, packagePath: `src/${name}.ts`, qualifiedName: name },
  };
}

async function parse(children: Reflection[]) {
  const project: TypeDocProject = {
    schemaVersion: "2.0",
    id: 0,
    name: "@stigmer/ink",
    variant: "project",
    kind: ReflectionKind.Project,
    children,
    symbolIdMap: {},
    packageName: "@stigmer/ink",
  };
  const file = path.join(dir, "api.json");
  await fs.writeFile(file, JSON.stringify(project));
  return parseTypeDocJson(file);
}

describe("parseTypeDocJson — props fields", () => {
  it("links a protos-typed field to the run resource page and leaves others unlinked", async () => {
    const { reference } = await parse([
      {
        id: 1,
        name: "RunView",
        variant: "declaration",
        kind: ReflectionKind.Function,
        flags: {},
        signatures: [],
        sources: [{ fileName: "src/RunView.tsx", line: 1, character: 0, url: "https://example.test/RunView.tsx" }],
      },
      {
        id: 2,
        name: "RunViewProps",
        variant: "declaration",
        kind: ReflectionKind.Interface,
        flags: {},
        children: [
          property(3, "run", externalRef("Run", "@stigmer/protos")),
          property(4, "node", externalRef("ReactNode", "@types/react"), true),
          property(5, "width", { type: "intrinsic", name: "number" }, true),
        ],
      },
    ]);

    const [view] = reference.exports;
    expect(view.name).toBe("RunView");
    expect(view.category).toBe("component");
    expect(view.sourceUrl).toBe("https://example.test/RunView.tsx");
    expect(view.propsInterface?.name).toBe("RunViewProps");
    expect(view.propsInterface?.fields.map((f) => [f.name, f.required, f.typeLink])).toEqual([
      ["run", true, "/docs/sdk/resources/run"],
      ["node", false, null],
      ["width", false, null],
    ]);
  });
});
