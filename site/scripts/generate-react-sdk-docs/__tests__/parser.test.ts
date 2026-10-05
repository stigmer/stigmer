/**
 * Tests for parseTypeDocJson's domain classification: an export lands in
 * the domain its source folder under sdk/react/src names, a known domain
 * carries its hand-written title and description, an unknown one falls
 * back to its slug, and an excluded domain or an export from outside the
 * SDK's sources is dropped. The input is a minimal TypeDoc JSON written to
 * a temporary file.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseTypeDocJson } from "../parser";
import { ReflectionKind } from "../typedoc-types";
import type { Reflection, TypeDocProject } from "../typedoc-types";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "react-sdk-docs-parser-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function typeAlias(id: number, name: string, fileName: string): Reflection {
  return {
    id,
    name,
    variant: "declaration",
    kind: ReflectionKind.TypeAlias,
    flags: {},
    sources: [{ fileName, line: 1, character: 0 }],
    type: { type: "intrinsic", name: "string" },
  };
}

async function parse(children: Reflection[]) {
  const project: TypeDocProject = {
    schemaVersion: "2.0",
    id: 0,
    name: "@stigmer/react",
    variant: "project",
    kind: ReflectionKind.Project,
    children,
    symbolIdMap: {},
    packageName: "@stigmer/react",
  };
  const file = path.join(dir, "api.json");
  await fs.writeFile(file, JSON.stringify(project));
  return parseTypeDocJson(file);
}

describe("parseTypeDocJson — domains", () => {
  it("gives a known domain its title and description", async () => {
    const { domains } = await parse([
      typeAlias(1, "RunEnvKeySource", "sdk/react/src/workflow/useRunEnvKeySources.ts"),
    ]);

    expect(domains).toHaveLength(1);
    expect(domains[0]).toMatchObject({
      slug: "workflow",
      title: "Workflow",
      description: "Hooks and components for workflow definitions, executions, and the visual builder.",
    });
    expect(domains[0].types.map((t) => t.name)).toEqual(["RunEnvKeySource"]);
  });

  it("falls back to the slug for a domain with no metadata, and sorts domains by slug", async () => {
    const { domains } = await parse([
      typeAlias(1, "Zeta", "sdk/react/src/zz-unlisted/zeta.ts"),
      typeAlias(2, "RunEnvKeySource", "sdk/react/src/workflow/useRunEnvKeySources.ts"),
    ]);

    expect(domains.map((d) => d.slug)).toEqual(["workflow", "zz-unlisted"]);
    expect(domains[1]).toMatchObject({ title: "zz-unlisted", description: "" });
  });

  it("drops excluded domains and exports from outside the SDK's sources", async () => {
    const { domains } = await parse([
      typeAlias(1, "TabsProps", "sdk/react/src/tabs/Tabs.tsx"),
      typeAlias(2, "Struct", "node_modules/@bufbuild/protobuf/dist/struct.d.ts"),
    ]);

    expect(domains).toEqual([]);
  });
});
