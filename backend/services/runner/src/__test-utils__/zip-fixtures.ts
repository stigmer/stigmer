/**
 * Shared ZIP fixture builder for runner unit tests.
 *
 * Emits complete, real-shaped archives — local file headers (optionally
 * streaming-style, the Go stdlib writer's default), payloads, central
 * directory, and EOCD — because that is the only shape that can reach the
 * runner: both editions' skill push gates validate artifacts with
 * central-directory-based readers (see zip-extract.ts's module doc and
 * design record 017). Earlier fixtures emitted local headers only, a
 * shape no real ZIP writer produces, and were coupled to the old parser's
 * front-to-back walk.
 *
 * Mirrors the conformance suite's `zipFilesStreaming()`
 * (test/conformance/src/support/skills.ts) so unit fixtures and
 * cross-edition fixtures share one shape.
 *
 * Lives in src/__test-utils__/ so `tsc --noEmit` covers it while
 * tsconfig.build.json keeps it out of dist/.
 */

import { deflateRawSync } from "node:zlib";

export interface ZipFixtureFile {
  name: string;
  /** Text content is UTF-8 encoded; pass bytes directly for binary payloads. */
  content: string | Uint8Array;
  /** Compression method for the entry. Defaults to stored. */
  method?: "stored" | "deflated";
  /**
   * Emit the entry the way Go's archive/zip does by default: general-purpose
   * flag bit 3 set, zeroed sizes in the local header, and a trailing data
   * descriptor (with the conventional signature) carrying the real values.
   */
  streaming?: boolean;
  /**
   * Lie about the entry's uncompressed size everywhere the writer would
   * declare it (local header, data descriptor, central directory). Models a
   * crafted archive whose declarations disagree with its actual payload —
   * the input class the attachment injector's declared-size enforcement
   * exists to reject (issue #567).
   */
  declaredUncompressedSize?: number;
}

export interface ZipFixtureOptions {
  /** Trailing archive comment appended after the EOCD record. */
  comment?: string;
  /**
   * Drop the central directory and EOCD, leaving only local headers and
   * payloads. No real ZIP writer produces this shape — it models a download
   * truncated before the archive's index.
   */
  omitCentralDirectory?: boolean;
}

/** Build a ZIP archive from path + content pairs. */
export function buildZip(files: ZipFixtureFile[], options?: ZipFixtureOptions): Uint8Array {
  const out = new ByteWriter();

  interface WrittenEntry {
    nameBytes: Uint8Array;
    payload: Uint8Array;
    declaredUncompressed: number;
    crc: number;
    flags: number;
    method: number;
    localHeaderOffset: number;
  }
  const written: WrittenEntry[] = [];

  for (const file of files) {
    const contentBytes =
      typeof file.content === "string" ? new TextEncoder().encode(file.content) : file.content;
    const deflated = file.method === "deflated";
    const payload = deflated ? new Uint8Array(deflateRawSync(contentBytes)) : contentBytes;
    const entry: WrittenEntry = {
      nameBytes: new TextEncoder().encode(file.name),
      payload,
      declaredUncompressed: file.declaredUncompressedSize ?? contentBytes.length,
      crc: crc32(contentBytes),
      flags: file.streaming ? 0x0008 : 0,
      method: deflated ? 8 : 0,
      localHeaderOffset: out.length,
    };
    written.push(entry);

    out.u32(0x04034b50); // local file header signature
    out.u16(20); // version needed to extract
    out.u16(entry.flags);
    out.u16(entry.method);
    out.u16(0); // mod time
    out.u16(0); // mod date
    out.u32(file.streaming ? 0 : entry.crc);
    out.u32(file.streaming ? 0 : payload.length);
    out.u32(file.streaming ? 0 : entry.declaredUncompressed);
    out.u16(entry.nameBytes.length);
    out.u16(0); // extra field length
    out.raw(entry.nameBytes);
    out.raw(payload);

    if (file.streaming) {
      out.u32(0x08074b50); // data descriptor signature (Go writes it)
      out.u32(entry.crc);
      out.u32(payload.length);
      out.u32(entry.declaredUncompressed);
    }
  }

  if (options?.omitCentralDirectory) {
    return out.toUint8Array();
  }

  const centralDirectoryOffset = out.length;
  for (const entry of written) {
    out.u32(0x02014b50); // central directory record signature
    out.u16(20); // version made by
    out.u16(20); // version needed to extract
    out.u16(entry.flags);
    out.u16(entry.method);
    out.u16(0); // mod time
    out.u16(0); // mod date
    out.u32(entry.crc);
    out.u32(entry.payload.length);
    out.u32(entry.declaredUncompressed);
    out.u16(entry.nameBytes.length);
    out.u16(0); // extra field length
    out.u16(0); // comment length
    out.u16(0); // disk number start
    out.u16(0); // internal attributes
    out.u32(0); // external attributes
    out.u32(entry.localHeaderOffset);
    out.raw(entry.nameBytes);
  }
  const centralDirectorySize = out.length - centralDirectoryOffset;

  const commentBytes = new TextEncoder().encode(options?.comment ?? "");
  out.u32(0x06054b50); // EOCD signature
  out.u16(0); // disk number
  out.u16(0); // disk with central directory
  out.u16(written.length); // entries on this disk
  out.u16(written.length); // total entries
  out.u32(centralDirectorySize);
  out.u32(centralDirectoryOffset);
  out.u16(commentBytes.length);
  out.raw(commentBytes);

  return out.toUint8Array();
}

// Chunked assembly instead of a number[]-per-byte accumulator: fixtures at
// the injector's 100 MB zip-bomb limit are built from payload-sized chunks,
// which a per-byte spread-push cannot survive (argument-count overflow).
class ByteWriter {
  private readonly chunks: Uint8Array[] = [];
  private size = 0;

  get length(): number {
    return this.size;
  }

  u16(v: number): void {
    this.raw(new Uint8Array([v & 0xff, (v >>> 8) & 0xff]));
  }

  u32(v: number): void {
    this.raw(new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]));
  }

  raw(b: Uint8Array): void {
    this.chunks.push(b);
    this.size += b.length;
  }

  toUint8Array(): Uint8Array {
    const result = new Uint8Array(this.size);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
}

// Standard CRC-32 (IEEE 802.3, the ZIP checksum), table-driven so fixtures
// at the injector's 100 MB limit stay cheap to build. Semantically identical
// to the conformance suite's inline bit-loop helper.
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

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
