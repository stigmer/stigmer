/**
 * Minimal, dependency-free ZIP archive parser.
 *
 * Parsing is *central-directory-based*: entries are enumerated from the
 * archive's end-of-central-directory record (EOCD) and central directory —
 * the format's authoritative index — never by walking local file headers
 * front-to-back. This is a correctness decision, not a style choice
 * (issue #450): local headers of streaming entries (general-purpose flag
 * bit 3) carry zeroed sizes, and the only local-only way to recover them
 * is scanning the payload for the data-descriptor signature — which
 * silently truncates any stored entry whose *content* happens to contain
 * those four bytes, and desynchronizes every entry after it. The central
 * directory always carries the real sizes, and this parser always holds
 * the complete archive bytes, so nothing a local-header walk could offer
 * is needed.
 *
 * Input without a readable central directory is not given a second
 * chance on purpose: every artifact reaching the runner was validated at
 * push by a central-directory-based reader on both editions (OSS:
 * `safearchive/zip` in stigmer-server's skill storage; cloud:
 * commons-compress `ZipFile` in SkillArtifactExtractor), so a missing
 * EOCD here can only mean a truncated or corrupted download — and the
 * honest result for that is the documented empty return, not a guess.
 *
 * ZIP64 is deliberately unsupported: the push gates cap artifacts at
 * 100MB / 10,000 files, far below every ZIP64 threshold.
 *
 * Handles stored (method 0) and deflated (method 8) entries. Returns
 * parsed entries as path + content pairs — consumers bring their own
 * write mechanism (WorkspaceBackend, node:fs, etc.).
 *
 * Extracted from skill-writer.ts so both the deep-agent and Cursor
 * harnesses can share the same ZIP parsing logic without coupling to
 * a specific workspace abstraction.
 */

import { createInflateRaw } from "node:zlib";

// ─── Public API ──────────────────────────────────────────────────────────

export interface ZipFileEntry {
  /** Relative path within the archive (forward-slash separated). */
  readonly path: string;
  /** Decoded text content of the file. */
  readonly content: string;
}

/**
 * Parse and decompress all file entries from a ZIP archive.
 *
 * Directory entries are always skipped. An optional `exclude` list filters
 * entries whose filename (basename or full path) matches any excluded name.
 *
 * Returns an empty array for empty, truncated, or non-ZIP input rather
 * than throwing — callers treat missing artifacts as non-fatal. Errors
 * while *decompressing* a structurally valid entry (corrupt deflate
 * stream, unsupported compression method) do propagate: at that point
 * the archive's structure vouched for the entry, and silently dropping
 * it would be the exact corruption this module exists to prevent.
 */
export async function extractZipFileEntries(
  zipBytes: Uint8Array,
  options?: { exclude?: readonly string[] },
): Promise<ZipFileEntry[]> {
  if (zipBytes.length < EOCD_MIN_SIZE) return [];

  let entries: ZipEntry[];
  try {
    entries = parseZipEntries(zipBytes);
  } catch (err) {
    console.warn(
      "[zip-extract] archive has no readable central directory " +
      `(truncated or corrupt download?): ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }

  const excludeSet = new Set(options?.exclude ?? []);
  const results: ZipFileEntry[] = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (isExcluded(entry.name, excludeSet)) continue;

    const content = await decompressEntry(entry);
    results.push({ path: entry.name, content });
  }

  return results;
}

// ─── Structural parsing (central directory) ──────────────────────────────
//
// This layer is deliberately policy-free — it maps bytes to entry records
// (name, method, payload slice) and nothing else — so a future consumer
// with different policy (e.g. the attachment injector's fail-hard,
// security-validated extraction) can lift it without dragging along the
// skill-specific text decoding above.

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIRECTORY_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

/** Fixed size of the EOCD record, excluding the variable-length comment. */
const EOCD_MIN_SIZE = 22;
/** The archive comment length is a u16, so the EOCD sits within the last 64KB + 22 bytes. */
const EOCD_MAX_COMMENT = 0xffff;

const LOCAL_HEADER_SIZE = 30;
const CD_RECORD_SIZE = 46;

interface ZipEntry {
  name: string;
  isDirectory: boolean;
  compressedData: Uint8Array;
  compressionMethod: number;
}

function isExcluded(name: string, excludeSet: ReadonlySet<string>): boolean {
  if (excludeSet.size === 0) return false;
  if (excludeSet.has(name)) return true;

  const basename = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
  return excludeSet.has(basename);
}

/**
 * Enumerate the archive's entries from its central directory.
 *
 * Throws on any structural defect (no valid EOCD, a central directory or
 * local header record that doesn't parse, a payload slice that runs past
 * the end of the buffer) — the caller translates that into the module's
 * non-fatal empty return.
 */
function parseZipEntries(data: Uint8Array): ZipEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const eocd = findEndOfCentralDirectory(data, view);

  const entries: ZipEntry[] = [];
  let offset = eocd.centralDirectoryOffset;

  for (let i = 0; i < eocd.entryCount; i++) {
    if (offset + CD_RECORD_SIZE > data.length || view.getUint32(offset, true) !== CENTRAL_DIRECTORY_SIG) {
      throw new Error(`invalid central directory record at offset ${offset}`);
    }

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraFieldLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    const fileName = new TextDecoder().decode(
      data.subarray(offset + CD_RECORD_SIZE, offset + CD_RECORD_SIZE + fileNameLength),
    );

    // The local header is consulted for one thing only: the payload start.
    // Its name/extra field lengths can legitimately differ from the central
    // directory's (streaming writers pad the extra field), so the offset
    // cannot be derived from CD fields alone.
    const dataStart = payloadStart(data, view, localHeaderOffset, fileName);
    if (dataStart + compressedSize > data.length) {
      throw new Error(`entry "${fileName}" payload runs past end of archive`);
    }

    entries.push({
      name: fileName,
      isDirectory: fileName.endsWith("/"),
      compressedData: data.subarray(dataStart, dataStart + compressedSize),
      compressionMethod,
    });

    offset += CD_RECORD_SIZE + fileNameLength + extraFieldLength + commentLength;
  }

  return entries;
}

interface EndOfCentralDirectory {
  centralDirectoryOffset: number;
  entryCount: number;
}

/**
 * Locate and validate the end-of-central-directory record.
 *
 * Scans backward from the end of the archive across the maximum comment
 * span. A signature match alone is not trusted (the four bytes can occur
 * inside a trailing comment): the record must also point at an offset
 * that actually holds a central directory record, or be a genuinely
 * empty archive.
 */
function findEndOfCentralDirectory(data: Uint8Array, view: DataView): EndOfCentralDirectory {
  const scanFloor = Math.max(0, data.length - EOCD_MIN_SIZE - EOCD_MAX_COMMENT);

  for (let pos = data.length - EOCD_MIN_SIZE; pos >= scanFloor; pos--) {
    if (view.getUint32(pos, true) !== EOCD_SIG) continue;

    const entryCount = view.getUint16(pos + 10, true);
    const centralDirectorySize = view.getUint32(pos + 12, true);
    const centralDirectoryOffset = view.getUint32(pos + 16, true);

    const directoryEndsAtRecord = centralDirectoryOffset + centralDirectorySize <= pos;
    const directoryLooksReal =
      entryCount === 0 ||
      (centralDirectoryOffset + 4 <= data.length &&
        view.getUint32(centralDirectoryOffset, true) === CENTRAL_DIRECTORY_SIG);

    if (directoryEndsAtRecord && directoryLooksReal) {
      return { centralDirectoryOffset, entryCount };
    }
  }

  throw new Error("no end-of-central-directory record found");
}

/** Resolve where an entry's payload begins, from its local file header. */
function payloadStart(
  data: Uint8Array,
  view: DataView,
  localHeaderOffset: number,
  fileName: string,
): number {
  if (
    localHeaderOffset + LOCAL_HEADER_SIZE > data.length ||
    view.getUint32(localHeaderOffset, true) !== LOCAL_FILE_HEADER_SIG
  ) {
    throw new Error(`entry "${fileName}" has no local file header at offset ${localHeaderOffset}`);
  }

  const localNameLength = view.getUint16(localHeaderOffset + 26, true);
  const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
  return localHeaderOffset + LOCAL_HEADER_SIZE + localNameLength + localExtraLength;
}

// ─── Decompression ───────────────────────────────────────────────────────

async function decompressEntry(entry: ZipEntry): Promise<string> {
  if (entry.compressionMethod === 0) {
    return new TextDecoder().decode(entry.compressedData);
  }

  if (entry.compressionMethod === 8) {
    return new Promise<string>((resolve, reject) => {
      const inflate = createInflateRaw();
      const chunks: Buffer[] = [];
      inflate.on("data", (chunk: Buffer) => chunks.push(chunk));
      inflate.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      inflate.on("error", reject);
      inflate.end(Buffer.from(entry.compressedData));
    });
  }

  throw new Error(`Unsupported ZIP compression method: ${entry.compressionMethod}`);
}
