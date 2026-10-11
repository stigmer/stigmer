/**
 * The maintainer's report: what each entry becomes, in the product's words.
 *
 * Pins: the "Becomes" column counts an entry's skills, subagents and
 * servers, each singular or plural by its count, and an entry that becomes
 * nothing names the components it does carry.
 */

import { describe, expect, it } from "vitest";

import { classifyCatalogues } from "../scripts/audit/classify.js";
import type { CatalogueFacts, EntryFacts, EntryRead } from "../scripts/audit/entries.js";
import { renderMarkdown } from "../scripts/audit/report.js";
import type { AuditSource } from "../scripts/audit/sources.js";

const SOURCE: AuditSource = { name: "cursor-plugins", repo: "cursor/plugins" };

const readOk = (overrides: Partial<Extract<EntryRead, { ok: true }>>): EntryRead => ({
  ok: true,
  dialect: "cursor",
  skills: [],
  subAgents: [],
  servers: [],
  variables: [],
  hookEvents: [],
  ignored: [],
  warnings: [],
  digest: "0".repeat(64),
  filesIncluded: 3,
  ...overrides,
});

const entry = (name: string, read: EntryRead): EntryFacts => ({
  source: SOURCE,
  commit: "a".repeat(40),
  name,
  dir: name,
  licence: { licence: "mit", path: `${name}/LICENSE` },
  read,
});

function rowOf(entries: readonly EntryFacts[], name: string): string {
  const catalogue: CatalogueFacts = {
    source: SOURCE,
    commit: "a".repeat(40),
    marketplacePath: "marketplace.json",
    dialect: "cursor",
    entries,
    dropped: [],
    rootLicence: { licence: "none" },
  };
  const markdown = renderMarkdown({ generatedAt: "2026-10-12T00:00:00Z", catalogues: [catalogue], verdicts: classifyCatalogues([catalogue], new Map()), probes: [] });
  const row = markdown.split("\n").find((line) => line.startsWith(`| \`${name}\` |`));
  if (row === undefined) throw new Error(`no row for ${name}`);
  return row;
}

describe("renderMarkdown", () => {
  it("counts an entry's skills and subagents in the product's words", () => {
    const entries = [
      entry("reviewers", readOk({ skills: ["review"], subAgents: ["security", "style"] })),
      entry("one-agent", readOk({ subAgents: ["triage"] })),
    ];
    expect(rowOf(entries, "reviewers")).toContain("| 1 skill, 2 subagents |");
    expect(rowOf(entries, "one-agent")).toContain("| 1 subagent |");
  });

  it("names what an entry that becomes nothing carries", () => {
    const entries = [entry("rules-only", readOk({ ignored: [{ kind: "rules", path: "rules" }] }))];
    expect(rowOf(entries, "rules-only")).toContain("| nothing (rules) |");
  });
});
