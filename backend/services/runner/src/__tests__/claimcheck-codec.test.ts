import { describe, it, expect, beforeEach } from "vitest";
import { ClaimcheckPayloadCodec } from "../claimcheck/payload-codec.js";
import { compress } from "../claimcheck/compressor.js";
import type { ClaimcheckConfig } from "../claimcheck/config.js";
import { makeInMemoryArtifactStorage } from "../__test-utils__/fake-artifact-storage.js";
import type { Payload } from "@temporalio/common";

function makeConfig(overrides: Partial<ClaimcheckConfig> = {}): ClaimcheckConfig {
  return {
    enabled: true,
    thresholdBytes: 1024,
    compressionEnabled: true,
    keyPrefix: "claimcheck/",
    ...overrides,
  };
}

function makeStorage() {
  // The canonical in-memory double; `uploads` aliases its backing Map so the
  // existing `storage.uploads.*` assertions keep working, and `download` reads
  // straight from what `encode` uploaded (no fetch to stub).
  const { storage, blobs } = makeInMemoryArtifactStorage();
  return Object.assign(storage, { uploads: blobs });
}

function makePayload(data: string | Buffer): Payload {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  return {
    metadata: { encoding: Buffer.from("binary/plain") },
    data: buf,
  };
}

function makeLargePayload(sizeBytes: number): Payload {
  const buf = Buffer.alloc(sizeBytes, "x");
  return {
    metadata: { encoding: Buffer.from("binary/plain") },
    data: buf,
  };
}

describe("ClaimcheckPayloadCodec", () => {
  let storage: ReturnType<typeof makeStorage>;
  let codec: ClaimcheckPayloadCodec;

  beforeEach(() => {
    storage = makeStorage();
    codec = new ClaimcheckPayloadCodec(storage, makeConfig());
  });

  describe("encode", () => {
    it("passes through payloads below threshold unchanged", async () => {
      const payload = makePayload("small data");
      const [result] = await codec.encode([payload]);
      expect(result).toBe(payload);
      expect(storage.uploads.size).toBe(0);
    });

    it("passes through empty payloads", async () => {
      const payload: Payload = { metadata: {}, data: undefined };
      const [result] = await codec.encode([payload]);
      expect(result).toBe(payload);
    });

    it("offloads payloads at or above threshold", async () => {
      const payload = makeLargePayload(1024);
      const [result] = await codec.encode([payload]);

      expect(result).not.toBe(payload);
      expect(storage.uploads.size).toBe(1);

      const markerMeta = result.metadata?.["encoding"];
      expect(Buffer.from(markerMeta!).toString()).toBe("binary/claimcheck");

      const marker = JSON.parse(Buffer.from(result.data!).toString());
      expect(marker.key).toMatch(/^claimcheck\//);
      expect(marker.size).toBe(1024);
      expect(marker.compressed).toBe(true);
    });

    it("skips compression when it does not reduce size", async () => {
      const randomBuf = Buffer.from(
        Array.from({ length: 1024 }, () => Math.floor(Math.random() * 256)),
      );
      const payload: Payload = {
        metadata: { encoding: Buffer.from("binary/plain") },
        data: randomBuf,
      };

      const compressedSize = compress(randomBuf).length;
      if (compressedSize >= randomBuf.length) {
        const [result] = await codec.encode([payload]);
        const marker = JSON.parse(Buffer.from(result.data!).toString());
        expect(marker.compressed).toBe(false);

        const uploaded = storage.uploads.values().next().value!;
        expect(uploaded.length).toBe(randomBuf.length);
      }
    });

    it("does not compress when compression is disabled", async () => {
      codec = new ClaimcheckPayloadCodec(
        storage,
        makeConfig({ compressionEnabled: false }),
      );
      const payload = makeLargePayload(1024);
      const [result] = await codec.encode([payload]);

      const marker = JSON.parse(Buffer.from(result.data!).toString());
      expect(marker.compressed).toBe(false);

      const uploaded = storage.uploads.values().next().value!;
      expect(uploaded.length).toBe(1024);
    });

    it("handles multiple payloads in a batch", async () => {
      const small = makePayload("tiny");
      const large = makeLargePayload(2048);

      const results = await codec.encode([small, large]);
      expect(results[0]).toBe(small);
      expect(results[1]).not.toBe(large);
      expect(storage.uploads.size).toBe(1);
    });

    it("uses configured key prefix", async () => {
      codec = new ClaimcheckPayloadCodec(
        storage,
        makeConfig({ keyPrefix: "custom-prefix/" }),
      );
      const payload = makeLargePayload(1024);
      const [result] = await codec.encode([payload]);

      const marker = JSON.parse(Buffer.from(result.data!).toString());
      expect(marker.key).toMatch(/^custom-prefix\//);
    });
  });

  describe("decode", () => {
    it("passes through non-claimcheck payloads unchanged", async () => {
      const payload = makePayload("normal data");
      const [result] = await codec.decode([payload]);
      expect(result).toBe(payload);
    });

    it("retrieves and decompresses offloaded payloads (round-trip)", async () => {
      const original = makeLargePayload(2048);
      const [encoded] = await codec.encode([original]);

      // decode reads back through storage.download from what encode uploaded.
      const [decoded] = await codec.decode([encoded]);
      expect(Buffer.from(decoded.data!)).toEqual(original.data);
    });

    it("retrieves uncompressed payloads correctly", async () => {
      codec = new ClaimcheckPayloadCodec(
        storage,
        makeConfig({ compressionEnabled: false }),
      );

      const original = makeLargePayload(1500);
      const [encoded] = await codec.encode([original]);

      const [decoded] = await codec.decode([encoded]);
      expect(Buffer.from(decoded.data!)).toEqual(original.data);
    });

    it("wraps a download failure with the claimcheck error contract", async () => {
      const encoded: Payload = {
        metadata: { encoding: Buffer.from("binary/claimcheck") },
        data: Buffer.from(JSON.stringify({
          key: "claimcheck/missing",
          size: 100,
          compressed: false,
        })),
      };

      // Drive the failure through the port; the proxy download surfaces the HTTP
      // status, which the codec must preserve in its wrapped, key-scoped message.
      storage.download.mockRejectedValueOnce(
        new Error("Artifact download failed (HTTP 404) for key 'claimcheck/missing'"),
      );

      await expect(codec.decode([encoded])).rejects.toThrow(
        /Claimcheck retrieve failed for key claimcheck\/missing.*HTTP 404/,
      );
    });
  });

  describe("threshold boundary", () => {
    it("does NOT offload at threshold - 1", async () => {
      const payload = makeLargePayload(1023);
      const [result] = await codec.encode([payload]);
      expect(result).toBe(payload);
    });

    it("offloads at exactly threshold", async () => {
      const payload = makeLargePayload(1024);
      const [result] = await codec.encode([payload]);
      expect(result).not.toBe(payload);
    });

    it("offloads above threshold", async () => {
      const payload = makeLargePayload(1025);
      const [result] = await codec.encode([payload]);
      expect(result).not.toBe(payload);
    });
  });

  describe("compressor", () => {
    it("compresses and decompresses correctly", async () => {
      const { compress: c, decompress: d } = await import("../claimcheck/compressor.js");
      const input = Buffer.from("hello world ".repeat(100));
      const compressed = c(input);
      expect(compressed.length).toBeLessThan(input.length);
      const decompressed = d(compressed);
      expect(decompressed).toEqual(input);
    });
  });
});
