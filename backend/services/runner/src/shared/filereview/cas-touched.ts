/**
 * What the engine observed touching CAS-owned paths this turn — the one fact
 * about a turn's file changes that the runtime cannot read from the tree and
 * the engine cannot help knowing.
 *
 * In a git work tree the tracked changes are a `git diff` against the pinned
 * baseline; the gitignored ones are invisible to git, and in a non-git
 * workspace EVERY change is. For those paths the only record of the
 * pre-turn bytes is the one taken at mutation time, by whatever sits between
 * the engine and the disk: the deep-agent's `CasCaptureObserver` (fed by its
 * filesystem backend and its approval gate) or the Cursor hook's on-disk
 * sidecar. Both produce this one snapshot shape, and both consumers read it:
 * the mid-run progress slice (`cas-progress.ts`) and the turn-boundary
 * capture ({@link buildCasTurnCaptures}), which composes it into the
 * {@link CasPathCapture}s the CAS substrate stores.
 *
 * Until #1096 each harness carried its own copy of `buildCasTurnCaptures`
 * beside its observation source; the copies were byte-near-identical
 * and now live here once. The AFTER bytes are always re-read from
 * disk at composition time (the authoritative net result of the turn), so
 * many edits to one path collapse to one before/after.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FileCaptureClass } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { CasPathCapture } from "./cas-substrate.js";
import { partitionIgnoredPathsBySecret } from "./secret-paths.js";

/**
 * The CAS-owned paths touched so far this turn: pre-turn bytes per
 * first-touched path (`null` = the path did not exist → an ADD) and the paths
 * the gate hard-blocked as secret-like (never applied, never captured; the
 * boundary authors a content-less entry for each). Keyed workspace-root-
 * relative. A reader MUST return an atomic snapshot (copy the live map before
 * any await) so a concurrent sub-agent write cannot mutate it mid-capture.
 */
export interface CasTouchedSnapshot {
  readonly before: ReadonlyMap<string, Uint8Array | null>;
  readonly blockedSecretPaths: ReadonlySet<string>;
}

/** Produces a {@link CasTouchedSnapshot} for one capture. */
export type CasTouchedReader = () => CasTouchedSnapshot | Promise<CasTouchedSnapshot>;

/**
 * Compose the turn's CAS captures from what the engine observed: for each
 * observed path the before-bytes come from the snapshot and the after-bytes
 * are re-read from disk now (`null` = the file is gone). Secret-like paths are
 * diverted to `unreviewablePaths` and their before-bytes dropped — the
 * fail-closed backstop that holds even under the global bypass, where the
 * gate did not run to block them up front ({@link partitionIgnoredPathsBySecret}
 * is the one decision; this shell performs only the IO for the capturable
 * set). `captureClass` is the turn's CAS substrate class — GIT_IGNORED_CAPTURED
 * for a git work tree's ignored paths, NON_GIT_CAS for a non-git workspace
 * (where these ARE the whole change set) — so each captured path carries its
 * true provenance. An empty snapshot yields empty results and leaves the
 * shared capture unchanged.
 */
export async function buildCasTurnCaptures(
  snapshot: CasTouchedSnapshot,
  workspaceRoot: string,
  captureClass: FileCaptureClass,
): Promise<{ casCaptures: CasPathCapture[]; unreviewablePaths: string[] }> {
  const { capturablePaths, unreviewablePaths } = partitionIgnoredPathsBySecret(
    snapshot.before.keys(),
    snapshot.blockedSecretPaths,
  );
  const casCaptures: CasPathCapture[] = [];
  for (const relPath of capturablePaths) {
    const after = await readFileOrNull(join(workspaceRoot, relPath));
    casCaptures.push({
      path: relPath,
      before: snapshot.before.get(relPath) ?? null,
      after,
      captureClass,
    });
  }
  return { casCaptures, unreviewablePaths: [...unreviewablePaths] };
}

/** Raw bytes of a file, or `null` when it does not exist (a DELETE, or an ADD since removed). */
async function readFileOrNull(absolutePath: string): Promise<Uint8Array | null> {
  try {
    return await readFile(absolutePath);
  } catch {
    return null;
  }
}
