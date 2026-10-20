/**
 * Pins the R2 driver's logic-bearing pieces — hermetically (presigning is
 * pure local SigV4 computation; no call leaves the host). The Go tree
 * ships r2_storage.go untested; these pins are what the port adds:
 * required-config copy, the 7-day presign clamp, the signed
 * Content-Disposition, the not-found mapping, and the widened surface
 * (typed not-found on download/size, presigned-PUT under the caller's key
 * with the signed Content-Length), a runner's links (downloads and
 * uploads) signed for the runner's address when one is set, and the
 * server-side copy.
 */
import { describe, expect, it } from "vitest";

import { ArtifactStorageNotFoundError } from "../artifact-storage.js";
import {
  R2ArtifactStorage,
  R2_MAX_EXPIRATION_MS,
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
    const url = await storage.getSignedUrl("abc123hash", 3_600_000, "", "person");
    expect(url.startsWith(`${VALID.endpoint}/${VALID.bucket}/abc123hash?`)).toBe(true);
    expect(url).toContain("X-Amz-Expires=3600");
    expect(url).not.toContain("response-content-disposition");
  });

  it("clamps expiry to the R2 maximum of 7 days", async () => {
    const url = await storage.getSignedUrl(
      "abc123hash",
      R2_MAX_EXPIRATION_MS * 3,
      "",
      "person",
    );
    expect(url).toContain("X-Amz-Expires=604800");
  });

  it("signs the attachment disposition into the URL when a filename is given", async () => {
    const url = await storage.getSignedUrl("abc123hash", 3_600_000, "report.txt", "person");
    // Signed as a response-content-disposition override, mirroring Go.
    expect(url).toContain("response-content-disposition=");
    expect(decodeURIComponent(url)).toContain('attachment; filename="report.txt"');
  });
});

describe("R2ArtifactStorage links by reader", () => {
  const RUNNER_ENDPOINT = "http://host.docker.internal:9000";

  it("signs a runner's link for the runner's address and a person's for the endpoint", async () => {
    const storage = new R2ArtifactStorage({ ...VALID, runnerEndpoint: RUNNER_ENDPOINT });
    const runner = await storage.getSignedUrl("plugins/abc.zip", 3_600_000, "", "runner");
    const person = await storage.getSignedUrl("plugins/abc.zip", 3_600_000, "", "person");
    expect(runner.startsWith(`${RUNNER_ENDPOINT}/${VALID.bucket}/plugins/abc.zip?`)).toBe(true);
    expect(person.startsWith(`${VALID.endpoint}/${VALID.bucket}/plugins/abc.zip?`)).toBe(true);
  });

  it("signs a runner's upload for the runner's address and a person's for the endpoint", async () => {
    const storage = new R2ArtifactStorage({ ...VALID, runnerEndpoint: RUNNER_ENDPOINT });
    const runner = await storage.presignPut("files/staging/ref", 10, 60_000, "runner");
    const person = await storage.presignPut("skills/staging/ref.zip", 10, 60_000, "person");
    expect(runner.url.startsWith(`${RUNNER_ENDPOINT}/${VALID.bucket}/files/staging/ref?`)).toBe(true);
    expect(person.url.startsWith(`${VALID.endpoint}/${VALID.bucket}/skills/staging/ref.zip?`)).toBe(true);
  });

  it.each([undefined, ""])("signs every reader's link for the endpoint with no runner address (%j)", async (runnerEndpoint) => {
    const storage = new R2ArtifactStorage({ ...VALID, ...(runnerEndpoint === undefined ? {} : { runnerEndpoint }) });
    for (const reader of ["runner", "person"] as const) {
      const url = await storage.getSignedUrl("plugins/abc.zip", 3_600_000, "", reader);
      expect(url.startsWith(`${VALID.endpoint}/${VALID.bucket}/plugins/abc.zip?`), reader).toBe(true);
    }
  });
});

describe("R2ArtifactStorage widened surface", () => {
  it("presignPut signs a PUT under the caller's key, clamps the TTL, and signs the declared size", async () => {
    const storage = new R2ArtifactStorage(VALID);
    const key = "skills/staging/0123456789abcdef0123456789abcdef.zip";
    const upload = await storage.presignPut(key, 1234, R2_MAX_EXPIRATION_MS * 5, "person");

    expect(upload.ttlMs).toBe(R2_MAX_EXPIRATION_MS);
    expect(
      upload.url.startsWith(`${VALID.endpoint}/${VALID.bucket}/${key}?`),
    ).toBe(true);
    expect(upload.url).toContain("X-Amz-Expires=604800");
    // Content-Length rides the signature: a body of a different size
    // fails the check — R2's arm of the exact-size contract.
    expect(upload.url.toLowerCase()).toContain("content-length");
  });

  it("the key is the caller's verbatim — the driver invents none of its own", async () => {
    const storage = new R2ArtifactStorage(VALID);
    const a = await storage.presignPut("staging/a.zip", 1, 60_000, "person");
    const b = await storage.presignPut("staging/b.zip", 1, 60_000, "person");
    expect(a.url).toContain(`/${VALID.bucket}/staging/a.zip?`);
    expect(b.url).toContain(`/${VALID.bucket}/staging/b.zip?`);
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

describe("R2ArtifactStorage copy", () => {
  it("sends one CopyObject inside the bucket, the source's segments encoded", async () => {
    const sent: unknown[] = [];
    const storage = new R2ArtifactStorage(VALID, {
      client: { send: (command: unknown) => { sent.push(command); return Promise.resolve({}); } } as never,
      presign: () => Promise.resolve("unused"),
    });
    await storage.copy("files/staging/a b#c", "files/org_1/blob_1");
    expect(sent).toHaveLength(1);
    const input = (sent[0] as { input: Record<string, string> }).input;
    expect(input).toEqual({
      Bucket: VALID.bucket,
      Key: "files/org_1/blob_1",
      CopySource: `${VALID.bucket}/files/staging/a%20b%23c`,
    });
  });

  it("maps a missing source onto the typed not-found; real faults stay wrapped", async () => {
    let nextError: Error = Object.assign(new Error("no such key"), { name: "NoSuchKey" });
    const storage = new R2ArtifactStorage(VALID, {
      client: { send: () => Promise.reject(nextError) } as never,
      presign: () => Promise.resolve("unused"),
    });
    await expect(storage.copy("a", "b")).rejects.toThrow(ArtifactStorageNotFoundError);
    nextError = new Error("connection refused");
    await expect(storage.copy("a", "b")).rejects.toThrow("r2 copy failed: connection refused");
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

describe("R2ArtifactStorage readRange", () => {
  function withClient(send: (command: unknown) => Promise<unknown>): R2ArtifactStorage {
    return new R2ArtifactStorage(VALID, { client: { send } as never, presign: () => Promise.resolve("unused") });
  }

  it("asks for exactly the range and answers its bytes, and asks nothing for an empty one", async () => {
    const sent: unknown[] = [];
    const storage = withClient((command) => {
      sent.push(command);
      return Promise.resolve({ Body: { transformToByteArray: () => Promise.resolve(new Uint8Array([2, 3, 4, 5])) } });
    });
    expect(await storage.readRange("files/org_1/blob", 2, 4)).toEqual(new Uint8Array([2, 3, 4, 5]));
    expect((sent[0] as { input: Record<string, string> }).input).toEqual({ Bucket: VALID.bucket, Key: "files/org_1/blob", Range: "bytes=2-5" });
    expect(await storage.readRange("files/org_1/blob", 0, 0)).toEqual(new Uint8Array());
    expect(sent, "an empty range reads nothing").toHaveLength(1);
  });

  it("maps a missing key onto the typed not-found, a range past the end onto nothing, and keeps real faults wrapped", async () => {
    let next: unknown = Object.assign(new Error("no such key"), { name: "NoSuchKey" });
    const storage = withClient(() => Promise.reject(next));
    await expect(storage.readRange("k", 0, 4)).rejects.toThrow(ArtifactStorageNotFoundError);
    next = Object.assign(new Error("range"), { name: "InvalidRange" });
    expect(await storage.readRange("k", 100, 4)).toEqual(new Uint8Array());
    next = Object.assign(new Error("range"), { $metadata: { httpStatusCode: 416 } });
    expect(await storage.readRange("k", 100, 4)).toEqual(new Uint8Array());
    next = new Error("connection refused");
    await expect(storage.readRange("k", 0, 4)).rejects.toThrow("r2 ranged download failed: connection refused");
    next = null;
    await expect(storage.readRange("k", 0, 4)).rejects.toThrow("r2 ranged download failed");
    const bodiless = withClient(() => Promise.resolve({}));
    await expect(bodiless.readRange("k", 0, 4)).rejects.toThrow("empty response body");
  });
});
