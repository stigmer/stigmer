/**
 * Gzip helpers for claim-checked blobs. Synchronous by design: the codec
 * runs on the Temporal worker's payload path where the blobs are bounded
 * by the claim-check threshold, and gzip's format is part of the marker
 * contract (`compressed: true` blobs must gunzip on any consumer).
 *
 * Moved from backend/services/runner/src/claimcheck/compressor.ts when the
 * codecs became @stigmer/temporal-codecs.
 */

import { gzipSync, gunzipSync } from "node:zlib";

export function compress(data: Buffer): Buffer<ArrayBuffer> {
  return gzipSync(data) as Buffer<ArrayBuffer>;
}

export function decompress(data: Buffer): Buffer<ArrayBuffer> {
  return gunzipSync(data) as Buffer<ArrayBuffer>;
}
