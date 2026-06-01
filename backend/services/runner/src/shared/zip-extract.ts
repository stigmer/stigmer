/**
 * Minimal, dependency-free ZIP archive parser.
 *
 * Handles the local file header format, supporting stored (method 0) and
 * deflated (method 8) entries. Returns parsed entries as path + content
 * pairs — consumers bring their own write mechanism (WorkspaceBackend,
 * node:fs, etc.).
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
 * than throwing — callers treat missing artifacts as non-fatal.
 */
export async function extractZipFileEntries(
  zipBytes: Uint8Array,
  options?: { exclude?: readonly string[] },
): Promise<ZipFileEntry[]> {
  if (zipBytes.length < 4) return [];

  let entries: ZipEntry[];
  try {
    entries = parseZipEntries(zipBytes);
  } catch {
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

// ─── Internals ───────────────────────────────────────────────────────────

interface ZipEntry {
  name: string;
  isDirectory: boolean;
  compressedData: Uint8Array;
  compressionMethod: number;
  uncompressedSize: number;
}

function isExcluded(name: string, excludeSet: ReadonlySet<string>): boolean {
  if (excludeSet.size === 0) return false;
  if (excludeSet.has(name)) return true;

  const basename = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
  return excludeSet.has(basename);
}

function parseZipEntries(data: Uint8Array): ZipEntry[] {
  const entries: ZipEntry[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  while (offset < data.length - 4) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) break; // Local file header signature

    const generalFlags = view.getUint16(offset + 6, true);
    const hasDataDescriptor = (generalFlags & 0x08) !== 0;
    const compressionMethod = view.getUint16(offset + 8, true);
    let compressedSize = view.getUint32(offset + 18, true);
    let uncompressedSize = view.getUint32(offset + 22, true);
    const fileNameLength = view.getUint16(offset + 26, true);
    const extraFieldLength = view.getUint16(offset + 28, true);

    const fileNameStart = offset + 30;
    const fileName = new TextDecoder().decode(
      data.subarray(fileNameStart, fileNameStart + fileNameLength),
    );

    const dataStart = fileNameStart + fileNameLength + extraFieldLength;

    if (hasDataDescriptor && compressedSize === 0) {
      const sizes = findDataDescriptor(data, view, dataStart, compressionMethod);
      compressedSize = sizes.compressedSize;
      uncompressedSize = sizes.uncompressedSize;
    }

    const compressedData = data.subarray(dataStart, dataStart + compressedSize);

    entries.push({
      name: fileName,
      isDirectory: fileName.endsWith("/"),
      compressedData,
      compressionMethod,
      uncompressedSize,
    });

    let nextOffset = dataStart + compressedSize;
    if (hasDataDescriptor) {
      if (nextOffset + 4 <= data.length && view.getUint32(nextOffset, true) === 0x08074b50) {
        nextOffset += 16; // signature(4) + crc(4) + compressedSize(4) + uncompressedSize(4)
      } else {
        nextOffset += 12; // crc(4) + compressedSize(4) + uncompressedSize(4)
      }
    }
    offset = nextOffset;
  }

  return entries;
}

/**
 * Scan forward from dataStart to find the data descriptor that contains
 * the actual compressed and uncompressed sizes. Looks for either the
 * optional signature 0x08074b50 or falls back to scanning the central
 * directory for the matching entry.
 */
function findDataDescriptor(
  data: Uint8Array,
  view: DataView,
  dataStart: number,
  _compressionMethod: number,
): { compressedSize: number; uncompressedSize: number } {
  for (let pos = dataStart; pos < data.length - 16; pos++) {
    const sig = view.getUint32(pos, true);
    if (sig === 0x08074b50) {
      return {
        compressedSize: view.getUint32(pos + 8, true),
        uncompressedSize: view.getUint32(pos + 12, true),
      };
    }
    if (sig === 0x04034b50 || sig === 0x02014b50) {
      const descStart = pos - 12;
      if (descStart >= dataStart) {
        return {
          compressedSize: view.getUint32(descStart + 4, true),
          uncompressedSize: view.getUint32(descStart + 8, true),
        };
      }
      break;
    }
  }
  for (let pos = dataStart; pos < data.length - 4; pos++) {
    const sig = view.getUint32(pos, true);
    if (sig === 0x04034b50 || sig === 0x02014b50 || sig === 0x08074b50) {
      const compressedSize = sig === 0x08074b50
        ? view.getUint32(pos + 8, true)
        : pos - dataStart;
      return { compressedSize, uncompressedSize: 0 };
    }
  }
  return { compressedSize: data.length - dataStart, uncompressedSize: 0 };
}

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
