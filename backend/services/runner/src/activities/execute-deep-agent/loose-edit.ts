/**
 * The Stigmer harness's `edit` path: an edit the model quoted loosely still
 * lands (the matcher is `shared/edit-match.ts`, whose header has the tiers and
 * the refusals).
 *
 * WHY AT THE BACKEND, UNDER THE APPROVAL GATE
 * -------------------------------------------
 * Every Stigmer graph (the parent, every sub-agent, plugin agents) edits
 * through a Stigmer backend subclass, so one call here in each `edit`
 * override covers them all, with no middleware stack plumbed three times. And
 * the gate stays whole: it fingerprints the model's own arguments at approve
 * and execute (`shared/approval-fingerprint.ts`), and the approval card shows
 * them, so the person approves the call the model made and the repair happens
 * after, inside the approved edit. A middleware ahead of the gate would have
 * the gate approve text the card never shows; a retry after a failure would
 * raise a second approval for one edit. File review is untouched too: the
 * capture backends record the before-bytes first, then call this.
 *
 * WHAT IT DOES
 * ------------
 * It reads the file through the backend's own `readRaw` (the same confined,
 * no-follow read `edit` makes), resolves the edit, and calls the backend's
 * strict edit with exact text, which re-reads and re-verifies the file. An
 * exact quote, a quote no tier finds, a file it cannot read as text, and a
 * repaired edit the file no longer accepts (it changed in between) all take
 * today's path: the strict edit with the model's own arguments, so the result
 * and its error words are deepagents'. An ambiguous loose match is refused in
 * deepagents' multiple-occurrence words without touching the file.
 *
 * Each repair logs one `[EDIT-REPAIRED] tier=<tier>` line and no path: a
 * hosted runner's log is no place for a person's file names (the
 * `[TRUNCATED]` line of `middleware/tool-truncation.ts` is the precedent).
 */

import type { EditResult, ReadRawResult } from "deepagents";
import { resolveEdit } from "../../shared/edit-match.js";

/** The backend's own exact edit of this file, as deepagents performs it. */
export type StrictEdit = (oldString: string, newString: string) => Promise<EditResult>;

/** What the loose path reads the file through. */
export interface RawReader {
  readRaw(filePath: string): Promise<ReadRawResult> | ReadRawResult;
}

/** Perform one `edit` call, repairing a loose quote (module header). */
export async function editLoosely(
  backend: RawReader,
  filePath: string,
  oldString: string,
  newString: string,
  replaceAll: boolean | undefined,
  strictEdit: StrictEdit,
): Promise<EditResult> {
  const content = await readText(backend, filePath);
  if (content === undefined) return strictEdit(oldString, newString);

  const resolution = resolveEdit(content, oldString, newString, replaceAll === true);
  switch (resolution.kind) {
    case "exact":
    case "none":
      return strictEdit(oldString, newString);
    case "ambiguous":
      return { error: resolution.error };
    case "resolved": {
      const result = await strictEdit(resolution.oldString, resolution.newString);
      if (result.error !== undefined) return strictEdit(oldString, newString);
      console.warn(`[EDIT-REPAIRED] tier=${resolution.tier}`);
      return result;
    }
  }
}

/** The file's text, or undefined when it is missing, refused, or not text: the strict edit then says why. */
async function readText(backend: RawReader, filePath: string): Promise<string | undefined> {
  try {
    const read = await backend.readRaw(filePath);
    const content = read.data?.content;
    return typeof content === "string" ? content : undefined;
  } catch {
    return undefined;
  }
}
