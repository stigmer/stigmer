/**
 * Pins the R2 driver's logic-bearing pieces — hermetically (presigning is
 * pure local SigV4 computation; no call leaves the host). The Go tree
 * ships r2_storage.go untested; these pins are what the port adds:
 * required-config copy, the 7-day presign clamp, the signed
 * Content-Disposition, and the not-found mapping.
 */
import { describe, expect, it } from "vitest";

import { R2ArtifactStorage, R2_MAX_EXPIRATION_MS, isNotFoundError } from "../r2-storage.js";

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
