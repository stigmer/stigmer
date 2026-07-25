/**
 * Tests for renderMetaJson: the sidebar grouping contract of the React SDK
 * docs generator. The contract is an exact partition — every TypeDoc domain
 * belongs to exactly one DOMAIN_GROUPS group, and every listed slug must be a
 * real domain. Any drift fails generation with an actionable error.
 */

import { describe, it, expect } from "vitest";
import {
  renderMetaJson,
  DOMAIN_GROUPS,
  type DomainGroup,
} from "../renderer";
import type { Domain } from "../model";

function domain(slug: string): Domain {
  return {
    slug,
    title: slug,
    description: "",
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
    // Every non-separator entry is a domain, each exactly once.
    const pageSlugs = meta.pages.filter((p) => !separators.includes(p));
    expect(pageSlugs.sort()).toEqual(
      DOMAIN_GROUPS.flatMap((g) => g.slugs).sort(),
    );
  });
});
