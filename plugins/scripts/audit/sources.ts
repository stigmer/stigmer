/**
 * Which catalogues the audit reads: the vendor marketplaces named in
 * `plugins/vendor.json`, each at the commit a run pins or its default
 * branch.
 *
 * The list has one home, the pin file (`../lib/vendor-pins.ts`): the same
 * `sources` the sync copies from at a pinned commit are the ones the audit
 * judges at their head, so "which vendors we read" and "at which commit we
 * copied" are never two lists. The product's built-in sources are not
 * consulted: what a client offers to browse and what this repository
 * curates from are different questions with different answers, and the
 * client list may shrink to the official catalogue alone without the
 * curation losing its vendors.
 *
 * A `--ref owner/repo=<sha>` argument pins one vendor to a commit so a past
 * report can be reproduced. A ref for a repository the pin file does not
 * carry is refused: the audit judges the catalogues the curation reads, not
 * an arbitrary repository.
 */

import type { GitTreeSource } from "../lib/git-tree.js";
import type { VendorPins } from "../lib/vendor-pins.js";

/** One catalogue the audit reads, under the name the pin file lists it by. */
export interface AuditSource extends GitTreeSource {
  /** The marketplace name a user installs from (`cursor-plugins`, ...). */
  readonly name: string;
}

/** The vendor catalogues in the pin file's order, at their default branch unless a ref pins them. */
export function auditSources(pins: VendorPins, pinnedRefs: ReadonlyMap<string, string>): readonly AuditSource[] {
  const sources: AuditSource[] = [];
  for (const [name, pin] of Object.entries(pins.sources)) {
    const ref = pinnedRefs.get(pin.repo);
    sources.push(ref === undefined ? { name, repo: pin.repo } : { name, repo: pin.repo, ref });
  }
  for (const repo of pinnedRefs.keys()) {
    if (!sources.some((source) => source.repo === repo)) {
      throw new Error(`--ref names '${repo}', which is not one of the catalogues vendor.json lists: ${sources.map((s) => s.repo).join(", ")}`);
    }
  }
  return sources;
}

/** Parse every `--ref owner/repo=<ref>` argument into a map; a malformed one is refused with its text. */
export function parsePinnedRefs(values: readonly string[]): ReadonlyMap<string, string> {
  const refs = new Map<string, string>();
  for (const value of values) {
    const at = value.indexOf("=");
    if (at <= 0 || at === value.length - 1) {
      throw new Error(`--ref expects 'owner/repo=<ref>', got '${value}'`);
    }
    refs.set(value.slice(0, at), value.slice(at + 1));
  }
  return refs;
}
