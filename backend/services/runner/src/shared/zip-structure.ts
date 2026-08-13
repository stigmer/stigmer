/**
 * Policy-free structural ZIP parsing: end-of-central-directory (EOCD)
 * location plus central-directory walk, producing one record per entry.
 *
 * Parsing is *central-directory-based* — never a front-to-back walk of
 * local file headers. This is a correctness decision, not a style choice
 * (issues #450 and #567): local headers of streaming entries
 * (general-purpose flag bit 3) carry zeroed sizes, and the only
 * local-only way to recover them is scanning the payload for the
 * data-descriptor signature — which silently truncates any stored entry
 * whose *content* happens to contain those four bytes, and
 * desynchronizes every entry after it. The central directory always
 * carries the real sizes, and every consumer here holds the complete
 * archive bytes, so nothing a local-header walk could offer is needed.
 *
 * This layer maps bytes to entry records and nothing else. Policy — what
 * a structural failure means, which entries are acceptable, how payloads
 * are decoded — belongs to the consumers, and they differ on purpose:
 *
 *   - shared/zip-extract.ts (skill artifacts): structural failure is
 *     NON-FATAL — both editions' push gates validated every artifact
 *     with a central-directory-based reader before storage, so a defect
 *     here can only be a truncated or corrupted download.
 *   - execute-deep-agent/attachment-injector.ts (user attachments):
 *     structural failure is FAIL-HARD — the input is an untrusted
 *     upload and nothing upstream vouched for it.
 *
 * ZIP64 is deliberately unsupported: both consumers cap input far below
 * every ZIP64 threshold (skill push gates: 100MB / 10,000 files;
 * attachment uploads: 10MB).
 *
 * Throws plain `Error`s on structural defects (no valid EOCD, a central
 * directory or local header record that does not parse, a payload slice
 * that runs past the end of the buffer); consumers translate those into
 * their own error models.
 */

// ─── Entry records ───────────────────────────────────────────────────────

export interface ZipStructuralEntry {
  /** Entry path exactly as recorded in the central directory. */
  readonly name: string;
  readonly isDirectory: boolean;
  readonly compressionMethod: number;
  /**
   * The central directory's declared uncompressed size — authoritative for
   * pre-extraction accounting (e.g. ZIP-bomb budgeting), but still a
   * *declaration*: a consumer that distrusts its input must enforce it
   * against the actual decompressed output.
   */
  readonly uncompressedSize: number;
  /** The entry's raw payload slice (a view, not a copy) of the archive buffer. */
  readonly compressedData: Uint8Array;
}

// ─── Format constants ────────────────────────────────────────────────────

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIRECTORY_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

/** Fixed size of the EOCD record, excluding the variable-length comment. */
export const EOCD_MIN_SIZE = 22;
/** The archive comment length is a u16, so the EOCD sits within the last 64KB + 22 bytes. */
const EOCD_MAX_COMMENT = 0xffff;

const LOCAL_HEADER_SIZE = 30;
const CD_RECORD_SIZE = 46;

// ─── Parsing ─────────────────────────────────────────────────────────────

/**
 * Enumerate the archive's entries from its central directory.
 *
 * Throws on any structural defect: no valid EOCD, a central directory or
 * local header record that doesn't parse, or a payload slice that runs
 * past the end of the buffer.
 */
export function parseZipStructure(data: Uint8Array): ZipStructuralEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const eocd = findEndOfCentralDirectory(data, view);

  const entries: ZipStructuralEntry[] = [];
  let offset = eocd.centralDirectoryOffset;

  for (let i = 0; i < eocd.entryCount; i++) {
    if (offset + CD_RECORD_SIZE > data.length || view.getUint32(offset, true) !== CENTRAL_DIRECTORY_SIG) {
      throw new Error(`invalid central directory record at offset ${offset}`);
    }

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
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
      compressionMethod,
      uncompressedSize,
      compressedData: data.subarray(dataStart, dataStart + compressedSize),
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
