/**
 * Pins frontmatter parsing against Go's frontmatter_test.go table: the
 * delimiter rules, required-name enforcement, and the kebab-case /
 * dot-scoped name pattern. Error copy is wire-visible teaching text — the
 * assertions check the load-bearing first lines.
 */
import { describe, expect, it } from "vitest";

import { parseFrontmatter } from "../storage/frontmatter.js";

function skillMd(frontmatter: string, body = "# Title"): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

describe("parseFrontmatter", () => {
  it("parses name, description, and version", () => {
    const fm = parseFrontmatter(
      skillMd("name: web-scraper\ndescription: Scrapes pages\nversion: 1.0.0"),
    );
    expect(fm).toEqual({
      name: "web-scraper",
      description: "Scrapes pages",
      version: "1.0.0",
    });
  });

  it("accepts dot-scoped namespace names", () => {
    expect(
      parseFrontmatter(skillMd("name: platform.planton-architecture")).name,
    ).toBe("platform.planton-architecture");
  });

  it("defaults description and version to empty", () => {
    const fm = parseFrontmatter(skillMd("name: calculator"));
    expect(fm.description).toBe("");
    expect(fm.version).toBe("");
  });

  it("rejects empty content", () => {
    expect(() => parseFrontmatter("")).toThrow("SKILL.md is empty");
  });

  it("rejects content that does not start with ---", () => {
    expect(() => parseFrontmatter("# No frontmatter")).toThrow(
      "SKILL.md must start with YAML frontmatter (---)",
    );
  });

  it("rejects unclosed frontmatter", () => {
    expect(() => parseFrontmatter("---\nname: x")).toThrow(
      "SKILL.md frontmatter is not closed (missing closing ---)",
    );
  });

  it("rejects empty frontmatter", () => {
    expect(() => parseFrontmatter("---\n---\n# Body")).toThrow(
      "SKILL.md has empty frontmatter",
    );
  });

  it("rejects a missing name field", () => {
    expect(() => parseFrontmatter(skillMd("description: no name here"))).toThrow(
      "SKILL.md is missing required 'name' field in YAML frontmatter",
    );
  });

  it("rejects malformed YAML", () => {
    expect(() => parseFrontmatter(skillMd("name: [unclosed"))).toThrow(
      "failed to parse YAML frontmatter",
    );
  });

  it("rejects duplicated mapping keys (yaml.v3 and js-yaml both refuse)", () => {
    expect(() => parseFrontmatter(skillMd("name: a\nname: b"))).toThrow(
      "failed to parse YAML frontmatter",
    );
  });

  it("rejects a BOM'd first line — Go's TrimSpace does not strip U+FEFF (#8 parity review)", () => {
    expect(() => parseFrontmatter(`\uFEFF${skillMd("name: bom-skill")}`)).toThrow(
      "SKILL.md must start with YAML frontmatter (---)",
    );
  });

  it("accepts Unicode-whitespace-padded delimiters — Go trims the full White_Space set", () => {
    // U+2000 (en quad) is White_Space: Go's TrimSpace reduces the line to
    // "---" and accepts the file; the port must agree.
    const fm = parseFrontmatter(`\u2000---\u2000\nname: padded-skill\n\u3000---\n# Body`);
    expect(fm.name).toBe("padded-skill");
  });

  it("reports a first line over the 64KB scanner cap as empty — Go's !Scan() arm, bug-for-bug", () => {
    const longFirstLine = "x".repeat(64 * 1024 + 1);
    expect(() => parseFrontmatter(`${longFirstLine}\n---\nname: a\n---`)).toThrow(
      "SKILL.md is empty",
    );
  });

  it("reports an over-cap line INSIDE the frontmatter as the scanner error, beating 'not closed'", () => {
    const longLine = `description: ${"y".repeat(64 * 1024)}`;
    expect(() => parseFrontmatter(`---\nname: a\n${longLine}\n---`)).toThrow(
      "error reading SKILL.md content: bufio.Scanner: token too long",
    );
  });

  const badNames = [
    "Web-Scraper", // uppercase
    "web scraper", // space
    "-leading", // leading separator
    "trailing-", // trailing separator
    "double--hyphen", // consecutive separators
    "dot..dot", // consecutive dots
    ".leading-dot",
    "trailing-dot.",
    "under_score",
  ];
  for (const name of badNames) {
    it(`rejects the invalid name ${JSON.stringify(name)}`, () => {
      expect(() => parseFrontmatter(skillMd(`name: ${JSON.stringify(name)}`))).toThrow(
        `invalid skill name '${name}' in SKILL.md`,
      );
    });
  }
});
