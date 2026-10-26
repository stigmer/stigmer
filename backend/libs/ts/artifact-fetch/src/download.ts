/**
 * A verified download streamed to a file.
 *
 * The response body is written to `dest` while it is hashed, so an artifact
 * of any size costs one buffer of memory, and the file is only handed back
 * once the whole body matched its expected digest. A mismatch is an answer,
 * not a blip: the file is removed and the download is refused without a
 * retry. Every other failure (the retry contract in `retry.ts` given up, an
 * abort) also removes the file, so `dest` exists afterwards exactly when it
 * holds the verified bytes.
 */

import { createHash } from "node:crypto";
import { open, rm } from "node:fs/promises";
import { ArtifactFetchError } from "./errors.js";
import { formatDigest, type ExpectedDigest } from "./digest.js";
import { fetchWithRetry, network } from "./retry.js";

export interface DownloadToFileOptions {
  /** The artifact's URL. */
  readonly url: string;
  /** The file the verified bytes are written to; replaced when it exists. */
  readonly dest: string;
  /** What the whole body must hash to. */
  readonly expected: ExpectedDigest;
  /** The artifact's name in errors ("Claude engine", "Temporal CLI"). */
  readonly label: string;
  /** Stops the download; the file is removed and the signal's reason thrown. */
  readonly signal?: AbortSignal;
  /** Called after every chunk with the bytes received so far in this attempt and the advertised length, when the server sent one. */
  readonly onProgress?: (received: number, total: number | undefined) => void;
  /** Override the fetch implementation (tests). */
  readonly fetchImpl?: typeof fetch;
  /** Override the wait between download attempts (tests). */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Download `url` to `dest`, verified against `expected`; resolves with the byte count. */
export async function downloadToFile(options: DownloadToFileOptions): Promise<{ readonly bytes: number }> {
  const net = network({ fetchImpl: options.fetchImpl, sleep: options.sleep });
  try {
    const { bytes, actual } = await fetchWithRetry(net, options.url, options.label, (res) => writeBody(res, options), options.signal);
    if (!actual.equals(options.expected.digest)) {
      throw new ArtifactFetchError(`${options.label} checksum mismatch — refusing to use the download`, [
        `expected: ${formatDigest(options.expected)}`,
        `actual:   ${formatDigest({ algorithm: options.expected.algorithm, digest: actual })}`,
        `archive:  ${options.url}`,
      ]);
    }
    return { bytes };
  } catch (err) {
    await rm(options.dest, { force: true });
    throw err;
  }
}

// One attempt's body: truncate the file, then hash and write each chunk in
// order. A body that ends early throws, and the retry contract decides.
async function writeBody(res: Response, options: DownloadToFileOptions): Promise<{ bytes: number; actual: Buffer }> {
  if (res.body === null) throw new Error("the response has no body");
  // A length names the bytes on the wire; fetch decodes a content-encoding
  // before the body reaches here, so only an unencoded length counts.
  const advertised = res.headers.get("content-encoding") === null ? Number(res.headers.get("content-length")) : Number.NaN;
  const total = Number.isFinite(advertised) && advertised > 0 ? advertised : undefined;
  const hash = createHash(options.expected.algorithm);
  const file = await open(options.dest, "w", 0o644);
  let bytes = 0;
  try {
    for await (const chunk of res.body) {
      hash.update(chunk);
      await file.write(chunk);
      bytes += chunk.byteLength;
      options.onProgress?.(bytes, total);
    }
  } finally {
    await file.close();
  }
  if (total !== undefined && bytes !== total) throw new Error(`the body ended after ${bytes} of ${total} bytes`);
  return { bytes, actual: hash.digest() };
}
