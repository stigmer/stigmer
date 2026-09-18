/**
 * Which catalogues the audit reads: the vendors' public marketplaces, as
 * the product names them, at the commit a run pins or the default branch.
 *
 * The list has one home, `BUILT_IN_MARKETPLACES` in
 * `@stigmer/plugin-package/client`: the sources every client offers without
 * configuration. The audit reads the GitHub-hosted ones and skips the
 * official catalogue, which is what the audit's verdicts feed rather than
 * what they judge. When the product moves the vendors from built-ins to
 * suggestions, this module follows the list it imports and changes
 * nothing else.
 *
 * A `--ref owner/repo=<sha>` argument pins one vendor to a commit so a past
 * report can be reproduced or a vendoring re-run against the commit the
 * report named. A ref for a repository the list does not carry is refused:
 * the audit judges the catalogues the product offers, not an arbitrary
 * repository.
 */

import { BUILT_IN_MARKETPLACES } from "@stigmer/plugin-package/client";

import type { GitTreeSource } from "../lib/git-tree.js";

/** One catalogue the audit reads, under the name the product lists it by. */
export interface AuditSource extends GitTreeSource {
  /** The marketplace name a user installs from (`cursor-plugins`, ...). */
  readonly name: string;
}

/** The vendor catalogues, in the product's listing order, with any pinned refs applied. */
export function auditSources(pinnedRefs: ReadonlyMap<string, string>): readonly AuditSource[] {
  const sources: AuditSource[] = [];
  for (const marketplace of BUILT_IN_MARKETPLACES) {
    if (marketplace.source.type !== "github") continue;
    const repo = marketplace.source.repo;
    const ref = pinnedRefs.get(repo) ?? marketplace.source.ref;
    sources.push(ref === undefined ? { name: marketplace.name, repo } : { name: marketplace.name, repo, ref });
  }
  for (const repo of pinnedRefs.keys()) {
    if (!sources.some((source) => source.repo === repo)) {
      throw new Error(`--ref names '${repo}', which is not one of the catalogues the product lists: ${sources.map((s) => s.repo).join(", ")}`);
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
