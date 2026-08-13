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
  content: string;
  /** Compression method for the entry. Defaults to stored. */
  method?: "stored" | "deflated";
  /**
   * Emit the entry the way Go's archive/zip does by default: general-purpose
   * flag bit 3 set, zeroed sizes in the local header, and a trailing data
   * descriptor (with the conventional signature) carrying the real values.
   */
  streaming?: boolean;
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
  const bytes: number[] = [];
  const u16 = (v: number) => bytes.push(v & 0xff, (v >>> 8) & 0xff);
  const u32 = (v: number) =>
    bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  const raw = (b: Uint8Array) => bytes.push(...b);

  interface WrittenEntry {
    nameBytes: Uint8Array;
    payload: Uint8Array;
    uncompressedLength: number;
    crc: number;
    flags: number;
    method: number;
    localHeaderOffset: number;
  }
  const written: WrittenEntry[] = [];

  for (const file of files) {
    const contentBytes = new TextEncoder().encode(file.content);
    const deflated = file.method === "deflated";
    const payload = deflated ? new Uint8Array(deflateRawSync(contentBytes)) : contentBytes;
    const entry: WrittenEntry = {
      nameBytes: new TextEncoder().encode(file.name),
      payload,
      uncompressedLength: contentBytes.length,
      crc: crc32(contentBytes),
      flags: file.streaming ? 0x0008 : 0,
      method: deflated ? 8 : 0,
      localHeaderOffset: bytes.length,
    };
    written.push(entry);

    u32(0x04034b50); // local file header signature
    u16(20); // version needed to extract
    u16(entry.flags);
    u16(entry.method);
    u16(0); // mod time
    u16(0); // mod date
    u32(file.streaming ? 0 : entry.crc);
    u32(file.streaming ? 0 : payload.length);
    u32(file.streaming ? 0 : entry.uncompressedLength);
    u16(entry.nameBytes.length);
    u16(0); // extra field length
    raw(entry.nameBytes);
    raw(payload);

    if (file.streaming) {
      u32(0x08074b50); // data descriptor signature (Go writes it)
      u32(entry.crc);
      u32(payload.length);
      u32(entry.uncompressedLength);
    }
  }

  if (options?.omitCentralDirectory) {
    return new Uint8Array(bytes);
  }

  const centralDirectoryOffset = bytes.length;
  for (const entry of written) {
    u32(0x02014b50); // central directory record signature
    u16(20); // version made by
    u16(20); // version needed to extract
    u16(entry.flags);
    u16(entry.method);
    u16(0); // mod time
    u16(0); // mod date
    u32(entry.crc);
    u32(entry.payload.length);
    u32(entry.uncompressedLength);
    u16(entry.nameBytes.length);
    u16(0); // extra field length
    u16(0); // comment length
    u16(0); // disk number start
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(entry.localHeaderOffset);
    raw(entry.nameBytes);
  }
  const centralDirectorySize = bytes.length - centralDirectoryOffset;

  const commentBytes = new TextEncoder().encode(options?.comment ?? "");
  u32(0x06054b50); // EOCD signature
  u16(0); // disk number
  u16(0); // disk with central directory
  u16(written.length); // entries on this disk
  u16(written.length); // total entries
  u32(centralDirectorySize);
  u32(centralDirectoryOffset);
  u16(commentBytes.length);
  raw(commentBytes);

  return new Uint8Array(bytes);
}

// Standard CRC-32 (IEEE 802.3, the ZIP checksum) — same inline shape as the
// conformance suite's helper.
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]!;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
