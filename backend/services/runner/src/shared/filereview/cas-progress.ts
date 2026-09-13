/**
 * Mid-run progress substrate for the CAS (content-addressed) domain — the
 * non-git and gitignored half of DD-33. The git substrate ({@link ./progress.js}
 * `createGitProgressSubstrate`) covers git-tracked changes cheaply via
 * `--numstat`; this covers the paths git cannot see, sourced from the same
 * per-turn observer the turn-boundary CAS capture reads:
 *  - a non-git workspace: EVERY tool-mediated write (the whole change set), and
 *  - a git tree's gitignored writes (the CAS half of a HYBRID turn).
 *
 * COST MODEL (why this is not as cheap as git)
 * --------------------------------------------
 * `git --numstat` yields exact `+N −M` with zero byte reads; CAS has no such free
 * lunch — kind, no-op exclusion, and counts all need the after-bytes. So we bound
 * the work: only the sorted read-PREFIX (up to {@link PROGRESS_MAX_ENTRIES}) has
 * its after-bytes read and counted; the tail contributes to `totalFilesChanged`
 * (the honest count) only. `files_changed` is therefore net-exact for a normal
 * turn (≤ the budget) and an upper bound beyond it — matching git where git is
 * free, diverging only where the substrate cannot be. A `size+mtime` signature
 * (the stats are collected anyway) short-circuits an unchanged capture.
 *
 * CONSISTENCY & SECRET SAFETY
 * ---------------------------
 * Counts come from {@link classifyCasChange} — the SAME classifier the reviewed
 * set uses — so the strip and the change set never disagree. Secret-like paths
 * are excluded up front via {@link partitionIgnoredPathsBySecret} (and zeroed
 * again in `buildFileChangeProgress` as a backstop); no file bodies are ever
 * carried on the wire. Only tool-mediated writes are observed, exactly the scope
 * of the non-git / HYBRID turn-boundary capture — no new divergence.
 *
 * @since File-Change HITL Redesign (non-git + hybrid mid-run progress / DD-33)
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { FileChangeKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { classifyCasChange } from "./cas-substrate.js";
import { LINE_COUNT_MAX_BYTES } from "./line-counts.js";
import {
  PROGRESS_MAX_ENTRIES,
  type ProgressCapture,
  type ProgressDelta,
  type ProgressEntry,
  type ProgressSubstrate,
} from "./progress.js";
import { partitionIgnoredPathsBySecret } from "./secret-paths.js";
import type { CasTouchedReader } from "./cas-touched.js";

// The snapshot this substrate reads (`CasTouchedSnapshot`) and the reader that
// produces it live in `cas-touched.ts`, the one home of "what the engine
// observed touching CAS-owned paths": the turn-boundary capture reads the same
// snapshot, so neither consumer owns the shape.

/**
 * The CAS progress substrate. Reads the touched set on each capture, computes
 * kind + `+N −M` for the bounded read-prefix via {@link classifyCasChange}, and
 * reports `totalFilesChanged` over the full capturable set. Owns a `size+mtime`
 * signature so an unchanged capture returns `changed:false` (the cached delta is
 * reused, letting the hybrid still merge it with a changed git slice).
 */
export function createCasProgressSubstrate(opts: {
  readonly workspaceRoot: string;
  readonly read: CasTouchedReader;
  /** Read budget / display cap; defaults to {@link PROGRESS_MAX_ENTRIES}. Injectable for tests. */
  readonly maxEntries?: number;
}): ProgressSubstrate {
  const maxEntries = opts.maxEntries ?? PROGRESS_MAX_ENTRIES;
  let cachedFull: ProgressDelta = { entries: [], totalFilesChanged: 0 };
  let lastSignature: string | undefined;

  return {
    async capture(): Promise<ProgressCapture> {
      const snapshot = await opts.read();
      const { capturablePaths } = partitionIgnoredPathsBySecret(
        snapshot.before.keys(),
        snapshot.blockedSecretPaths,
      );
      // Deterministic order so the read prefix and entry order are stable.
      const sorted = [...capturablePaths].sort();
      const prefix = sorted.slice(0, maxEntries);

      const entries: ProgressEntry[] = [];
      // The signature keys on the capturable count (catches a new touch) plus the
      // read prefix's size+mtime (catches a content edit to a shown file). A
      // change to an UNshown tail file has no display effect, so it is not keyed.
      const sigParts: string[] = [`${capturablePaths.length}`];

      for (const relPath of prefix) {
        const abs = join(opts.workspaceRoot, relPath);
        const st = await statOrNull(abs);
        sigParts.push(`${relPath}\u0000${st ? `${st.size}:${st.mtimeMs}` : "\u2205"}`);

        const beforeBytes = snapshot.before.get(relPath) ?? null;
        const beforeBuf = beforeBytes === null ? null : Buffer.from(beforeBytes);

        // Oversized after: derive the kind without reading (bound the I/O) and
        // leave counts at zero — the same "no stat" shape a binary/oversized side
        // takes in the reviewed set. A same-size no-op cannot be excluded here; an
        // accepted overstatement only for very large files.
        if (st && st.size > LINE_COUNT_MAX_BYTES) {
          const kind = beforeBuf === null ? FileChangeKind.ADD : FileChangeKind.MODIFY;
          entries.push({
            pathBefore: kind === FileChangeKind.ADD ? "" : relPath,
            pathAfter: relPath,
            kind,
            linesAdded: 0,
            linesRemoved: 0,
          });
          continue;
        }

        const afterBytes = st ? await readFileOrNull(abs) : null;
        const afterBuf = afterBytes === null ? null : Buffer.from(afterBytes);
        const cls = classifyCasChange(relPath, beforeBuf, afterBuf);
        if (!cls) continue; // no-op (unchanged touch) or both sides absent
        entries.push({
          pathBefore: cls.pathBefore,
          pathAfter: cls.pathAfter,
          kind: cls.kind,
          linesAdded: cls.lineCounts?.linesAdded ?? 0,
          linesRemoved: cls.lineCounts?.linesRemoved ?? 0,
        });
      }

      // Honest total: the capturable set minus the no-ops detected in the read
      // prefix. Net-exact for a turn within the read budget; an upper bound beyond
      // it (tail no-ops are not read, so cannot be excluded).
      const prefixNoOps = prefix.length - entries.length;
      const totalFilesChanged = capturablePaths.length - prefixNoOps;

      const signature = sigParts.join("|");
      if (signature === lastSignature) {
        return { delta: cachedFull, changed: false };
      }
      lastSignature = signature;
      cachedFull = { entries, totalFilesChanged };
      return { delta: cachedFull, changed: true };
    },
  };
}

async function statOrNull(abs: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const s = await stat(abs);
    return { size: s.size, mtimeMs: s.mtimeMs };
  } catch {
    return null;
  }
}

async function readFileOrNull(abs: string): Promise<Uint8Array | null> {
  try {
    return await readFile(abs);
  } catch {
    return null;
  }
}
