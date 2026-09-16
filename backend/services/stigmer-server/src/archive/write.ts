/**
 * Writing a deterministic archive. The server writes ZIPs for one reason: a
 * plugin's skills are pushed through the skill pipeline as archives of
 * their own, and a skill's version IS the SHA-256 of its archive bytes, so
 * the same files must always produce the same bytes or every re-install
 * would mint a new skill version out of nothing. Determinism comes from
 * three choices, each mirrored from the CLI's skill packager
 * (client-apps/cli/src/resources/skill.ts): entries sorted by path, one
 * fixed DOS-epoch mtime on every entry (fflate would otherwise stamp the
 * wall clock), and one fixed deflate level.
 *
 * fflate is the ratified server dependency for ZIP work (see
 * domain/agentexecution/artifacts.ts); this module is its one write site.
 *
 * Proven by __tests__/write.test.ts: two writes of the same files are
 * byte-equal, entry order does not matter, and the result round-trips
 * through the server's own reader.
 */
import { zipSync } from "fflate";

/** One file to write: a plugin-relative POSIX path and its bytes. */
export interface ArchiveFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/**
 * fflate stamps the archive's creation time into every entry when no mtime
 * is given; pinning the DOS epoch removes the one source of byte-level
 * variance. Local-field construction is deliberate: DOS timestamps are
 * local time, and this instant is representable in every zone.
 */
const DETERMINISTIC_ZIP_MTIME = new Date(1980, 0, 1);

/** The CLI's level; changing it would move every digest in the field. */
const DEFLATE_LEVEL = 6;

/** Writes `files` as one deflated archive whose bytes depend on the files alone. */
export function writeArchive(files: ReadonlyArray<ArchiveFile>): Uint8Array {
  const sorted = [...files].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const tree: Record<string, Uint8Array> = {};
  for (const file of sorted) {
    if (file.path in tree) {
      throw new Error(`archive path '${file.path}' listed twice`);
    }
    tree[file.path] = file.bytes;
  }
  return zipSync(tree, {
    level: DEFLATE_LEVEL,
    mtime: DETERMINISTIC_ZIP_MTIME,
  });
}
