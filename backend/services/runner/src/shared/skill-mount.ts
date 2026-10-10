/**
 * Skill mount mechanics — the ONE cache shape shared by both harnesses.
 *
 * A skill "mount" is the on-disk materialization of a skill inside the
 * session's platform directory: `{platformDir}/skills/{name}/` holding
 * SKILL.md plus the artifact's supporting files. Both harnesses write to
 * that same physical location — the Cursor harness directly, the native
 * (deep-agent) harness through the `.stigmer/` virtual namespace that
 * LocalWorkspaceBackend routes there — so they MUST share one cache shape
 * (issues #337/#672). This module owns that shape:
 *
 * - The mount is cached by the skill's content-addressed
 *   `status.version_hash`: metadata is still fetched every execution
 *   (that keeps latest-version freshness — push a skill update and the
 *   very next message picks it up), but the artifact download and file
 *   rewrite are skipped when the mounted content's hash already matches.
 * - Remounts rebuild the directory from scratch, so files deleted between
 *   skill versions never linger in the mount.
 * - Crash-safe by ordering: the marker is stamped LAST, after every file
 *   of the mount landed — a crash mid-write leaves no marker, so the next
 *   execution remounts instead of trusting a partial tree.
 *
 * Extracted from execute-cursor/skill-resolver.ts (PR #682) when the
 * deep-agent path adopted the same cache (issue #337). Orchestration —
 * which skills to mount, prompt metadata, degradation logging — stays
 * with each harness; only the per-skill-directory mechanics live here.
 * The archive's transport, the rebuild and the file modes are the shared
 * archive mount's (`archive-mount.ts`), one copy for skills and plugins.
 *
 * Also the one statement of where a skill's files live under the platform
 * dir ({@link SKILL_CONTENT_PATTERN}), which both harnesses' confined reads
 * consult when a turn's tool lists deny `Skill`.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import type { StigmerClient } from "../client/stigmer-client.js";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { extractZipFileEntries } from "./zip-extract.js";
import { downloadArchive, resetDirectory, writeArchiveEntries } from "./archive-mount.js";
import { STIGMER_LOCAL_STATE_DIR } from "./workspace/stigmer-link.js";

/** Subdirectory of the platform dir where skill mounts live. */
export const SKILLS_SUBDIR = "skills";

/**
 * A skill's files, as a path relative to the platform dir in posix form: a
 * mounted skill (`skills/<name>/…`) or a skill inside a mounted plugin's tree
 * (`plugins/<digest>/skills/…`, `plugin-mount.ts`). A turn whose tool lists
 * deny `Skill` is refused a read of any of them, on both engines; the Cursor
 * hook embeds this pattern's source.
 */
export const SKILL_CONTENT_PATTERN = /^(?:skills|plugins\/[^/]+\/skills)(?:\/|$)/;

/** Whether a canonical virtual path (`/.stigmer/…`, the native engine's) names a skill's files. */
export function isSkillContentPath(virtualPath: string): boolean {
  const prefix = `/${STIGMER_LOCAL_STATE_DIR}/`;
  const normalized = posix.normalize(virtualPath);
  return normalized.startsWith(prefix) && SKILL_CONTENT_PATTERN.test(normalized.slice(prefix.length));
}

/**
 * Marker recording what a skill's mount directory currently holds. Written
 * LAST, after every file of the mount landed — a crash mid-write leaves no
 * marker, so the next execution remounts instead of trusting a partial tree.
 */
export const MOUNT_MARKER_FILE = ".stigmer-mount.json";

export interface MountMarker {
  /** Content-addressed version hash (`Skill.status.version_hash`) of the mounted content. */
  versionHash: string;
  /**
   * Whether the artifact's files are part of the mount. `false` when the
   * skill has no artifact OR when the download failed and the mount fell
   * back to SKILL.md only — the latter makes the next execution retry the
   * download rather than cache the degraded mount.
   */
  artifactMounted: boolean;
}

/**
 * Whether the mount at `skillDir` already holds this version's content.
 *
 * Fresh means: the marker's hash matches AND the mount isn't a degraded
 * SKILL.md-only fallback when the skill does carry an artifact. Any read or
 * parse failure counts as stale — the remount is the safe default.
 */
export async function mountIsFresh(
  skillDir: string,
  versionHash: string,
  wantsArtifact: boolean,
): Promise<boolean> {
  try {
    const raw = await readFile(join(skillDir, MOUNT_MARKER_FILE), "utf-8");
    const marker = JSON.parse(raw) as Partial<MountMarker>;
    return marker.versionHash === versionHash && (marker.artifactMounted === true || !wantsArtifact);
  } catch {
    return false;
  }
}

/**
 * Download a skill artifact's ZIP bytes over the shared archive transport
 * (`archive-mount.ts` `downloadArchive`: the URL lane first, the unary RPC
 * against a server that predates it).
 *
 * Runs only on a mount-cache miss (the hash-keyed marker above) — a hit
 * skips the transfer entirely, whichever lane would have carried it.
 */
export async function downloadArtifact(
  client: StigmerClient,
  artifactStorageKey: string,
): Promise<Uint8Array | undefined> {
  return downloadArchive(
    {
      mintDownloadUrl: (key) => client.getSkillArtifactDownloadUrl(key),
      fetchUnary: (key) => client.getSkillArtifact(key),
    },
    artifactStorageKey,
  );
}

/**
 * (Re)write a skill's mount directory from scratch.
 *
 * The directory is removed first so files deleted between versions don't
 * linger in the mount, then SKILL.md and the artifact files are written, and
 * the marker is stamped LAST (see MOUNT_MARKER_FILE for the crash-safety
 * contract). SKILL.md always comes from `spec.skillMd` — the server's
 * authoritative copy, which the push pipeline guarantees is non-empty
 * (push.go hard-fails a ZIP without an extractable SKILL.md) — never from
 * the zip; both the zip's SKILL.md and any stray marker-named entry are
 * excluded from extraction so the mount's ownership of those two files is
 * unconditional.
 *
 * Every extracted entry must resolve inside `skillDir` (the archive
 * mount's escape check): the server already rejects traversal at push, and
 * this is the runner's defence in depth.
 */
export async function writeSkillMount(
  skill: Skill,
  skillDir: string,
  artifactBytes: Uint8Array | undefined,
): Promise<void> {
  await resetDirectory(skillDir);

  await writeFile(join(skillDir, "SKILL.md"), skill.spec!.skillMd, "utf-8");

  const artifactMounted = artifactBytes !== undefined && artifactBytes.length > 0;
  if (artifactMounted) {
    const entries = await extractZipFileEntries(artifactBytes, { exclude: ["SKILL.md", MOUNT_MARKER_FILE] });
    await writeArchiveEntries(skillDir, entries, "skill artifact");
  }

  const versionHash = skill.status?.versionHash ?? "";
  if (versionHash !== "") {
    const marker: MountMarker = { versionHash, artifactMounted };
    await writeFile(join(skillDir, MOUNT_MARKER_FILE), JSON.stringify(marker), "utf-8");
  }
}
