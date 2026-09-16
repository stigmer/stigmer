/**
 * Reading one archive entry under a real cap. Declared sizes are client
 * claims, so every gate that opens an entry bounds the ACTUAL inflated
 * output (`maxOutputLength`), verifies the CRC the way Go's checksumReader
 * does on every read, and opens only the two methods the platform
 * registers (stored, deflated). The skill gate did this for SKILL.md alone;
 * a plugin reads many documents through the same discipline, so the read
 * lives here and each kind keeps its own sentences: the outcome is a typed
 * failure, never prose, because the skill's copy is byte-pinned wire
 * contract and a plugin's names a different document.
 *
 * Proven by __tests__/inflate.test.ts and, through composition, by the
 * skill gate's zip-gate.test.ts.
 */
import { inflateRawSync } from "node:zlib";

import { crc32 } from "@stigmer/zip-structure";
import type { ZipStructuralEntry } from "@stigmer/zip-structure";

/** ZIP compression methods the gate can open (Go registers the same two). */
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;

export type InflateFailureKind =
  /** The inflated output passed `maxSize`. */
  | "too-large"
  /** zlib refused the payload; `detail` carries its message. */
  | "read-failed"
  /** A compression method neither Go nor this gate registers. */
  | "unsupported-method"
  /** The inflated bytes do not match the entry's CRC. */
  | "checksum";

/** A typed refusal; the kind that called maps it to its pinned sentence. */
export class InflateError extends Error {
  constructor(
    readonly kind: InflateFailureKind,
    readonly detail: string,
  ) {
    super(`${kind}: ${detail}`);
    this.name = "InflateError";
  }
}

/**
 * Inflates one entry to at most `maxSize` bytes and verifies its CRC.
 * The cap bounds the actual output, not the declaration.
 */
export function inflateEntry(
  entry: ZipStructuralEntry,
  maxSize: number,
): Uint8Array {
  let content: Uint8Array;
  switch (entry.compressionMethod) {
    case METHOD_STORED:
      content = entry.compressedData;
      break;
    case METHOD_DEFLATED:
      try {
        content = new Uint8Array(
          inflateRawSync(entry.compressedData, {
            maxOutputLength: maxSize + 1,
          }),
        );
      } catch (error) {
        if (isOutputLengthError(error)) {
          throw new InflateError(
            "too-large",
            `output exceeds ${maxSize} bytes`,
          );
        }
        throw new InflateError(
          "read-failed",
          error instanceof Error ? error.message : String(error),
        );
      }
      break;
    default:
      // Go: File.Open returns ErrAlgorithm for methods without a registered
      // decompressor; each kind pins the text via its own %w-shaped arm.
      throw new InflateError(
        "unsupported-method",
        "zip: unsupported compression algorithm",
      );
  }

  if (content.length > maxSize) {
    throw new InflateError("too-large", `output exceeds ${maxSize} bytes`);
  }

  if (crc32(content) !== entry.crc32) {
    // Go's checksumReader: stdlib ErrChecksum via the read-error arm.
    throw new InflateError("checksum", "zip: checksum error");
  }

  return content;
}

/** node:zlib's maxOutputLength violation (the output-cap arm). */
function isOutputLengthError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (("code" in error &&
      (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") ||
      error.message.includes("maxOutputLength"))
  );
}
