/**
 * What a sync will do, decided over data; pure.
 *
 * Three decisions live here and nowhere else. `pinsFromAudit` turns an
 * audit's verdicts into the next pin file: the audit's sources at the
 * commits it read, one row per `vendor` verdict that is not struck and
 * whose folder can carry its own licence, each with the digest the audit
 * computed over the vendor's tree, the strikes carried forward.
 * `planTree` turns the previous and the next pins into the acts on the
 * tree: every next row is copied whole (a copy of what is already there is
 * the no-op the idempotence promise needs), every previous row that is
 * gone is deleted, and a row that would land on a folder that is not a
 * previous row (an authored plugin, a stray directory) is refused, because
 * the sync never overwrites what it did not write. `settleCommits` keeps a
 * source's pin where it was when the sync changed no byte under any of
 * its folders and no row, so a vendor's unrelated commits never produce a
 * weekly pin-only diff.
 *
 * `main.ts` runs the acts; the suite proves the decisions over fixtures.
 */

import { comparePaths } from "@stigmer/plugin-package";

import type { AuditRun } from "../audit/report.js";
import type { VendorPins, VendorPluginRow, VendorSourcePin, VendorStrike } from "../lib/vendor-pins.js";

/** A `vendor` verdict the next pins leave out, and why; listed in the sync's summary. */
export interface SkippedEntry {
  readonly source: string;
  readonly name: string;
  readonly reason: string;
}

export interface ProposedPins {
  readonly pins: VendorPins;
  readonly skipped: readonly SkippedEntry[];
}

/**
 * The next pin file from an audit run. Every catalogue the audit read
 * becomes a source at the commit it was read at; a `vendor` verdict becomes
 * a row unless it is struck or its licence lives outside its folder (rule 1
 * for a copy: the copy must carry the text that permits it). Strikes carry
 * over from `previous`, plus `extraStrikes` given on the command line.
 */
export function pinsFromAudit(audit: AuditRun, previous: VendorPins, extraStrikes: readonly VendorStrike[] = []): ProposedPins {
  const struck = mergeStrikes(previous.struck, extraStrikes);
  const sources: Record<string, VendorSourcePin> = {};
  for (const catalogue of audit.catalogues) {
    sources[catalogue.source.name] = { repo: catalogue.source.repo, commit: catalogue.commit };
  }

  const rows: VendorPluginRow[] = [];
  const skipped: SkippedEntry[] = [];
  const seen = new Map<string, string>();
  for (const judged of audit.verdicts.entries) {
    if (judged.verdict.kind !== "vendor") continue;
    const { source, name, dir, licence } = judged.entry;
    if (struck.some((strike) => strike.source === source.name && strike.name === name)) {
      skipped.push({ source: source.name, name, reason: "struck" });
      continue;
    }
    const licencePath = licence.path;
    const prefix = `${dir}/`;
    if (licencePath === undefined || !licencePath.startsWith(prefix)) {
      skipped.push({ source: source.name, name, reason: "its licence is the repository's root file, not the folder's; a copy could not carry the text that permits it" });
      continue;
    }
    const other = seen.get(name);
    if (other !== undefined) {
      skipped.push({ source: source.name, name, reason: `'${name}' is already vendored from ${other}; strike one of the two` });
      continue;
    }
    if (!judged.entry.read.ok) {
      skipped.push({ source: source.name, name, reason: "the audit graded it vendor without a successful read; the report and the verdict disagree" });
      continue;
    }
    seen.set(name, source.name);
    rows.push({ name, source: source.name, path: dir, licence: licencePath.slice(prefix.length), digest: judged.entry.read.digest });
  }

  return { pins: { sources, plugins: rows, struck }, skipped };
}

/** Strikes by `source/name`, the later list winning on the reason. */
function mergeStrikes(previous: readonly VendorStrike[], extra: readonly VendorStrike[]): readonly VendorStrike[] {
  const byKey = new Map<string, VendorStrike>();
  for (const strike of [...previous, ...extra]) byKey.set(`${strike.source}/${strike.name}`, strike);
  return [...byKey.values()];
}

export interface TreePlan {
  /** Rows to copy from their source at its pinned commit, replacing the folder. */
  readonly copies: readonly VendorPluginRow[];
  /** Folder names to remove: previous rows the next pins no longer carry. */
  readonly deletions: readonly string[];
}

/**
 * The acts that make the tree agree with `next`, given `previous` (what the
 * sync itself wrote last time) and `onDisk` (every directory at the
 * catalogue root that holds a plugin manifest). Refuses, naming the folder,
 * when a next row would land on a directory that is not a previous row.
 */
export function planTree(previous: VendorPins, next: VendorPins, onDisk: ReadonlySet<string>): TreePlan {
  const previousNames = new Set(previous.plugins.map((row) => row.name));
  for (const row of next.plugins) {
    if (onDisk.has(row.name) && !previousNames.has(row.name)) {
      throw new Error(`'${row.name}' from ${row.source} would replace a folder the sync did not write (an authored plugin, or a directory added by hand); rename the authored plugin or strike the entry`);
    }
  }
  const nextNames = new Set(next.plugins.map((row) => row.name));
  const deletions = previous.plugins.map((row) => row.name).filter((name) => !nextNames.has(name) && onDisk.has(name));
  return { copies: [...next.plugins].sort((a, b) => comparePaths(a.name, b.name)), deletions: deletions.sort(comparePaths) };
}

/**
 * The commits to write: a source keeps its previous commit when the sync
 * changed no bytes under its folders and its row set is unchanged;
 * otherwise it takes the commit the copies were made at. A source new to
 * the pins takes the new commit.
 */
export function settleCommits(previous: VendorPins, next: VendorPins, changedSources: ReadonlySet<string>): VendorPins {
  const sources: Record<string, VendorSourcePin> = {};
  for (const [name, pin] of Object.entries(next.sources)) {
    const before = previous.sources[name];
    const rowsBefore = previous.plugins.filter((row) => row.source === name).map(rowKey).sort();
    const rowsAfter = next.plugins.filter((row) => row.source === name).map(rowKey).sort();
    const sameRows = rowsBefore.length === rowsAfter.length && rowsBefore.every((key, index) => key === rowsAfter[index]);
    sources[name] = before !== undefined && sameRows && !changedSources.has(name) ? before : pin;
  }
  return { ...next, sources };
}

function rowKey(row: VendorPluginRow): string {
  return `${row.name}\u0000${row.path}\u0000${row.licence}\u0000${row.digest}`;
}

/**
 * The marketplace's plugin order: by name. The storefront shows entries in
 * this order and nothing sorts after it, so the order is a decision written
 * once here.
 */
export function marketplaceOrder(names: ReadonlySet<string>): readonly string[] {
  return [...names].sort(comparePaths);
}
