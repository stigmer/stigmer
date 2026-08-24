/**
 * Policy-free structural ZIP parsing: end-of-central-directory (EOCD)
 * location plus central-directory walk, producing one record per entry.
 *
 * Lived in the runner (src/shared/zip-structure.ts) until the TS server's
 * skill push gate became its second consumer; extracted to backend/libs/ts/
 * per the program's shared-library rule (a library moves here when a second
 * consumer exists — @stigmer/temporal-codecs is the precedent).
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
 *   - runner shared/zip-extract.ts (skill artifacts): structural failure
 *     is NON-FATAL — both editions' push gates validated every artifact
 *     with a central-directory-based reader before storage, so a defect
 *     here can only be a truncated or corrupted download.
 *   - runner execute-deep-agent/attachment-injector.ts (user
 *     attachments): structural failure is FAIL-HARD — the input is an
 *     untrusted upload and nothing upstream vouched for it.
 *   - stigmer-server-ts src/domain/skill/storage/ (the push gate):
 *     FAIL-HARD, plus a safearchive-parity entry pre-filter decoded from
 *     the raw creator/attribute fields exposed below.
 *
 * ZIP64 is deliberately unsupported: every consumer caps input far below
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
  /** The central directory's declared compressed size (the payload length). */
  readonly compressedSize: number;
  /**
   * The central directory's CRC-32 of the uncompressed content, verbatim.
   * Raw fact for consumers that verify payload integrity after
   * decompression (Go's archive/zip checks it on every read); consumers
   * that trust their input ignore it.
   */
  readonly crc32: number;
  /**
   * The central directory's "version made by" field, verbatim. The high
   * byte identifies the creator OS (0 = MS-DOS/FAT, 3 = Unix, 19 = macOS),
   * which decides how `externalAttributes` is interpreted. Raw facts for
   * policy layers that decode entry file modes; most consumers ignore it.
   */
  readonly versionMadeBy: number;
  /**
   * The central directory's external file attributes field, verbatim.
   * Unix creators store the POSIX mode in the high 16 bits; MS-DOS
   * creators store FAT attribute bits in the low byte. Interpretation is
   * policy — see the server's safearchive-parity pre-filter.
   */
  readonly externalAttributes: number;
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

    const versionMadeBy = view.getUint16(offset + 4, true);
    const compressionMethod = view.getUint16(offset + 10, true);
    const crc32 = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraFieldLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const externalAttributes = view.getUint32(offset + 38, true);
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
      compressedSize,
      crc32,
      versionMadeBy,
      externalAttributes,
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

// ─── CRC-32 ──────────────────────────────────────────────────────────────

// Standard CRC-32 (IEEE 802.3, the ZIP checksum), table-driven so callers
// hashing payloads at the consumers' 100 MB caps stay cheap.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let bit = 0; bit < 8; bit++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    table[n] = c;
  }
  return table;
})();

/**
 * CRC-32 of `data` — the ZIP checksum. Exported for consumers that verify
 * decompressed payloads against an entry's declared `crc32` (Go's
 * archive/zip does this on every read) and for the fixture builder.
 */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
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
