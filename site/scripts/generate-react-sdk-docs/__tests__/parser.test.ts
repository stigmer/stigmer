/**
 * Tests for parseTypeDocJson's domain classification: an export lands in
 * the domain its source folder under sdk/react/src names, a known domain
 * carries its hand-written title and description, an unknown one falls
 * back to its slug, and an excluded domain or an export from outside the
 * SDK's sources is dropped. And for its links to the proto resource pages:
 * a field typed by a message from `@stigmer/apis`, or an `{@link}` to one
 * in a comment, links to the resource page its root message names, while a
 * message with no resource page, or a type from any other package, carries
 * no link. And for the package's entries: each domain names the entry its
 * exports import from, and which of its hooks ./headless also carries; an
 * entry the generator does not know, or a domain split across two, fails.
 * The input is a minimal TypeDoc JSON written to a temporary file.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseTypeDocJson } from "../parser";
import { ReflectionKind } from "../typedoc-types";
import type { ExternalTarget, Reflection, TypeDocProject, TypeDocType } from "../typedoc-types";

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
    name: "@stigmer/react-sdk",
    variant: "project",
    kind: ReflectionKind.Project,
    children,
    symbolIdMap: {},
    packageName: "@stigmer/react-sdk",
  };
  const file = path.join(dir, "api.json");
  await fs.writeFile(file, JSON.stringify(project));
  return parseTypeDocJson(file);
}

describe("parseTypeDocJson — domains", () => {
  it("gives a known domain its title and description", async () => {
    const { domains } = await parse([
      typeAlias(1, "SkillPickerProps", "sdk/react/src/skill/SkillPicker.tsx"),
    ]);

    expect(domains).toHaveLength(1);
    expect(domains[0]).toMatchObject({
      slug: "skill",
      title: "Skill",
      description: "Hooks and components for domain knowledge, search, picker, and detail views.",
    });
    expect(domains[0].types.map((t) => t.name)).toEqual(["SkillPickerProps"]);
  });

  it("falls back to the slug for a domain with no metadata, and sorts domains by slug", async () => {
    const { domains } = await parse([
      typeAlias(1, "Zeta", "sdk/react/src/zz-unlisted/zeta.ts"),
      typeAlias(2, "SkillPickerProps", "sdk/react/src/skill/SkillPicker.tsx"),
    ]);

    expect(domains.map((d) => d.slug)).toEqual(["skill", "zz-unlisted"]);
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

function hook(id: number, name: string, fileName: string): Reflection {
  return {
    id,
    name,
    variant: "declaration",
    kind: ReflectionKind.Function,
    flags: {},
    sources: [{ fileName, line: 1, character: 0 }],
    signatures: [
      { id: id + 1000, name, variant: "signature", kind: ReflectionKind.CallSignature, flags: {}, type: { type: "intrinsic", name: "void" } },
    ],
  };
}

function entry(id: number, name: string, children: Reflection[]): Reflection {
  return { id, name, variant: "declaration", kind: ReflectionKind.Module, flags: {}, children };
}

function reference(id: number, name: string, target: number): Reflection {
  return { id, name, variant: "reference", kind: ReflectionKind.Reference, flags: {}, target };
}

describe("parseTypeDocJson — the package's entries", () => {
  it("names each domain's entry, and the hooks ./headless leaves out", async () => {
    const { domains } = await parse([
      entry(100, "index", [
        hook(1, "useSession", "sdk/react/src/session/useSession.ts"),
        hook(2, "useExportTranscript", "sdk/react/src/session/useExportTranscript.ts"),
        typeAlias(3, "SkillPickerProps", "sdk/react/src/skill/SkillPicker.tsx"),
      ]),
      entry(200, "headless", [reference(201, "useSession", 1)]),
      entry(300, "console", [hook(4, "useSettingsNavGroups", "sdk/react/src/settings/nav.ts")]),
    ]);

    const bySlug = Object.fromEntries(domains.map((d) => [d.slug, d]));
    expect(domains.map((d) => d.slug)).toEqual(["session", "settings", "skill"]);
    expect(bySlug.session).toMatchObject({ importPath: "@stigmer/react-sdk", headless: { rootOnly: ["useExportTranscript"] } });
    expect(bySlug.settings).toMatchObject({ importPath: "@stigmer/react-sdk/console", headless: null });
    expect(bySlug.skill).toMatchObject({ importPath: "@stigmer/react-sdk", headless: null });
  });

  it("reads a single-entry run's top-level exports as the root's", async () => {
    const { domains } = await parse([typeAlias(1, "SkillPickerProps", "sdk/react/src/skill/SkillPicker.tsx")]);

    expect(domains[0]).toMatchObject({ importPath: "@stigmer/react-sdk", headless: null });
  });

  it("refuses an entry it has no import path for", async () => {
    await expect(parse([entry(100, "chat", [typeAlias(1, "Zeta", "sdk/react/src/skill/zeta.ts")])])).rejects.toThrow(
      /entry named "chat" that ENTRY_IMPORT_PATHS/,
    );
  });

  it("refuses a domain whose exports import from two entries", async () => {
    await expect(
      parse([
        entry(100, "index", [hook(1, "useSkill", "sdk/react/src/skill/useSkill.ts")]),
        entry(300, "console", [hook(2, "useSkillAdmin", "sdk/react/src/skill/admin.ts")]),
      ]),
    ).rejects.toThrow(/skill domain's exports import from @stigmer\/react-sdk and @stigmer\/react-sdk\/console/);
  });
});

function externalTarget(qualifiedName: string, packageName: string): ExternalTarget {
  return { packageName, packagePath: "dist/api_pb.d.ts", qualifiedName };
}

function externalRef(qualifiedName: string, packageName: string): TypeDocType {
  return {
    type: "reference",
    name: qualifiedName.split(".").at(-1) ?? qualifiedName,
    package: packageName,
    target: externalTarget(qualifiedName, packageName),
  };
}

function field(id: number, name: string, type: TypeDocType): Reflection {
  return { id, name, variant: "declaration", kind: ReflectionKind.Property, flags: {}, type };
}

describe("parseTypeDocJson — links to the proto resource pages", () => {
  async function sessionSummary(children: Reflection[], comment?: Reflection["comment"]) {
    const { domains } = await parse([
      {
        id: 1,
        name: "SessionSummary",
        variant: "declaration",
        kind: ReflectionKind.Interface,
        flags: {},
        sources: [{ fileName: "sdk/react/src/session/summary.ts", line: 1, character: 0 }],
        children,
        ...(comment ? { comment } : {}),
      },
    ]);
    const type = domains[0]?.types.find((t) => t.name === "SessionSummary");
    if (!type) throw new Error("SessionSummary was not parsed");
    return type;
  }

  it("links a field typed by an @stigmer/apis message to its root message's resource page", async () => {
    const type = await sessionSummary([
      field(2, "session", externalRef("Session", "@stigmer/apis")),
      field(3, "spec", externalRef("Agent.Spec", "@stigmer/apis")),
    ]);

    expect(type.fields.map((f) => [f.name, f.typeLink])).toEqual([
      ["session", "/docs/sdk/resources/session"],
      ["spec", "/docs/sdk/resources/agent"],
    ]);
  });

  it("gives no link to a message with no resource page, or a type from another package", async () => {
    const type = await sessionSummary([
      field(2, "usage", externalRef("UsageRecord", "@stigmer/apis")),
      field(3, "timestamp", externalRef("Timestamp", "@bufbuild/protobuf")),
    ]);

    expect(type.fields.map((f) => [f.name, f.typeLink])).toEqual([
      ["usage", null],
      ["timestamp", null],
    ]);
  });

  it("links an {@link} to an @stigmer/apis message in a comment to its resource page", async () => {
    const type = await sessionSummary([], {
      summary: [
        { kind: "text", text: "Summarizes a " },
        { kind: "inline-tag", tag: "@link", text: "Session", target: externalTarget("Session", "@stigmer/apis") },
        { kind: "text", text: " for " },
        { kind: "inline-tag", tag: "@link", text: "Timestamp", target: externalTarget("Timestamp", "@bufbuild/protobuf") },
        { kind: "text", text: " and " },
        { kind: "inline-tag", tag: "@link", text: "UsageRecord", target: externalTarget("UsageRecord", "@stigmer/apis") },
      ],
    });

    expect(type.description.filter((part) => part.kind === "link")).toEqual([
      { kind: "link", text: "Session", target: "/docs/sdk/resources/session" },
      { kind: "link", text: "Timestamp", target: null },
      { kind: "link", text: "UsageRecord", target: null },
    ]);
  });
});
