/**
 * safearchive-parity entry pre-filter — ports the OBSERVABLE half of
 * github.com/google/safearchive's zip.MaximumSecurityMode (applyMagic,
 * zip.go:158, at the go.mod-pinned v0.0.0-20241025131057) plus its
 * sanitizer package. Go's push gate opens ZIPs through safearchive, which
 * rewrites the entry list BEFORE zip_extractor.go's validation loop sees
 * it — so the gate's accept/reject behavior includes this filter, and
 * local parity requires reproducing it (sub-project DD-001, Option A,
 * owner-ratified 2026-08-24). The cloud edition applies none of this; the
 * parity target is the Go server.
 *
 * The four observable behaviors, in safearchive's exact order per entry:
 *   1. SanitizeFilenames — names become unrooted, ..-free, /-separated.
 *      Consequence: "../SKILL.md" IS a root SKILL.md to the gate.
 *   2. SkipWindowsShortFilenames — entries with an 8.3-style path
 *      component (`~N`) are dropped.
 *   3. PreventSymlinkTraversal (+ case-insensitive) — entries whose path
 *      passes through an earlier symlink entry are dropped; symlink
 *      entries themselves stay (and register as shadows).
 *   4. SkipSpecialFiles — device/pipe/socket/char-device entries are
 *      dropped.
 * (safearchive's fifth measure, SanitizeFileMode, strips permission bits
 * the gate never exposes — not observable, not ported.)
 *
 * Entry file types are decoded from the central directory's raw
 * creator/attribute fields exactly as Go archive/zip's FileHeader.Mode()
 * does: Unix/macOS creators carry a POSIX mode in the attribute high 16
 * bits; FAT/NTFS/VFAT creators carry MSDOS bits that can never encode a
 * symlink or special file; unknown creators decode to a regular file.
 *
 * Proven by __tests__/prefilter.test.ts (byte-crafted fixtures per DD-001).
 */
import type { ZipStructuralEntry } from "@stigmer/zip-structure";

// ─── sanitizer.SanitizePath ──────────────────────────────────────────────

/**
 * safearchive sanitizer.SanitizePath (nix variant): backslashes normalize
 * to slashes, then TrimPrefix(Clean("/"+path), "/") — always unrooted with
 * no ".." elements; a trailing separator on the input is preserved when
 * the sanitized result is non-empty.
 *
 * The nix variant is deliberate: Go compiles the _win variant only on
 * Windows hosts, where sanitized names carry backslashes. The TS gate
 * normalizes to slashes everywhere — a Windows-host-only cosmetic
 * divergence in ERROR TEXT for pathological names, disclosed in the PR.
 */
export function sanitizePath(input: string): string {
  const sanitized = sanitizeCore(input);
  if (
    input.length > 0 &&
    (input.endsWith("/") || input.endsWith("\\")) &&
    sanitized.length > 0
  ) {
    return `${sanitized}/`;
  }
  return sanitized;
}

function sanitizeCore(input: string): string {
  const normalizedSeparators = input.replaceAll("\\", "/");
  // Go filepath.Clean("/"+in): resolve "." and ".." lexically against a
  // rooted path (leading ".." cannot climb above the root), collapse
  // duplicate separators, and drop any trailing separator.
  const segments = `/${normalizedSeparators}`.split("/");
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return resolved.join("/");
}

// ─── sanitizer.HasWindowsShortFilenames ──────────────────────────────────

/** Matches a Windows 8.3 short-name marker (`~1`, `~23.`) in a component. */
const WINDOWS_SHORT_FILENAME_PATTERN = /~\d+\.?/;

/** safearchive sanitizer.HasWindowsShortFilenames, verbatim semantics. */
export function hasWindowsShortFilenames(input: string): boolean {
  return input
    .replaceAll("\\", "/")
    .split("/")
    .some((part) => WINDOWS_SHORT_FILENAME_PATTERN.test(part));
}

// ─── archive/zip FileHeader.Mode() — the type bits the filter tests ──────

// CreatorVersion high bytes (Go archive/zip creator* constants).
const CREATOR_UNIX = 3;
const CREATOR_MACOSX = 19;

// POSIX file-type field masks (syscall.S_IF*).
const S_IFMT = 0o170000;
const S_IFBLK = 0o060000;
const S_IFCHR = 0o020000;
const S_IFIFO = 0o010000;
const S_IFLNK = 0o120000;
const S_IFSOCK = 0o140000;

interface EntryTypeBits {
  readonly isSymlink: boolean;
  /** Device, char device, named pipe, or socket (safearchive isSpecialFile). */
  readonly isSpecial: boolean;
}

/**
 * Decodes the entry's file-type bits the way Go's zip.FileHeader.Mode()
 * does. Only Unix/macOS creators can express symlinks or special files;
 * every other creator (FAT, NTFS, VFAT, unknown) decodes to a regular
 * file for the two bits this filter tests.
 */
export function entryTypeBits(entry: ZipStructuralEntry): EntryTypeBits {
  const creator = entry.versionMadeBy >> 8;
  if (creator !== CREATOR_UNIX && creator !== CREATOR_MACOSX) {
    return { isSymlink: false, isSpecial: false };
  }
  const unixMode = (entry.externalAttributes >>> 16) & 0xffff;
  const fileType = unixMode & S_IFMT;
  return {
    isSymlink: fileType === S_IFLNK,
    isSpecial:
      fileType === S_IFBLK ||
      fileType === S_IFCHR ||
      fileType === S_IFIFO ||
      fileType === S_IFSOCK,
  };
}

// ─── applyMagic ──────────────────────────────────────────────────────────

/**
 * A structural entry after the pre-filter: same record, sanitized name.
 * The original entry rides along for payload access.
 */
export interface PrefilteredEntry {
  /** The sanitized name — what every downstream check sees (Go f.Name). */
  readonly name: string;
  readonly entry: ZipStructuralEntry;
}

/**
 * safearchive applyMagic under MaximumSecurityMode, step-for-step in its
 * per-entry order: sanitize the name; drop 8.3-named entries; drop entries
 * shadowed by an earlier symlink (case-insensitive path-prefix match,
 * registering symlink entries as shadows); drop special files.
 */
export function applyEntryPrefilter(
  entries: readonly ZipStructuralEntry[],
): PrefilteredEntry[] {
  const symlinks = new Set<string>();
  const result: PrefilteredEntry[] = [];

  for (const entry of entries) {
    const name = sanitizePath(entry.name);

    if (hasWindowsShortFilenames(name)) {
      continue;
    }

    // PreventSymlinkTraversal + PreventCaseInsensitiveSymlinkTraversal:
    // re-sanitize (idempotent — safearchive does the same), strip the
    // trailing separator, lowercase, and test every path prefix against
    // the symlinks seen so far.
    const shadowKey = trimTrailingSlash(sanitizePath(name)).toLowerCase();
    const parts = shadowKey.split("/");
    let traversal = false;
    for (let i = 1; i <= parts.length; i++) {
      if (symlinks.has(parts.slice(0, i).join("/"))) {
        traversal = true;
        break;
      }
    }
    if (traversal) {
      continue;
    }

    const typeBits = entryTypeBits(entry);
    if (typeBits.isSymlink) {
      symlinks.add(shadowKey);
    }
    if (typeBits.isSpecial) {
      continue;
    }

    result.push({ name, entry });
  }

  return result;
}

function trimTrailingSlash(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}
