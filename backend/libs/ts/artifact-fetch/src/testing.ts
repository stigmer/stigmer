/**
 * Byte-level tar fixture builder for this library's consumers' tests
 * (exported as `@stigmer/artifact-fetch/testing`). The lib's own suite and
 * the runner's engine-fetch suite craft archives with it, so a fixture that
 * breaks a rule (a link, a `..` entry, a corrupt header) is spelled one way.
 *
 * Emits real ustar headers with a valid checksum unless an entry asks
 * otherwise, the zero blocks that end an archive, and, through
 * {@link buildPackageTarball}, an npm-shaped `.tgz` whose entries sit under
 * `package/`.
 */

import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

export interface TarFixtureEntry {
  /** The path as the archive spells it. Names over 100 bytes are split into the ustar prefix. */
  readonly name: string;
  readonly content?: string | Uint8Array;
  /** The type flag; `"0"` (a regular file) by default. */
  readonly typeFlag?: string;
  /** Permission bits; 0o644 by default. */
  readonly mode?: number;
  /** The link target of a symlink or hard link. */
  readonly linkName?: string;
  /** Write a checksum that does not match the header. */
  readonly corruptChecksum?: boolean;
}

const BLOCK = 512;

/** An uncompressed tar archive of `entries`, ended by two zero blocks. */
export function buildTar(entries: readonly TarFixtureEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const content = typeof entry.content === "string" ? Buffer.from(entry.content) : Buffer.from(entry.content ?? new Uint8Array(0));
    parts.push(header(entry, content.length), content, Buffer.alloc((BLOCK - (content.length % BLOCK)) % BLOCK));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

function header(entry: TarFixtureEntry, size: number): Buffer {
  const block = Buffer.alloc(BLOCK);
  let name = entry.name;
  let prefix = "";
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf("/", name.length - 1);
    prefix = name.slice(0, cut);
    name = name.slice(cut + 1);
  }
  block.write(name, 0, "utf8");
  block.write(octal(entry.mode ?? 0o644, 8), 100, "ascii");
  block.write(octal(0, 8), 108, "ascii");
  block.write(octal(0, 8), 116, "ascii");
  block.write(octal(size, 12), 124, "ascii");
  block.write(octal(0, 12), 136, "ascii");
  block.write(entry.typeFlag ?? "0", 156, "ascii");
  if (entry.linkName !== undefined) block.write(entry.linkName, 157, "utf8");
  block.write("ustar\0", 257, "ascii");
  block.write("00", 263, "ascii");
  if (prefix !== "") block.write(prefix, 345, "utf8");
  block.fill(0x20, 148, 156);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(octal(entry.corruptChecksum === true ? sum + 1 : sum, 7) + "\0", 148, "ascii");
  return block;
}

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, "0") + "\0";
}

/** An npm-shaped package tarball: every file under `package/`, gzipped. */
export function buildPackageTarball(files: Readonly<Record<string, string | Uint8Array>>, modes: Readonly<Record<string, number>> = {}): Buffer {
  return gzipSync(buildTar(Object.entries(files).map(([path, content]) => ({ name: `package/${path}`, content, mode: modes[path] ?? 0o644 }))));
}

/** The Subresource Integrity string npm records for `bytes`. */
export function sriSha512(bytes: Uint8Array): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}
