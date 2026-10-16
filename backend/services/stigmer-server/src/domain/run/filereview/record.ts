/**
 * The run's file record (RunStatus.file_changes): the change sets its
 * turns captured, each with its files' contents before and after, the
 * snapshots they were read from and the consent the turn's commands ran
 * under. The runner writes it; it holds no status and no decisions, which
 * are the session's `stigmer.file_review.*` events (logged.ts).
 *
 *   upsert ........ a status write's sets are merged by set id: a set the
 *                   run holds is replaced where it stands, a new one is
 *                   added after the others, and a held set the write does
 *                   not carry is kept. Nothing is ever removed, so a write
 *                   that carries only the newest set never loses an older
 *                   one. A set with no id names nothing and is passed over,
 *                   and so is one whose id names another run: a set id is
 *                   `<run id>:<turn>`, and a run's record holds its own
 *                   turns' sets alone, so no write to one run can put a set
 *                   (and the keeps it would draw) under another's id.
 *   frozen ........ a captured set is what a person reviews, so once the
 *                   record holds it captured no write replaces it: a
 *                   different capture under its id is passed over, and a
 *                   late retry of its baseline-only write cannot uncapture
 *                   it. Only a set still being captured is replaced.
 *   captured ...... a set is offered for review once its candidate (the
 *                   workspace at the turn's end) is captured. A set the
 *                   record holds with its baseline alone is still being
 *                   captured.
 *   the gates ..... what a keep is checked against before it is written:
 *                   the target exists, its diff can be shown whole (a
 *                   binary a person acknowledged is the one exception),
 *                   and the digest is the one the person reviewed.
 *                   Enforcement only: a decision is matched to its target
 *                   by id, never by digest.
 *
 * Proven by __tests__/record.test.ts, and through every reader in
 * autokeep.test.ts and ../../session/filereview/__tests__/decide.test.ts.
 */
import { equals } from "@bufbuild/protobuf";
import { DiffCompleteness } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import {
  FileChangeSetSchema,
  type CapturedFileChange,
  type FileChangeSet,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";

import type { ScopeWord } from "../../session/filereview/words.js";

/**
 * The record of run `runId` after a write carrying `incoming`: merged by
 * set id, its own sets alone, a captured set frozen (module header).
 */
export function upsertFileChanges(
  runId: string,
  stored: ReadonlyArray<FileChangeSet>,
  incoming: ReadonlyArray<FileChangeSet>,
): FileChangeSet[] {
  const merged = [...stored];
  for (const set of incoming) {
    if (set.id === "" || !set.id.startsWith(`${runId}:`)) {
      continue;
    }
    const at = merged.findIndex((held) => held.id === set.id);
    if (at === -1) {
      merged.push(set);
      continue;
    }
    const held = merged[at]!;
    if (isCaptured(held) && !equals(FileChangeSetSchema, held, set)) {
      continue;
    }
    merged[at] = set;
  }
  return merged;
}

/** Whether a set's candidate is captured, so it is offered for review (module header). */
export function isCaptured(cs: FileChangeSet): boolean {
  return cs.candidateSnapshot !== undefined;
}

/** The set with the given id, or undefined. */
export function findChangeSet(
  changeSets: ReadonlyArray<FileChangeSet>,
  changeSetId: string,
): FileChangeSet | undefined {
  return changeSets.find((cs) => cs.id === changeSetId);
}

/** The captured change with the given id within a set, or undefined. */
export function findChange(
  cs: FileChangeSet,
  fileChangeId: string,
): CapturedFileChange | undefined {
  return cs.changes.find((c) => c.id === fileChangeId);
}

/**
 * The digest a decision's expected_digest is checked against: the file's
 * file_digest for a file decision, the set's aggregate_digest for a
 * change-set one. Enforcement only, never used to correlate.
 */
export function targetDigest(
  cs: FileChangeSet,
  scope: ScopeWord,
  fileChangeId: string,
): string {
  if (scope === "file") {
    return findChange(cs, fileChangeId)?.fileDigest ?? "";
  }
  return cs.aggregateDigest;
}

/**
 * Why a keep of the target must be refused because its diff cannot be
 * shown whole, or "" when the keep may proceed. Applied to a keep only:
 * an undo is never gated, so any change can be put back.
 *
 * A file decision turns on the one file's diff_complete, a change-set one
 * on the set's diff_completeness, so a complete file inside a blocked set
 * can still be kept alone. Fail-closed: an unspecified completeness, an
 * absent change or an absent set cannot be kept.
 *
 * A binary file has no text diff but its exact bytes are captured, so an
 * acknowledged keep of a binary is allowed: the one exception. A
 * secret-withheld, too-large or unreadable file has no keepable bytes and
 * stays blocked. A change-set keep re-derives "binary only" from the
 * changes themselves, never from the rollup, so a stale label cannot widen
 * what is kept.
 */
export function keepBlockedReason(
  cs: FileChangeSet | undefined,
  scope: ScopeWord,
  fileChangeId: string,
  acknowledged: boolean,
): string {
  if (cs === undefined) {
    return "change set is not reviewable";
  }
  if (scope === "file") {
    const c = findChange(cs, fileChangeId);
    if (c === undefined) {
      return `file change ${fileChangeId} is not reviewable`;
    }
    if (!c.diffComplete) {
      if (acknowledged && isBinaryChange(c)) {
        return "";
      }
      return `file change ${fileChangeId} cannot be approved: its diff is not fully reviewable (incomplete or binary); reject it to discard, or wait for a complete capture`;
    }
    return "";
  }
  if (cs.diffCompleteness === DiffCompleteness.COMPLETE) {
    return "";
  }
  if (acknowledged && everyIncompleteChangeIsBinary(cs)) {
    return "";
  }
  return `change set ${cs.id} cannot be approved: at least one file's diff is not fully reviewable (incomplete or binary); reject the affected files or the whole set, or wait for a complete capture`;
}

/** Whether either side of a captured change is binary (FileContent.is_binary). */
export function isBinaryChange(c: CapturedFileChange): boolean {
  return (c.before?.isBinary ?? false) || (c.after?.isBinary ?? false);
}

/**
 * Whether the set has at least one incomplete change and every incomplete
 * change is binary: the condition under which an acknowledged keep of the
 * whole set is safe.
 */
export function everyIncompleteChangeIsBinary(cs: FileChangeSet): boolean {
  let sawIncomplete = false;
  for (const c of cs.changes) {
    if (c.diffComplete) {
      continue;
    }
    sawIncomplete = true;
    if (!isBinaryChange(c)) {
      return false;
    }
  }
  return sawIncomplete;
}
