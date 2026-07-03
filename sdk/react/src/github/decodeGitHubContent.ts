// Pure byte/text decode helpers for the GitHub file reader.
// Kept free of React and fetch so the Slice 0 spike behavior (base64 decode,
// binary detection, the 1 MB cap) is unit-testable in isolation.

import {
  MAX_WORKSPACE_FILE_READ_BYTES,
  type WorkspaceFileContent,
} from "../workspace/WorkspaceFileReader.js";

// Scan only the head for a NUL byte — git uses the first 8000 bytes as its
// text/binary heuristic, and scanning the whole buffer buys nothing.
const BINARY_SNIFF_BYTES = 8000;

/**
 * Decode a GitHub base64 payload to raw bytes.
 *
 * GitHub's Contents API line-wraps its base64 with `\n` every 60 chars, and
 * `atob` rejects embedded newlines in some engines — strip all ASCII
 * whitespace first.
 */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s/g, "");
  const binary = atob(clean);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

/** Detect binary content via a NUL byte in the head of the buffer. */
export function detectBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

/**
 * Decode bytes as strict UTF-8, returning `null` when the sequence is invalid.
 * `{ fatal: true }` makes `TextDecoder` throw rather than emit replacement
 * characters, so undecodable files degrade to the binary/unknown fallback
 * instead of silently rendering mojibake.
 */
export function bytesToText(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Turn decoded bytes into a {@link WorkspaceFileContent}, applying binary
 * detection and the shared 1 MB display cap.
 *
 * @param bytes    the full decoded bytes as delivered by GitHub
 * @param fullSize the file's true size in bytes (GitHub's `size` field), which
 *                 may exceed `bytes.length` when the caller has already capped
 *                 the download — reported verbatim as `size`.
 */
export function normalizeGitHubContent(
  bytes: Uint8Array,
  fullSize: number,
): WorkspaceFileContent {
  if (detectBinary(bytes)) {
    return { text: null, isBinary: true, size: fullSize, encoding: "base64" };
  }

  // Decode the full buffer, then cap the resulting *string* — capping the bytes
  // first could split a multibyte char at the boundary and make the fatal
  // decoder reject an otherwise-valid file.
  const text = bytesToText(bytes);
  if (text === null) {
    return { text: null, isBinary: false, size: fullSize, encoding: "unknown" };
  }

  const truncated = bytes.length > MAX_WORKSPACE_FILE_READ_BYTES;
  return {
    text: truncated ? text.slice(0, MAX_WORKSPACE_FILE_READ_BYTES) : text,
    isBinary: false,
    size: fullSize,
    encoding: "utf-8",
    ...(truncated ? { truncated: true } : {}),
  };
}
