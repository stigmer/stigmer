/**
 * The preparation every client runs for an eval push: from an
 * already-selected evals/ folder, leave out the run output, refuse what
 * the server refuses, archive, digest, and say what the server will read.
 *
 * An eval is Claude Code's `evals/` folder pushed whole: its case
 * directories, `mocks/` and any shared files at the archive's root.
 * `results/` at the root is what `claude plugin eval` writes when it runs
 * the cases, never part of the suite, so it is left out before the archive
 * is built and two pushes of one suite have one digest whatever was run in
 * between. A folder holding a plugin manifest is a plugin, not its evals,
 * and is refused naming the folder to push instead; a folder where no case
 * loads is refused with the reader's findings, as the server refuses it.
 *
 * The archive is `archivePlugin`'s, the selection's order and the one
 * mtime, so the digest a client computes is the server's `status.digest`.
 * Refusals are returned, not thrown: each client renders them in its own
 * voice. Pinned by `__tests__/client-prepare-eval.test.ts`.
 */

import { hasPluginManifest } from "../detect.js";
import type { PluginFiles } from "../files.js";
import { readEvalFolder } from "../evals/read-eval-suite.js";
import type { EvalSuite, EvalSuiteFinding } from "../evals/types.js";
import { archivePlugin, digestArchive } from "./archive.js";
import type { SelectionStats } from "./select.js";

/** The run output `claude plugin eval` writes beside the cases; never pushed. */
export const EVAL_RESULTS_DIR = "results";

/** What a client holds after preparing an eval: the reading, the bytes a push sends, and their identity. */
export interface PreparedEval {
  /** The folder as the server will read it: its cases, findings and mocked servers. */
  readonly suite: EvalSuite;
  /** The files the archive carries, `results/` left out. */
  readonly files: PluginFiles;
  readonly stats: SelectionStats;
  /** The exact bytes a push sends. */
  readonly archive: Uint8Array;
  /** SHA-256 of `archive`, lowercase hex: the server's `status.digest` for these bytes. */
  readonly digest: string;
}

/** What a selected folder can come to. */
export type PrepareEvalOutcome =
  | { readonly ok: true; readonly prepared: PreparedEval }
  /** The folder holds a plugin manifest: push its evals/ folder instead. */
  | { readonly ok: false; readonly kind: "plugin-folder" }
  /** No case in the folder loads; `findings` say why, as the server would. */
  | { readonly ok: false; readonly kind: "no-cases"; readonly findings: readonly EvalSuiteFinding[] };

/**
 * Prepare an already-selected evals/ folder. `selection` is what
 * `selectPluginFiles` returns or what the CLI's walk builds in its shape;
 * its `files.read` must answer synchronously for every listed entry.
 */
export async function prepareEvalArchive(selection: {
  readonly files: PluginFiles;
  readonly stats: SelectionStats;
}): Promise<PrepareEvalOutcome> {
  const { files, stats } = withoutResults(selection);
  if (hasPluginManifest(files.entries.map((entry) => entry.path))) {
    return { ok: false, kind: "plugin-folder" };
  }
  const suite = readEvalFolder(files);
  if (suite.cases.length === 0) {
    return { ok: false, kind: "no-cases", findings: suite.findings };
  }
  const archive = archivePlugin(files);
  return { ok: true, prepared: { suite, files, stats, archive, digest: await digestArchive(archive) } };
}

/** The selection with the root `results/` directory left out, its files counted as ignored. */
function withoutResults(selection: { readonly files: PluginFiles; readonly stats: SelectionStats }): {
  readonly files: PluginFiles;
  readonly stats: SelectionStats;
} {
  const prefix = `${EVAL_RESULTS_DIR}/`;
  const dropped = selection.files.entries.filter((entry) => entry.path.startsWith(prefix));
  if (dropped.length === 0) return selection;
  const entries = selection.files.entries.filter((entry) => !entry.path.startsWith(prefix));
  const droppedSize = dropped.reduce((total, entry) => total + entry.size, 0);
  return {
    files: { entries, read: (path) => selection.files.read(path) },
    stats: {
      filesIncluded: selection.stats.filesIncluded - dropped.length,
      filesIgnored: selection.stats.filesIgnored + dropped.length,
      dirsSkipped: selection.stats.dirsSkipped + 1,
      totalSize: selection.stats.totalSize - droppedSize,
    },
  };
}
