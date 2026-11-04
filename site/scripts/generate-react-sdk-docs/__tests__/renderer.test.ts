/**
 * Tests for the React SDK docs renderer. renderMetaJson holds the sidebar
 * grouping contract: an exact partition — every TypeDoc domain belongs to
 * exactly one DOMAIN_GROUPS group, and every listed slug must be a real
 * domain. Any drift fails generation with an actionable error.
 * renderDomainPage opens each domain's page with its frontmatter, the
 * do-not-edit banner naming `@stigmer/react-sdk`, and the entry its names
 * import from (with the hooks that `./headless` leaves out, when it carries
 * any of the page's), and renders a section only for what the domain has.
 */

import { describe, it, expect } from "vitest";
import {
  renderDomainPage,
  renderMetaJson,
  DOMAIN_GROUPS,
  HAND_WRITTEN_PAGES,
  type DomainGroup,
} from "../renderer";
import type { Domain } from "../model";

function domain(slug: string): Domain {
  return {
    slug,
    title: slug,
    description: "",
    importPath: "@stigmer/react-sdk",
    headless: null,
    hooks: [],
    components: [],
    types: [],
  };
}

const TEST_GROUPS: readonly DomainGroup[] = [
  { label: "Foundation", slugs: ["core"] },
  { label: "Tools & Knowledge", slugs: ["mcp-server", "skill"] },
];

describe("renderMetaJson", () => {
  it("emits a ---Label--- separator before each group's pages, in group order", () => {
    const out = renderMetaJson(
      [domain("skill"), domain("core"), domain("mcp-server")],
      TEST_GROUPS,
      {},
    );
    const meta = JSON.parse(out) as { title: string; pages: string[] };

    expect(meta.title).toBe("React SDK");
    expect(meta.pages).toEqual([
      "---Foundation---",
      "core",
      "---Tools & Knowledge---",
      "mcp-server",
      "skill",
    ]);
  });

  it("names each hand-written page first in its group, so the sidebar lists it", () => {
    const meta = JSON.parse(
      renderMetaJson([domain("skill"), domain("core"), domain("mcp-server")], TEST_GROUPS, { Foundation: ["gallery"] }),
    ) as { pages: string[] };
    expect(meta.pages.slice(0, 3)).toEqual(["---Foundation---", "gallery", "core"]);
    expect(JSON.parse(renderMetaJson([domain("core"), domain("skill"), domain("mcp-server")], TEST_GROUPS)).pages).toContain("gallery");
  });

  it("orders pages by the group definition, not by domain input order", () => {
    const shuffled = [domain("mcp-server"), domain("skill"), domain("core")];
    const meta = JSON.parse(renderMetaJson(shuffled, TEST_GROUPS)) as {
      pages: string[];
    };
    expect(meta.pages.indexOf("core")).toBeLessThan(
      meta.pages.indexOf("mcp-server"),
    );
  });

  it("ends with a trailing newline and stable 2-space JSON formatting", () => {
    const out = renderMetaJson(
      [domain("core"), domain("mcp-server"), domain("skill")],
      TEST_GROUPS,
    );
    expect(out.endsWith("\n")).toBe(true);
    expect(out).toBe(JSON.stringify(JSON.parse(out), null, 2) + "\n");
  });

  it("fails loudly when a domain has no group assignment", () => {
    const domains = [
      domain("core"),
      domain("mcp-server"),
      domain("skill"),
      domain("brand-new-domain"),
    ];
    expect(() => renderMetaJson(domains, TEST_GROUPS)).toThrowError(
      /brand-new-domain.*no group assignment.*renderer\.ts/,
    );
  });

  it("fails loudly when a listed slug no longer exists as a domain", () => {
    const domains = [domain("core"), domain("skill")]; // mcp-server missing
    expect(() => renderMetaJson(domains, TEST_GROUPS)).toThrowError(
      /mcp-server.*no TypeDoc domain produces.*renderer\.ts/,
    );
  });

  it("fails loudly when a slug is listed in more than one group", () => {
    const groups: readonly DomainGroup[] = [
      { label: "A", slugs: ["core", "skill"] },
      { label: "B", slugs: ["skill"] },
    ];
    expect(() =>
      renderMetaJson([domain("core"), domain("skill")], groups),
    ).toThrowError(/skill.*more.*than one group/);
  });

  it("reports every drifted slug, not just the first", () => {
    const domains = [domain("core"), domain("extra-a"), domain("extra-b")];
    const groups: readonly DomainGroup[] = [
      { label: "Foundation", slugs: ["core"] },
    ];
    expect(() => renderMetaJson(domains, groups)).toThrowError(
      /extra-a, extra-b/,
    );
  });

  it("DOMAIN_GROUPS itself has no duplicate slugs (partition invariant)", () => {
    const all = DOMAIN_GROUPS.flatMap((g) => g.slugs);
    expect(new Set(all).size).toBe(all.length);
  });

  it("renders the production DOMAIN_GROUPS cleanly for a matching domain set", () => {
    const domains = DOMAIN_GROUPS.flatMap((g) => g.slugs).map(domain);
    const meta = JSON.parse(renderMetaJson(domains)) as { pages: string[] };

    const separators = meta.pages.filter(
      (p) => p.startsWith("---") && p.endsWith("---"),
    );
    expect(separators).toEqual(DOMAIN_GROUPS.map((g) => `---${g.label}---`));
    // Every non-separator entry is a domain or a hand-written page, each exactly once.
    const pageSlugs = meta.pages.filter((p) => !separators.includes(p));
    expect(pageSlugs.sort()).toEqual(
      [...DOMAIN_GROUPS.flatMap((g) => g.slugs), ...Object.values(HAND_WRITTEN_PAGES).flat()].sort(),
    );
    // Every hand-written page's group is one the sidebar has.
    expect(Object.keys(HAND_WRITTEN_PAGES).filter((label) => !DOMAIN_GROUPS.some((g) => g.label === label))).toEqual([]);
  });
});

describe("renderDomainPage", () => {
  it("opens with the frontmatter and the do-not-edit banner naming the SDK", () => {
    const page = renderDomainPage({
      ...domain("skill"),
      title: "Skill",
      description: "Hooks and components for domain knowledge.",
    });
    expect(page).toBe(
      "---\ntitle: Skill\ndescription: Hooks and components for domain knowledge.\n---\n\n" +
        "{/* Auto-generated by @stigmer/react-sdk docs generator. DO NOT EDIT. */}\n" +
        "\nImport from `@stigmer/react-sdk`.\n",
    );
  });

  it("names the entry a console page's exports import from", () => {
    expect(renderDomainPage({ ...domain("sidebar"), importPath: "@stigmer/react-sdk/console" })).toContain(
      "\nImport from `@stigmer/react-sdk/console`.\n",
    );
  });

  it("says the page's hooks also import from ./headless, naming the ones that do not", () => {
    const line = (rootOnly: string[]) =>
      renderDomainPage({ ...domain("session"), headless: { rootOnly } }).split("\n").find((l) => l.startsWith("Import from"));

    expect(line([])).toBe(
      "Import from `@stigmer/react-sdk`. The hooks and helpers on this page also import from " +
        "`@stigmer/react-sdk/headless`, which leaves the components out.",
    );
    expect(line(["useExportTranscript"])).toMatch(/out, except `useExportTranscript`, which imports from the root only\.$/);
    expect(line(["useA", "useB", "useC"])).toMatch(/out, except `useA`, `useB` and `useC`, which import from the root only\.$/);
  });

  it("leaves the description out of the frontmatter when the domain has none", () => {
    expect(renderDomainPage(domain("zz-unlisted"))).toMatch(/^---\ntitle: zz-unlisted\n---\n/);
  });

  it("writes each hook's, component's and type's examples as tsx fences under its section", () => {
    const example = (code: string) => [{ meta: 'title="x.tsx"', code }];
    const page = renderDomainPage({
      ...domain("skill"),
      hooks: [
        {
          name: "useSkill",
          description: [],
          signature: { name: "useSkill", typeParameters: [], parameters: [], returnType: "void", imports: [] },
          parameters: [],
          returnType: { name: "void", typeString: "void" },
          returnInterface: null,
          examples: example("useSkill();"),
          sourceUrl: "",
        },
      ],
      components: [{ name: "SkillPicker", description: [], hasProps: false, propsInterface: null, examples: example("<SkillPicker />"), sourceUrl: "" }],
      types: [
        { name: "skillLabel", description: [], category: "other", fields: [], associatedExport: null, signature: null, examples: example("skillLabel(s);") },
      ],
    });
    for (const code of ["useSkill();", "<SkillPicker />", "skillLabel(s);"]) {
      expect(page).toContain('```tsx title="x.tsx"\n' + code + "\n```\n");
    }
  });

  it("writes a hook's signature under **Signature**, and a helper's above its examples", () => {
    const signature = (name: string) => ({
      name,
      typeParameters: [],
      parameters: [{ name: "run", type: "Run", memberType: "Run", optional: false, rest: false }],
      returnType: "string",
      imports: [{ name: "Run", from: "@stigmer/apis/run_pb" }],
    });
    const page = renderDomainPage({
      ...domain("run"),
      hooks: [
        { name: "useRunLabel", description: [], signature: signature("useRunLabel"), parameters: [], returnType: { name: "string", typeString: "string" }, returnInterface: null, examples: [], sourceUrl: "" },
      ],
      types: [{ name: "runLabel", description: [], category: "other", fields: [], associatedExport: null, signature: signature("runLabel"), examples: [] }],
    });
    const fence = (name: string) => '```tsx\nimport type { Run } from "@stigmer/apis/run_pb";\n// ---cut---\nfunction ' + name + "(run: Run): string\n```\n";
    expect(page).toContain("**Signature**\n\n" + fence("useRunLabel"));
    expect(page).toContain("### runLabel\n\n" + fence("runLabel"));
  });

  it("renders a Types section for a standalone type, with its fields' links", () => {
    const page = renderDomainPage({
      ...domain("session"),
      types: [
        {
          name: "SessionSummary",
          description: [{ kind: "text", text: "A session at a glance." }],
          category: "other",
          fields: [
            {
              name: "session",
              typeString: "Session",
              description: "The session.",
              required: true,
              typeLink: "/docs/sdk/resources/session",
            },
          ],
          associatedExport: null,
          signature: null,
          examples: [],
        },
      ],
    });
    expect(page).not.toContain("## Hooks");
    expect(page).not.toContain("## Components");
    expect(page).toContain("\n## Types\n\n### SessionSummary\n\nA session at a glance.\n\n");
    expect(page).toContain(
      '    session: { type: "Session", description: "The session.", required: true, typeDescriptionLink: "/docs/sdk/resources/session" },',
    );
  });
});
