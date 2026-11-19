/**
 * Pins the S3 driver's logic-bearing pieces — hermetically (presigning is
 * pure local SigV4 computation; no call leaves the host):
 * required-config copy, the 7-day presign clamp, the signed
 * Content-Disposition, the not-found mapping, and the widened surface
 * (typed not-found on download/size, presigned-PUT under the caller's key
 * with the signed Content-Length), a runner's links (downloads and
 * uploads) signed for the runner's address when one is set, the
 * server-side copy, the runner lane's upload (content type signed, no
 * length) and removal by prefix.
 */
import { describe, expect, it } from "vitest";

import { ArtifactStorageNotFoundError } from "../artifact-storage.js";
import {
  S3ArtifactStorage,
  S3_MAX_EXPIRATION_MS,
  isNotFoundError,
} from "../s3-storage.js";

const VALID = {
  bucket: "stigmer-artifacts",
  endpoint: "https://accountid.r2.cloudflarestorage.com",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  region: "auto",
};

const AWS = { ...VALID, endpoint: "", region: "eu-west-1" };

describe("S3ArtifactStorage config validation (the required-config copy)", () => {
  it.each([
    [{ ...VALID, bucket: "" }, "S3 bucket name is required"],
    [{ ...VALID, accessKeyId: "" }, "S3 access key ID is required"],
    [{ ...VALID, secretAccessKey: "" }, "S3 secret access key is required"],
  ])("refuses incomplete config", (config, message) => {
    expect(() => new S3ArtifactStorage(config)).toThrow(message);
  });

  it("an empty endpoint is AWS S3 itself, addressed by region and bucket host", async () => {
    const url = await new S3ArtifactStorage(AWS).getSignedUrl("k", 60_000, "", "person");
    expect(url.startsWith(`https://${VALID.bucket}.s3.eu-west-1.amazonaws.com/k?`)).toBe(true);
  });
});

describe("S3ArtifactStorage presigned URLs", () => {
  const storage = new S3ArtifactStorage(VALID);

  it("presigns a path-style GET under the endpoint and bucket", async () => {
    const url = await storage.getSignedUrl("abc123hash", 3_600_000, "", "person");
    expect(url.startsWith(`${VALID.endpoint}/${VALID.bucket}/abc123hash?`)).toBe(true);
    expect(url).toContain("X-Amz-Expires=3600");
    expect(url).not.toContain("response-content-disposition");
  });

  it("clamps expiry to the SigV4 maximum of 7 days", async () => {
    const url = await storage.getSignedUrl(
      "abc123hash",
      S3_MAX_EXPIRATION_MS * 3,
      "",
      "person",
    );
    expect(url).toContain("X-Amz-Expires=604800");
  });

  it("signs the attachment disposition into the URL when a filename is given", async () => {
    const url = await storage.getSignedUrl("abc123hash", 3_600_000, "report.txt", "person");
    // Signed as a response-content-disposition override.
    expect(url).toContain("response-content-disposition=");
    expect(decodeURIComponent(url)).toContain('attachment; filename="report.txt"');
  });
});

describe("S3ArtifactStorage links by reader", () => {
  const RUNNER_ENDPOINT = "http://host.docker.internal:9000";

  it("signs a runner's link for the runner's address and a person's for the endpoint", async () => {
    const storage = new S3ArtifactStorage({ ...VALID, runnerEndpoint: RUNNER_ENDPOINT });
    const runner = await storage.getSignedUrl("plugins/abc.zip", 3_600_000, "", "runner");
    const person = await storage.getSignedUrl("plugins/abc.zip", 3_600_000, "", "person");
    expect(runner.startsWith(`${RUNNER_ENDPOINT}/${VALID.bucket}/plugins/abc.zip?`)).toBe(true);
    expect(person.startsWith(`${VALID.endpoint}/${VALID.bucket}/plugins/abc.zip?`)).toBe(true);
  });

  it("signs a runner's upload for the runner's address and a person's for the endpoint", async () => {
    const storage = new S3ArtifactStorage({ ...VALID, runnerEndpoint: RUNNER_ENDPOINT });
    const runner = await storage.presignPut("files/staging/ref", 10, 60_000, "runner");
    const person = await storage.presignPut("skills/staging/ref.zip", 10, 60_000, "person");
    expect(runner.url.startsWith(`${RUNNER_ENDPOINT}/${VALID.bucket}/files/staging/ref?`)).toBe(true);
    expect(person.url.startsWith(`${VALID.endpoint}/${VALID.bucket}/skills/staging/ref.zip?`)).toBe(true);
  });

  it.each([undefined, ""])("signs every reader's link for the endpoint with no runner address (%j)", async (runnerEndpoint) => {
    const storage = new S3ArtifactStorage({ ...VALID, ...(runnerEndpoint === undefined ? {} : { runnerEndpoint }) });
    for (const reader of ["runner", "person"] as const) {
      const url = await storage.getSignedUrl("plugins/abc.zip", 3_600_000, "", reader);
      expect(url.startsWith(`${VALID.endpoint}/${VALID.bucket}/plugins/abc.zip?`), reader).toBe(true);
    }
  });
});

describe("S3ArtifactStorage widened surface", () => {
  it("presignPut signs a PUT under the caller's key, clamps the TTL, and signs the declared size", async () => {
    const storage = new S3ArtifactStorage(VALID);
    const key = "skills/staging/0123456789abcdef0123456789abcdef.zip";
    const upload = await storage.presignPut(key, 1234, S3_MAX_EXPIRATION_MS * 5, "person");

    expect(upload.ttlMs).toBe(S3_MAX_EXPIRATION_MS);
    expect(
      upload.url.startsWith(`${VALID.endpoint}/${VALID.bucket}/${key}?`),
    ).toBe(true);
    expect(upload.url).toContain("X-Amz-Expires=604800");
    // Content-Length rides the signature: a body of a different size
    // fails the check — the bucket's arm of the exact-size contract.
    expect(upload.url.toLowerCase()).toContain("content-length");
  });

  it("the key is the caller's verbatim — the driver invents none of its own", async () => {
    const storage = new S3ArtifactStorage(VALID);
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
    const storage = new S3ArtifactStorage(VALID, {
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
      "s3 download failed: connection refused",
    );
    await expect(storage.size("k")).rejects.toThrow(
      "s3 head failed: connection refused",
    );
  });
});

describe("S3ArtifactStorage copy", () => {
  it("sends one CopyObject inside the bucket, the source's segments encoded", async () => {
    const sent: unknown[] = [];
    const storage = new S3ArtifactStorage(VALID, {
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
    const storage = new S3ArtifactStorage(VALID, {
      client: { send: () => Promise.reject(nextError) } as never,
      presign: () => Promise.resolve("unused"),
    });
    await expect(storage.copy("a", "b")).rejects.toThrow(ArtifactStorageNotFoundError);
    nextError = new Error("connection refused");
    await expect(storage.copy("a", "b")).rejects.toThrow("s3 copy failed: connection refused");
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

describe("S3ArtifactStorage readRange", () => {
  function withClient(send: (command: unknown) => Promise<unknown>): S3ArtifactStorage {
    return new S3ArtifactStorage(VALID, { client: { send } as never, presign: () => Promise.resolve("unused") });
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
    await expect(storage.readRange("k", 0, 4)).rejects.toThrow("s3 ranged download failed: connection refused");
    next = null;
    await expect(storage.readRange("k", 0, 4)).rejects.toThrow("s3 ranged download failed");
    const bodiless = withClient(() => Promise.resolve({}));
    await expect(bodiless.readRange("k", 0, 4)).rejects.toThrow("empty response body");
  });
});

describe("S3ArtifactStorage runner upload (the runner artifact lane's contract)", () => {
  it("signs the content type and no length, for the runner's address, and hands back the headers to replay", async () => {
    const storage = new S3ArtifactStorage({ ...VALID, runnerEndpoint: "http://host.docker.internal:9000" });
    const upload = await storage.presignRunnerUpload("artifacts/run_1/out.txt", "text/plain", 30 * 60_000);
    expect(upload.method).toBe("PUT");
    expect(upload.headers).toEqual({ "content-type": "text/plain" });
    expect(upload.url.startsWith(`http://host.docker.internal:9000/${VALID.bucket}/artifacts/run_1/out.txt?`)).toBe(true);
    const signed = decodeURIComponent(new URL(upload.url).searchParams.get("X-Amz-SignedHeaders") ?? "");
    expect(signed.split(";")).toContain("content-type");
    expect(signed).not.toContain("content-length");
    expect(upload.url).toContain("X-Amz-Expires=1800");
  });

  it("clamps the TTL to the SigV4 maximum", async () => {
    const upload = await new S3ArtifactStorage(VALID).presignRunnerUpload("artifacts/run_1/a", "application/octet-stream", S3_MAX_EXPIRATION_MS * 2);
    expect(upload.url).toContain("X-Amz-Expires=604800");
  });
});

describe("S3ArtifactStorage deletePrefix", () => {
  type Sent = { input: Record<string, unknown>; constructor: { name: string } };

  function overObjects(keys: string[], opts: { failKey?: string } = {}) {
    const objects = new Set(keys);
    const sent: Sent[] = [];
    const client = {
      send: (command: Sent) => {
        sent.push(command);
        if (command.constructor.name === "ListObjectsV2Command") {
          const prefix = String(command.input.Prefix);
          const max = Number(command.input.MaxKeys);
          const all = [...objects].filter((k) => k.startsWith(prefix)).sort();
          return Promise.resolve({ Contents: all.slice(0, max).map((Key) => ({ Key })), IsTruncated: all.length > max });
        }
        const doomed = (command.input.Delete as { Objects: Array<{ Key: string }> }).Objects.map((o) => o.Key);
        const errors = doomed.filter((k) => k === opts.failKey).map((Key) => ({ Key, Code: "AccessDenied" }));
        for (const key of doomed) {
          if (key !== opts.failKey) objects.delete(key);
        }
        return Promise.resolve({ Errors: errors });
      },
    };
    const storage = new S3ArtifactStorage(VALID, { client: client as never, presign: () => Promise.resolve("unused") });
    return { storage, objects, sent };
  }

  it("empties only the named folder, a sibling folder kept, and a second call removes nothing", async () => {
    const { storage, objects } = overObjects(["artifacts/run_1/a", "artifacts/run_1/b/c", "artifacts/run_10/a"]);
    expect(await storage.deletePrefix("artifacts/run_1/", 1000)).toEqual({ deleted: 2, more: false });
    expect([...objects]).toEqual(["artifacts/run_10/a"]);
    expect(await storage.deletePrefix("artifacts/run_1/", 1000)).toEqual({ deleted: 0, more: false });
  });

  it("answers more while a folder holds more than the limit", async () => {
    const { storage } = overObjects(["p/1", "p/2", "p/3"]);
    expect(await storage.deletePrefix("p/", 2)).toEqual({ deleted: 2, more: true });
    expect(await storage.deletePrefix("p/", 2)).toEqual({ deleted: 1, more: false });
  });

  it("refuses a prefix that is not one folder, and a per-key failure is a fault", async () => {
    const { storage } = overObjects(["p/1", "p/2"], { failKey: "p/2" });
    await expect(storage.deletePrefix("", 10)).rejects.toThrow("is not one folder");
    await expect(storage.deletePrefix("p", 10)).rejects.toThrow("is not one folder");
    await expect(storage.deletePrefix("p/", 10)).rejects.toThrow("1 of 2 objects under 'p/' were not deleted (first: AccessDenied)");
  });
});
