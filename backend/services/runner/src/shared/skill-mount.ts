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
 */

import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, dirname, extname, resolve } from "node:path";
import { ConnectError, Code } from "@connectrpc/connect";
import type { StigmerClient } from "../client/stigmer-client.js";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { extractZipFileEntries } from "./zip-extract.js";

/** Subdirectory of the platform dir where skill mounts live. */
export const SKILLS_SUBDIR = "skills";

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
 * File extensions written with the executable bit set. The ZIP layer is
 * deliberately mode-blind (path + bytes only, see zip-extract.ts), so
 * extension is the only signal available for `./script.sh`-style
 * invocation to work out of the mount.
 */
const SCRIPT_EXTENSIONS = new Set([".sh", ".py", ".js", ".ts", ".rb", ".pl"]);

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
 * Download a skill artifact's ZIP bytes, transfer lane first (#675).
 *
 * The URL lane (getArtifactDownloadUrl → HTTP GET) carries any valid skill
 * size; the unary getArtifact response is capped by the server's 10MB gRPC
 * message limit. Servers that predate the lane (and cloud until its sibling
 * lands) answer the mint with UNIMPLEMENTED — those fall back to the unary
 * path, which behaves exactly as before for ≤10MB artifacts.
 *
 * Runs only on a mount-cache miss (the hash-keyed marker above) — a hit
 * skips the transfer entirely, whichever lane would have carried it.
 */
export async function downloadArtifact(
  client: StigmerClient,
  artifactStorageKey: string,
): Promise<Uint8Array | undefined> {
  let minted;
  try {
    minted = await client.getSkillArtifactDownloadUrl(artifactStorageKey);
  } catch (err) {
    if (err instanceof ConnectError && err.code === Code.Unimplemented) {
      const resp = await client.getSkillArtifact(artifactStorageKey);
      return resp.artifact && resp.artifact.length > 0 ? resp.artifact : undefined;
    }
    throw err;
  }

  const resp = await fetch(minted.url);
  if (!resp.ok) {
    throw new Error(`artifact fetch failed: HTTP ${resp.status} from ${minted.url}`);
  }
  const bytes = new Uint8Array(await resp.arrayBuffer());
  if (minted.sizeBytes > 0n && BigInt(bytes.length) !== minted.sizeBytes) {
    throw new Error(
      `artifact fetch truncated: got ${bytes.length} bytes, expected ${minted.sizeBytes}`,
    );
  }
  return bytes.length > 0 ? bytes : undefined;
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
 * Every extracted entry must resolve inside `skillDir`. The server already
 * rejects traversal at push (google/safearchive), but this runner-side
 * check is kept as defense-in-depth: it is the guard the deep-agent path
 * used to get from LocalWorkspaceBackend's platform-path routing, preserved
 * here when skill writes moved to direct fs.
 */
export async function writeSkillMount(
  skill: Skill,
  skillDir: string,
  artifactBytes: Uint8Array | undefined,
): Promise<void> {
  await rm(skillDir, { recursive: true, force: true });
  await mkdir(skillDir, { recursive: true });

  await writeFile(join(skillDir, "SKILL.md"), skill.spec!.skillMd, "utf-8");

  const artifactMounted = artifactBytes !== undefined && artifactBytes.length > 0;
  if (artifactMounted) {
    const normalizedSkillDir = resolve(skillDir);
    const entries = await extractZipFileEntries(artifactBytes, { exclude: ["SKILL.md", MOUNT_MARKER_FILE] });
    for (const entry of entries) {
      const filePath = resolve(normalizedSkillDir, entry.path);
      if (filePath !== normalizedSkillDir && !filePath.startsWith(normalizedSkillDir + "/")) {
        throw new Error(
          `skill artifact entry escapes its mount directory: '${entry.path}'`,
        );
      }
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, entry.content, {
        mode: SCRIPT_EXTENSIONS.has(extname(entry.path)) ? 0o755 : 0o644,
      });
    }
  }

  const versionHash = skill.status?.versionHash ?? "";
  if (versionHash !== "") {
    const marker: MountMarker = { versionHash, artifactMounted };
    await writeFile(join(skillDir, MOUNT_MARKER_FILE), JSON.stringify(marker), "utf-8");
  }
}
