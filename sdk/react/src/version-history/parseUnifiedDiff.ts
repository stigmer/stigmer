import { parsePatch } from "diff";
import { mapPatchHunks } from "./diff-hunks.js";
import type { DiffHunk } from "./types.js";

/**
 * Parses a unified-diff patch *string* into presentation {@link DiffHunk}s.
 *
 * This is the bridge that lets a harness which only emits a ready unified diff
 * (the Cursor harness's `diffString` -> `view.unifiedDiff` / `FileChange.
 * unifiedDiff`) render through the same accessible {@link DiffViewer} table as a
 * computed before/after diff — instead of being dumped as a raw `<pre>` with the
 * `--- /dev/null`, `+++ b/...`, `@@` preamble and inline `+`/`-` prefixes.
 *
 * The `---`/`+++` file headers parse into metadata and are discarded; only the
 * hunks survive, mapped through the shared {@link mapPatchHunks}. A diff input is
 * a single file's patch, but `parsePatch` can return multiple file entries, so
 * their hunks are flattened defensively.
 *
 * Returns `[]` for an empty or unparseable patch, so callers can fall back to a
 * truthful raw rendering rather than showing a misleading "No changes".
 *
 * Pure function — no side effects, safe to call outside React.
 */
export function parseUnifiedDiff(patch: string): readonly DiffHunk[] {
  if (!patch) return [];

  try {
    return parsePatch(patch).flatMap((file) => mapPatchHunks(file.hunks));
  } catch {
    // parsePatch can throw on a badly malformed patch; degrade to "no hunks" so
    // the caller renders its raw fallback instead of crashing the thread.
    return [];
  }
}
