/**
 * One minimal POSIX/ustar reader, two uses.
 *
 * {@link parseTarHeader} reads a 512-byte header block: the name (with the
 * ustar prefix), the octal mode and size, the type flag, and whether the
 * header's checksum holds. Everything else here walks archives with it:
 *
 *  - {@link extractTarEntry} returns one regular file by basename from an
 *    uncompressed archive in memory (a release's single binary, such as the
 *    Temporal CLI);
 *  - {@link readTar} walks an archive as it streams, entry by entry, and
 *    {@link extractPackageTarball} uses it to unpack a whole npm package from
 *    a `.tgz` on disk under strict rules: every entry a regular file under the
 *    prefix npm packs with (`package/`), no absolute path, no `.` or `..`
 *    segment, no duplicate, a valid header checksum. Any other entry refuses
 *    the archive, links and pax headers included, so a package can never
 *    write outside the directory it is unpacked into. npm packs regular files
 *    only, so a published package passes.
 *
 * No native `tar` and no dependency: the CLI's base install stays lean, and
 * the runner bundles this into its single file.
 */

import { createReadStream } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { ArtifactFetchError } from "./errors.js";

/** A tar block: headers and data are padded to it. */
export const TAR_BLOCK = 512;

/** What an entry is, from its type flag. */
export type TarEntryKind = "file" | "directory" | "symlink" | "hardlink" | "pax" | "other";

/** One header block, read. */
export interface TarHeader {
  /** The entry's path: the ustar prefix and name joined, as the archive spells it. */
  readonly name: string;
  /** Permission bits from the header (octal), 0 when unreadable. */
  readonly mode: number;
  /** The data's length in bytes; `NaN` when the size field is not octal. */
  readonly size: number;
  readonly kind: TarEntryKind;
  /** The raw type flag character. */
  readonly typeFlag: string;
  /** Whether the header's stored checksum equals its computed one. */
  readonly checksumValid: boolean;
}

/** The header in `block`, or `null` for a zero block, which marks the end of an archive. */
export function parseTarHeader(block: Uint8Array): TarHeader | null {
  if (block.every((byte) => byte === 0)) return null;
  const name = readCString(block, 0, 100);
  const magic = readCString(block, 257, 6);
  const prefix = magic.startsWith("ustar") ? readCString(block, 345, 155) : "";
  const typeFlag = String.fromCharCode(block[156] ?? 0);
  return {
    name: prefix === "" ? name : `${prefix}/${name}`,
    mode: readOctal(block, 100, 8) || 0,
    size: readOctal(block, 124, 12),
    kind: kindOf(typeFlag),
    typeFlag,
    checksumValid: readOctal(block, 148, 8) === headerChecksum(block),
  };
}

function kindOf(typeFlag: string): TarEntryKind {
  switch (typeFlag) {
    case "0":
    case "\0":
    case "7":
      return "file";
    case "5":
      return "directory";
    case "2":
      return "symlink";
    case "1":
      return "hardlink";
    case "x":
    case "g":
      return "pax";
    default:
      return "other";
  }
}

// The unsigned sum of the header's bytes with the checksum field read as spaces.
function headerChecksum(block: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < TAR_BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : (block[i] ?? 0);
  return sum;
}

function readOctal(block: Uint8Array, start: number, length: number): number {
  const text = readCString(block, start, length).trim();
  if (text === "") return 0;
  return /^[0-7]+$/.test(text) ? Number.parseInt(text, 8) : Number.NaN;
}

function readCString(block: Uint8Array, start: number, length: number): string {
  let end = start;
  const limit = start + length;
  while (end < limit && block[end] !== 0) end += 1;
  return Buffer.from(block.subarray(start, end)).toString("utf8");
}

function padded(size: number): number {
  return Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
}

/**
 * Extract a single regular-file entry whose basename matches `name` from an
 * (uncompressed) tar buffer, or `null` when there is none.
 */
export function extractTarEntry(buf: Uint8Array, name: string): Uint8Array | null {
  let offset = 0;
  while (offset + TAR_BLOCK <= buf.length) {
    const header = parseTarHeader(buf.subarray(offset, offset + TAR_BLOCK));
    if (header === null) break;
    const size = Number.isNaN(header.size) ? 0 : header.size;
    const dataStart = offset + TAR_BLOCK;
    if (header.kind === "file" && basename(header.name) === name) return buf.subarray(dataStart, dataStart + size);
    offset = dataStart + padded(size);
  }
  return null;
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

/** One entry of a streamed archive: its header, and its data, readable once before the walk moves on. */
export interface TarEntry {
  readonly header: TarHeader;
  /** The entry's bytes in order; an entry whose data is not read is skipped. */
  data(): AsyncGenerator<Uint8Array>;
}

/**
 * The entries of an uncompressed tar stream, in order. Each entry's data must
 * be read (or left) before the next entry is requested. Ends at the archive's
 * zero block, draining what follows; throws on a stream that ends inside a
 * header or an entry's data, and on a size field that is not octal.
 */
export async function* readTar(source: AsyncIterable<Uint8Array>): AsyncGenerator<TarEntry> {
  const reader = new ByteReader(source);
  for (;;) {
    const block = await reader.readExact(TAR_BLOCK);
    if (block === null) throw new Error("the archive ends without its end-of-archive block");
    const header = parseTarHeader(block);
    if (header === null) {
      await reader.drain();
      return;
    }
    if (Number.isNaN(header.size)) throw new Error(`entry ${header.name} has a size field that is not octal`);
    let remaining = header.size;
    yield {
      header,
      async *data() {
        while (remaining > 0) {
          const chunk = await reader.readUpTo(remaining);
          if (chunk === null) throw new Error(`the archive ends inside ${header.name}`);
          remaining -= chunk.byteLength;
          yield chunk;
        }
      },
    };
    if (!(await reader.skip(remaining + padded(header.size) - header.size))) {
      throw new Error(`the archive ends inside ${header.name}`);
    }
  }
}

// Exact and bounded reads over an async byte stream, holding at most one
// chunk beyond what was asked.
class ByteReader {
  private readonly iterator: AsyncIterator<Uint8Array>;
  private pending: Uint8Array = new Uint8Array(0);

  constructor(source: AsyncIterable<Uint8Array>) {
    this.iterator = source[Symbol.asyncIterator]();
  }

  /** Exactly `n` bytes, or `null` when the stream ends first. */
  async readExact(n: number): Promise<Uint8Array | null> {
    const parts: Uint8Array[] = [];
    let have = 0;
    while (have < n) {
      const chunk = await this.readUpTo(n - have);
      if (chunk === null) return null;
      parts.push(chunk);
      have += chunk.byteLength;
    }
    return parts.length === 1 ? (parts[0] as Uint8Array) : Buffer.concat(parts);
  }

  /** Between 1 and `n` bytes, or `null` at the end of the stream. */
  async readUpTo(n: number): Promise<Uint8Array | null> {
    while (this.pending.byteLength === 0) {
      const next = await this.iterator.next();
      if (next.done === true) return null;
      this.pending = next.value;
    }
    const take = this.pending.subarray(0, Math.min(n, this.pending.byteLength));
    this.pending = this.pending.subarray(take.byteLength);
    return take;
  }

  /** Discards `n` bytes; false when the stream ends first. */
  async skip(n: number): Promise<boolean> {
    let left = n;
    while (left > 0) {
      const chunk = await this.readUpTo(left);
      if (chunk === null) return false;
      left -= chunk.byteLength;
    }
    return true;
  }

  /** Reads the stream to its end. */
  async drain(): Promise<void> {
    this.pending = new Uint8Array(0);
    for (;;) {
      const next = await this.iterator.next();
      if (next.done === true) return;
    }
  }
}

export interface ExtractPackageOptions {
  /** The prefix every entry must carry, stripped on the way out; npm packs under `package/`. */
  readonly prefix: string;
  /** The archive's name in errors. */
  readonly label: string;
  /** Stops the extraction; the signal's reason is thrown. */
  readonly signal?: AbortSignal;
}

/**
 * Unpack the gzipped tar at `archivePath` into `destDir` under the rules in
 * the module header; resolves with the number of files written. `destDir`
 * should be new and empty: a file that already exists there refuses the
 * archive rather than be replaced. Each file keeps its archived permission
 * bits, less set-id, sticky and group or other write.
 */
export async function extractPackageTarball(archivePath: string, destDir: string, options: ExtractPackageOptions): Promise<{ readonly files: number }> {
  let files = 0;
  const refuse = (reason: string): never => {
    throw new ArtifactFetchError(`${options.label} archive refused: ${reason}`, [`archive: ${archivePath}`]);
  };
  await pipeline(
    createReadStream(archivePath),
    createGunzip(),
    async (source: AsyncIterable<Uint8Array>) => {
      for await (const entry of readTar(source)) {
        const { header } = entry;
        if (!header.checksumValid) refuse(`entry ${JSON.stringify(header.name)} has a corrupt header`);
        if (header.kind !== "file") refuse(`entry ${JSON.stringify(header.name)} is a ${header.kind}, and only regular files are accepted`);
        const target = join(destDir, packagePath(header.name, options.prefix, refuse));
        await mkdir(dirname(target), { recursive: true });
        const file = await open(target, "wx", 0o600).catch((err: unknown) =>
          refuse(`entry ${JSON.stringify(header.name)} could not be created (${err instanceof Error ? err.message : String(err)})`),
        );
        try {
          for await (const chunk of entry.data()) await file.write(chunk);
          await file.chmod(header.mode & 0o755);
        } finally {
          await file.close();
        }
        files += 1;
      }
    },
    options.signal === undefined ? {} : { signal: options.signal },
  );
  return { files };
}

// The path an entry writes to, relative to the destination, or a refusal.
function packagePath(name: string, prefix: string, refuse: (reason: string) => never): string {
  const quoted = JSON.stringify(name);
  if (!name.startsWith(prefix)) refuse(`entry ${quoted} is not under ${prefix}`);
  const rel = name.slice(prefix.length);
  if (rel === "" || isAbsolute(rel) || rel.includes("\\") || rel.includes("\0")) refuse(`entry ${quoted} is not a plain relative path`);
  if (rel.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) refuse(`entry ${quoted} has an empty, . or .. segment`);
  const nativeRel = rel.split("/").join(sep);
  if (relative(".", nativeRel).startsWith("..")) refuse(`entry ${quoted} leaves the package`);
  return nativeRel;
}
