/**
 * Pins the R2 driver's logic-bearing pieces — hermetically (presigning is
 * pure local SigV4 computation; no call leaves the host). The Go tree
 * ships r2_storage.go untested; these pins are what the port adds:
 * required-config copy, the 7-day presign clamp, the signed
 * Content-Disposition, the not-found mapping, and the O5 widened surface
 * (typed not-found on download/size, presigned-PUT under the pinned
 * staging prefix with the signed Content-Length).
 */
import { describe, expect, it } from "vitest";

import { ArtifactStorageNotFoundError } from "../artifact-storage.js";
import {
  R2ArtifactStorage,
  R2_MAX_EXPIRATION_MS,
  R2_STAGING_PREFIX,
  isNotFoundError,
} from "../r2-storage.js";

const VALID = {
  bucket: "stigmer-artifacts",
  endpoint: "https://accountid.r2.cloudflarestorage.com",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  region: "auto",
};

describe("R2ArtifactStorage config validation (Go NewR2Storage copy)", () => {
  it.each([
    [{ ...VALID, bucket: "" }, "R2 bucket name is required"],
    [{ ...VALID, endpoint: "" }, "R2 endpoint is required"],
    [{ ...VALID, accessKeyId: "" }, "R2 access key ID is required"],
    [{ ...VALID, secretAccessKey: "" }, "R2 secret access key is required"],
  ])("refuses incomplete config", (config, message) => {
    expect(() => new R2ArtifactStorage(config)).toThrow(message);
  });
});

describe("R2ArtifactStorage presigned URLs", () => {
  const storage = new R2ArtifactStorage(VALID);

  it("presigns a path-style GET under the endpoint and bucket", async () => {
    const url = await storage.getSignedUrl("abc123hash", 3_600_000, "");
    expect(url.startsWith(`${VALID.endpoint}/${VALID.bucket}/abc123hash?`)).toBe(true);
    expect(url).toContain("X-Amz-Expires=3600");
    expect(url).not.toContain("response-content-disposition");
  });

  it("clamps expiry to the R2 maximum of 7 days", async () => {
    const url = await storage.getSignedUrl(
      "abc123hash",
      R2_MAX_EXPIRATION_MS * 3,
      "",
    );
    expect(url).toContain("X-Amz-Expires=604800");
  });

  it("signs the attachment disposition into the URL when a filename is given", async () => {
    const url = await storage.getSignedUrl("abc123hash", 3_600_000, "report.txt");
    // Signed as a response-content-disposition override, mirroring Go.
    expect(url).toContain("response-content-disposition=");
    expect(decodeURIComponent(url)).toContain('attachment; filename="report.txt"');
  });
});

describe("R2ArtifactStorage O5 widened surface", () => {
  it("presignPut mints under the pinned staging prefix, clamps the TTL, and signs the declared size", async () => {
    const storage = new R2ArtifactStorage(VALID);
    const upload = await storage.presignPut(1234, R2_MAX_EXPIRATION_MS * 5);

    expect(upload.stagingKey.startsWith(R2_STAGING_PREFIX)).toBe(true);
    expect(upload.ttlMs).toBe(R2_MAX_EXPIRATION_MS);
    expect(
      upload.url.startsWith(
        `${VALID.endpoint}/${VALID.bucket}/${upload.stagingKey}?`,
      ),
    ).toBe(true);
    expect(upload.url).toContain("X-Amz-Expires=604800");
    // Content-Length rides the signature: a body of a different size
    // fails the check — R2's arm of the exact-size contract.
    expect(upload.url.toLowerCase()).toContain("content-length");
  });

  it("two mints never share a staging key (the URL is the credential)", async () => {
    const storage = new R2ArtifactStorage(VALID);
    const a = await storage.presignPut(1, 60_000);
    const b = await storage.presignPut(1, 60_000);
    expect(a.stagingKey).not.toBe(b.stagingKey);
  });

  it("download and size map the SDK's not-found onto the typed class; real faults stay wrapped", async () => {
    const notFound = Object.assign(new Error("no such key"), {
      name: "NoSuchKey",
    });
    const refused = new Error("connection refused");
    let nextError: Error = notFound;
    const failingClient = {
      send: () => Promise.reject(nextError),
    };
    const storage = new R2ArtifactStorage(VALID, {
      client: failingClient as never,
      presign: () => Promise.resolve("unused"),
    });

    await expect(storage.download("k")).rejects.toThrow(
      ArtifactStorageNotFoundError,
    );
    await expect(storage.size("k")).rejects.toThrow(
      ArtifactStorageNotFoundError,
    );

    nextError = refused;
    await expect(storage.download("k")).rejects.toThrow(
      "r2 download failed: connection refused",
    );
    await expect(storage.size("k")).rejects.toThrow(
      "r2 head failed: connection refused",
    );
  });
});

describe("isNotFoundError", () => {
  it("maps the SDK's structured not-found shapes", () => {
    expect(isNotFoundError(Object.assign(new Error("x"), { name: "NotFound" }))).toBe(true);
    expect(isNotFoundError(Object.assign(new Error("x"), { name: "NoSuchKey" }))).toBe(true);
    expect(
      isNotFoundError(
        Object.assign(new Error("x"), { $metadata: { httpStatusCode: 404 } }),
      ),
    ).toBe(true);
    expect(isNotFoundError(new Error("status 404 from upstream"))).toBe(true);
    expect(isNotFoundError(new Error("object not found"))).toBe(true);
  });

  it("does not swallow real failures", () => {
    expect(isNotFoundError(new Error("connection refused"))).toBe(false);
    expect(
      isNotFoundError(
        Object.assign(new Error("x"), { $metadata: { httpStatusCode: 500 } }),
      ),
    ).toBe(false);
    expect(isNotFoundError(undefined)).toBe(false);
  });
});
