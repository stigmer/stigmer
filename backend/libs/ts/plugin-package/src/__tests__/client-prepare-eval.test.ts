/**
 * Pins `prepareEvalArchive`, every client's eval push: the run output
 * under `results/` left out before the archive is built (so one suite has
 * one digest whatever ran in between) and counted as ignored; the digest
 * the deterministic archive's, so it equals the server's `status.digest`;
 * the offline reading the server's own (`readEvalFolder`); a folder
 * holding a plugin manifest refused as a plugin; a folder with no case
 * that loads refused with the reader's findings.
 */

import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { archivePlugin, digestArchive } from "../client/archive.js";
import { prepareEvalArchive } from "../client/prepare-eval.js";
import type { SelectionStats } from "../client/select.js";
import type { PluginFiles } from "../files.js";
import { inMemoryPluginFiles } from "../files.js";
import { readEvalFolder } from "../evals/read-eval-suite.js";
import { directoryPluginFiles } from "../__test-utils__/directory-files.js";

const FOLDER = fileURLToPath(new URL("./fixtures/evals/commit-helper/evals", import.meta.url));

function selectionOf(files: PluginFiles): { files: PluginFiles; stats: SelectionStats } {
  return {
    files,
    stats: {
      filesIncluded: files.entries.length,
      filesIgnored: 0,
      dirsSkipped: 0,
      totalSize: files.entries.reduce((total, entry) => total + entry.size, 0),
    },
  };
}

describe("prepareEvalArchive", () => {
  it("leaves results/ out, archives the rest deterministically, and reads it as the server will", async () => {
    const all = directoryPluginFiles(FOLDER);
    const results = all.entries.filter((entry) => entry.path.startsWith("results/"));
    expect(results.length).toBeGreaterThan(0);

    const outcome = await prepareEvalArchive(selectionOf(all));
    if (!outcome.ok) throw new Error(`refused: ${outcome.kind}`);
    const { prepared } = outcome;

    expect(prepared.files.entries.some((entry) => entry.path.startsWith("results/"))).toBe(false);
    expect(prepared.files.entries).toHaveLength(all.entries.length - results.length);
    expect(prepared.stats).toEqual({
      filesIncluded: all.entries.length - results.length,
      filesIgnored: results.length,
      dirsSkipped: 1,
      totalSize:
        all.entries.reduce((total, entry) => total + entry.size, 0) -
        results.reduce((total, entry) => total + entry.size, 0),
    });
    expect(prepared.digest).toBe(await digestArchive(archivePlugin(prepared.files)));
    expect(prepared.digest).toBe(await digestArchive(prepared.archive));
    expect(prepared.suite).toEqual(readEvalFolder(prepared.files));
    expect(prepared.suite.cases).toHaveLength(3);
  });

  it("gives one digest for one suite whatever results/ holds", async () => {
    const files = (extra: Record<string, string>) =>
      inMemoryPluginFiles(
        new Map(Object.entries({ "c/prompt.md": "Hi.", "c/graders/judge.md": "---\ntype: llm\n---\nPASS if it answers.\n", ...extra })),
      );
    const before = await prepareEvalArchive(selectionOf(files({})));
    const after = await prepareEvalArchive(selectionOf(files({ "results/run/aggregate-result.json": "{}" })));
    if (!before.ok || !after.ok) throw new Error("refused");
    expect(after.prepared.digest).toBe(before.prepared.digest);
  });

  it("refuses a folder holding a plugin manifest: its evals/ folder is the eval", async () => {
    const outcome = await prepareEvalArchive(
      selectionOf(inMemoryPluginFiles(new Map([[".claude-plugin/plugin.json", "{\"name\":\"x\"}"], ["evals/c/prompt.md", "Hi."]]))),
    );
    expect(outcome).toEqual({ ok: false, kind: "plugin-folder" });
  });

  it("refuses a folder where no case loads, with the reader's findings", async () => {
    const outcome = await prepareEvalArchive(selectionOf(inMemoryPluginFiles(new Map([["c/prompt.md", "Hi."]]))));
    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.kind !== "no-cases") throw new Error("expected a no-cases refusal");
    expect(outcome.findings.map((finding) => finding.path)).toEqual(["c"]);
  });

  it("refuses an empty folder with no findings", async () => {
    const outcome = await prepareEvalArchive(selectionOf(inMemoryPluginFiles(new Map([["README.md", "notes"]]))));
    expect(outcome).toEqual({ ok: false, kind: "no-cases", findings: [] });
  });
});
