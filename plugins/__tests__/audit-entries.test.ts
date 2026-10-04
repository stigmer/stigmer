/**
 * Pins what the audit reads from a checked-out tree and how the report names
 * a plugin that is only hooks: the events of the tool-call hooks an install records
 * are recorded per entry, and an entry whose hooks Stigmer does not run
 * reads as "nothing (hooks)" in the report, beside what it carries that is
 * not installed, and fails "becomes something" without being told its
 * hooks are not installed.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { classifyCatalogues } from "../scripts/audit/classify.js";
import { readCatalogue } from "../scripts/audit/entries.js";
import type { CatalogueFacts } from "../scripts/audit/entries.js";
import { renderMarkdown } from "../scripts/audit/report.js";
import { listDirectory } from "../scripts/lib/candidates.js";

const SOURCE = { name: "cursor-plugins", repo: "cursor/plugins" };
let root: string;
let catalogue: CatalogueFacts;

function write(rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

function cursorHooksPlugin(name: string, hooks: Readonly<Record<string, unknown>>): void {
  write(`${name}/.cursor-plugin/plugin.json`, JSON.stringify({ name, hooks: "./hooks/hooks.json" }));
  write(`${name}/hooks/hooks.json`, JSON.stringify({ version: 1, hooks }));
  write(`${name}/LICENSE`, "MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy");
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "stigmer-audit-entries-"));
  write(
    ".cursor-plugin/marketplace.json",
    JSON.stringify({ name: "cursor-plugins", owner: { name: "Cursor" }, plugins: [{ name: "loop", source: "loop" }, { name: "guard", source: "guard" }] }),
  );
  cursorHooksPlugin("loop", { stop: [{ command: "./hooks/stop.sh" }] });
  write("loop/rules/style.mdc", "Prefer small functions.");
  cursorHooksPlugin("guard", { preToolUse: [{ command: "./hooks/guard.sh", matcher: "Shell" }], stop: [{ command: "./hooks/stop.sh" }] });
  catalogue = await readCatalogue(SOURCE, { source: { repo: SOURCE.repo }, dir: root, commit: "a".repeat(40) }, listDirectory(root));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("a catalogue of hooks-only plugins", () => {
  it("records the events of the tool-call hooks an install records, and none for hooks it does not read", () => {
    const events = catalogue.entries.map((entry) => [entry.name, entry.read.ok ? entry.read.hookEvents : null]);
    expect(events).toEqual([
      ["loop", []],
      ["guard", ["preToolUse"]],
    ]);
  });

  it("reports each as becoming nothing but hooks, never as hooks not installed", () => {
    const verdicts = classifyCatalogues([catalogue], new Map());
    const report = renderMarkdown({ generatedAt: "2026-10-05", catalogues: [catalogue], verdicts, probes: [] });
    expect(report).toContain("nothing (hooks, rules)");
    expect(report).toContain("nothing (hooks)");
    expect(report).not.toContain("hooks, which Stigmer does not install");
    expect(verdicts.entries.map((judged) => (judged.verdict.kind === "exclude" ? judged.verdict.failures.map((f) => f.detail) : []))).toEqual([
      ["it carries no skill, sub-agent or MCP server, only hooks Stigmer does not run; and rules, which Stigmer does not install"],
      ["it carries no skill, sub-agent or MCP server, only hooks"],
    ]);
  });
});
