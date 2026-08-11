/**
 * Naming policy for execution attachments — the single owner of the rule that
 * resolves duplicate attachment filenames (issue #364).
 *
 * Both harnesses materialize attachments into the platform inputs namespace
 * keyed by filename, so two attachments carrying the same name contend for
 * one on-disk path. Before this module existed each harness had an accidental
 * answer: the deep-agent injector failed the whole execution on the collision
 * and the Cursor resolver silently overwrote the earlier file. The platform
 * answer is neither — a duplicate is mechanically renamed (`report.pdf`,
 * `report-2.pdf`, ...) and the rename is disclosed to the agent through the
 * input-files prompt section, so no execution is ever burned over a
 * resolvable name and no user file silently vanishes.
 *
 * The `stem-2.ext` semantics deliberately mirror the React SDK composer's
 * client-side rename (sdk/react/src/attachment/attachment-utils.ts,
 * `uniquifyFilename` — kept in sync by hand, the packages share no
 * dependency), so a user sees the same rename shape whether the client or the
 * runner performed it.
 *
 * Scope: this module owns NAMES only. What constitutes a collision is the
 * caller's business — the deep-agent injector keys on full mount paths
 * (explicit `mountPath` values participate), the Cursor resolver keys on bare
 * filenames under `inputs/`. Callers that consider a collision a user
 * contradiction (two attachments explicitly pinning the same mount path)
 * keep rejecting; only mechanically derived names are renamed.
 */

/** The outcome of allocating a unique name for one attachment. */
export interface AllocatedName {
  /** The final name — unchanged when it was free, `stem-N.ext` otherwise. */
  readonly name: string;
  /**
   * The original requested name, present only when a rename happened — the
   * disclosure payload the prompt builders render so the agent can still
   * connect "the two report.pdfs" in the user's message to distinct files.
   */
  readonly renamedFrom?: string;
}

/**
 * Returns `name` unchanged when it is not in `taken`, otherwise the first
 * free `stem-2.ext`, `stem-3.ext`, … variant.
 *
 * Byte-for-byte twin of the React SDK's `uniquifyFilename`
 * (sdk/react/src/attachment/attachment-utils.ts) so client-side and
 * runner-side renames are indistinguishable to the user.
 */
export function uniquifyFilename(
  name: string,
  taken: ReadonlySet<string>,
): string {
  if (!taken.has(name)) return name;

  const dotIndex = name.lastIndexOf(".");
  // A leading dot (".env") is a hidden-file prefix, not an extension.
  const stem = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  const ext = dotIndex > 0 ? name.slice(dotIndex) : "";

  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Allocate a unique name against `taken`, claiming the result in the set so
 * sequential allocations see each other. Returns the disclosure payload
 * (`renamedFrom`) when the name had to change.
 */
export function allocateUniqueName(
  name: string,
  taken: Set<string>,
): AllocatedName {
  const unique = uniquifyFilename(name, taken);
  taken.add(unique);
  return unique === name ? { name: unique } : { name: unique, renamedFrom: name };
}
