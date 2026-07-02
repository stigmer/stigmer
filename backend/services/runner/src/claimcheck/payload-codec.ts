/**
 * Temporal PayloadCodec that transparently offloads large payloads to
 * external storage (ArtifactStorage). Payloads below the threshold pass
 * through unchanged. Payloads at or above the threshold are compressed
 * (optional), uploaded, and replaced with a small reference marker.
 *
 * On decode, markers are detected, the original payload is downloaded
 * and decompressed, and the original bytes are restored — transparent
 * to workflow/activity code.
 */

import { randomUUID } from "node:crypto";
import type { Payload, PayloadCodec } from "@temporalio/common";
import type { ArtifactStorage } from "../shared/artifact-storage.js";
import type { ClaimcheckConfig } from "./config.js";
import { compress, decompress } from "./compressor.js";

const MARKER_METADATA_KEY = "encoding";
const MARKER_ENCODING_VALUE = "binary/claimcheck";

interface ClaimcheckMarker {
  key: string;
  size: number;
  compressed: boolean;
}

export class ClaimcheckPayloadCodec implements PayloadCodec {
  constructor(
    private readonly storage: ArtifactStorage,
    private readonly config: ClaimcheckConfig,
  ) {}

  async encode(payloads: Payload[]): Promise<Payload[]> {
    return Promise.all(payloads.map((p) => this.encodePayload(p)));
  }

  async decode(payloads: Payload[]): Promise<Payload[]> {
    return Promise.all(payloads.map((p) => this.decodePayload(p)));
  }

  private async encodePayload(payload: Payload): Promise<Payload> {
    const data = payload.data;
    if (!data || data.length < this.config.thresholdBytes) {
      return payload;
    }

    const originalBuf = Buffer.from(data);
    let uploadBuf = originalBuf;
    let compressed = false;

    if (this.config.compressionEnabled) {
      const compressedBuf = compress(originalBuf);
      if (compressedBuf.length < originalBuf.length) {
        uploadBuf = compressedBuf;
        compressed = true;
      }
    }

    const key = `${this.config.keyPrefix}${randomUUID()}`;
    await this.storage.upload(key, uploadBuf, "application/octet-stream");

    const marker: ClaimcheckMarker = {
      key,
      size: data.length,
      compressed,
    };

    return {
      metadata: {
        [MARKER_METADATA_KEY]: Buffer.from(MARKER_ENCODING_VALUE),
      },
      data: Buffer.from(JSON.stringify(marker)),
    };
  }

  private async decodePayload(payload: Payload): Promise<Payload> {
    if (!this.isClaimcheckPayload(payload)) {
      return payload;
    }

    const marker: ClaimcheckMarker = JSON.parse(
      Buffer.from(payload.data!).toString("utf-8"),
    );

    let rawBuf: Buffer;
    try {
      rawBuf = await this.storage.download(marker.key);
    } catch (err) {
      // Preserve the claimcheck-scoped error contract; the shared download error
      // already carries the HTTP status (proxy) or the miss (local) as the cause.
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(`Claimcheck retrieve failed for key ${marker.key}: ${cause}`);
    }
    const dataBuf = marker.compressed ? decompress(rawBuf) : rawBuf;

    return {
      metadata: payload.metadata,
      data: dataBuf,
    };
  }

  private isClaimcheckPayload(payload: Payload): boolean {
    const encoding = payload.metadata?.[MARKER_METADATA_KEY];
    if (!encoding) return false;
    return Buffer.from(encoding).toString("utf-8") === MARKER_ENCODING_VALUE;
  }
}
