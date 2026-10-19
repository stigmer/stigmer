/**
 * Pins the Files transfer lane (../transfer.ts) over a real HTTP listener,
 * the real slot registry and the real signer, as the unified port mounts
 * it:
 *   - an upload is a PUT to a reference the slots reserved: any other
 *     method is 405, a malformed, unknown or expired reference one 404, a
 *     second PUT to a used one 409, a body of another size than declared
 *     400, and a registry fault 500;
 *   - a download is a GET (or HEAD) of a link the File driver signed: any
 *     other method is 405, and an unsigned, tampered or expired link, a
 *     malformed path, a staged upload's key, a key outside the File store,
 *     a key that escapes the root, a key naming nothing and a directory
 *     are each the one 404; a signed link to a File's blob streams its
 *     bytes, named for download when the link carries a filename, a HEAD
 *     answers the length with no body, and bytes that cannot be read once
 *     the answer began drop the connection and are logged;
 *   - a path outside the lane's prefix, reaching the handler directly, is
 *     404, and a handler that fails after answering is logged, never an
 *     unhandled rejection.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { LocalArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import { testUrlSigner } from "../../../artifactstorage/__test-utils__/url-signer.js";
import type { Logger } from "../../../boot/logger.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import type { LaneRequest, LaneResponse } from "../../../transport/lanes.js";
import { UploadSlots } from "../../skill/transfer/slots.js";
import { stagingKeyOf } from "../blobs.js";
import { STAGED_FILE_NAME, STAGING_KEY_PREFIX } from "../constants.js";
import { fileTransferServeUrl, fileUploadUrl, newFileTransferLane } from "../transfer.js";

const HEX = "ab".repeat(16);
const REF = `fup_${HEX}`;
const BLOB_KEY = "files/org_01aaaaaaaaaaaaaaaaaaaaaaaa/blob1";

let root: string;
let slots: UploadSlots;
let server: http.Server;
let base: string;
let driver: LocalArtifactStorage;
const signer = testUrlSigner();

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), "file-transfer-"));
  slots = new UploadSlots(root, STAGING_KEY_PREFIX, 60_000, 1024, Date.now, STAGED_FILE_NAME);
  const lane = newFileTransferLane({ slots, root, signer, logger: silentLogger });
  server = http.createServer((req, res) => lane(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  driver = new LocalArtifactStorage(root, fileTransferServeUrl(base), signer);
  mkdirSync(path.join(root, path.dirname(BLOB_KEY)), { recursive: true });
  writeFileSync(path.join(root, BLOB_KEY), "file bytes");
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

/** A link the File driver signs for `key`, as getDownloadUrl mints one. */
function signedLink(key: string, filename = ""): Promise<string> {
  return driver.getSignedUrl(key, 60_000, filename, "person");
}

describe("the upload route", () => {
  it("takes exactly the declared bytes once, then answers 409", async () => {
    slots.reserve(stagingKeyOf(REF) ?? "", 3);
    const url = fileUploadUrl(`${base}/`, REF);
    expect(url).toBe(`${base}/v1/file-transfer/uploads/${REF}`);
    expect((await fetch(url, { method: "PUT", body: "abc" })).status).toBe(204);
    const again = await fetch(url, { method: "PUT", body: "abc" });
    expect(again.status).toBe(409);
    expect(await again.text()).toContain("already used");
  });

  it("refuses a body of another size than declared with 400", async () => {
    const ref = `fup_${"cd".repeat(16)}`;
    slots.reserve(stagingKeyOf(ref) ?? "", 3);
    const response = await fetch(fileUploadUrl(base, ref), { method: "PUT", body: "abcd" });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("must match the size given to createUploadUrl");
  });

  it.each([
    ["a malformed reference", "sau_123"],
    ["a reference nobody reserved", `fup_${"ef".repeat(16)}`],
  ])("answers %s with the one 404", async (_name, ref) => {
    const response = await fetch(`${base}/v1/file-transfer/uploads/${ref}`, { method: "PUT", body: "x" });
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("unknown or expired");
  });

  it("refuses any method but PUT with 405", async () => {
    const response = await fetch(fileUploadUrl(base, REF), { method: "POST", body: "x" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("PUT");
  });

  it("answers a registry fault with 500 and logs it", async () => {
    const error = vi.fn();
    const logger = { ...silentLogger, error } as Logger;
    const failing = {
      receive: () => Promise.reject(new Error("disk full")),
    } as unknown as UploadSlots;
    const lane = newFileTransferLane({ slots: failing, root, signer, logger });
    const answer = await laneAnswer(lane, "PUT", `/v1/file-transfer/uploads/${REF}`);
    expect(answer.status).toBe(500);
    expect(error).toHaveBeenCalledWith("file upload failed", expect.objectContaining({ error: "disk full" }));
  });
});

describe("the download route", () => {
  it("streams a File's bytes from a signed link, named for download when it carries a filename", async () => {
    const response = await fetch(await signedLink(BLOB_KEY, "Q3 ledger.csv"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("10");
    expect(response.headers.get("content-disposition")).toContain('filename="Q3 ledger.csv"');
    expect(await response.text()).toBe("file bytes");

    const inline = await fetch(await signedLink(BLOB_KEY));
    expect(inline.headers.get("content-disposition")).toBeNull();
  });

  it("answers a HEAD with the length and no body", async () => {
    const response = await fetch(await signedLink(BLOB_KEY), { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("10");
    expect(await response.text()).toBe("");
  });

  it("drops the connection and logs when the bytes cannot be read after the answer began", async () => {
    const key = "files/org_01aaaaaaaaaaaaaaaaaaaaaaaa/unreadable";
    writeFileSync(path.join(root, key), "secret");
    chmodSync(path.join(root, key), 0o000);
    const error = vi.fn();
    const lane = newFileTransferLane({ slots, root, signer, logger: { ...silentLogger, error } as Logger });
    const unreadable = http.createServer((req, res) => lane(req, res));
    await new Promise<void>((resolve) => unreadable.listen(0, "127.0.0.1", resolve));
    try {
      const port = (unreadable.address() as AddressInfo).port;
      const link = `http://127.0.0.1:${port}/v1/file-transfer/${key}?${signer.signedQuery(key, 60_000, "")}`;
      await expect(fetch(link).then((r) => r.text())).rejects.toThrow();
      await vi.waitFor(() =>
        expect(error).toHaveBeenCalledWith("file download stream failed", expect.objectContaining({ key })),
      );
    } finally {
      chmodSync(path.join(root, key), 0o600);
      await new Promise<void>((resolve) => unreadable.close(() => resolve()));
    }
  });

  it("refuses any method but GET and HEAD with 405", async () => {
    const response = await fetch(await signedLink(BLOB_KEY), { method: "DELETE" });
    expect(response.status).toBe(405);
  });

  it("answers an unsigned or tampered link with the 404 a missing key gets", async () => {
    expect((await fetch(`${base}/v1/file-transfer/${BLOB_KEY}`)).status).toBe(404);
    const tampered = (await signedLink(BLOB_KEY)).replace("blob1", "blob2");
    expect((await fetch(tampered)).status).toBe(404);
    expect((await fetch(`${base}/v1/file-transfer/%E0%A4%A`)).status).toBe(404);
  });

  it.each([
    ["a staged upload's key", `files/staging/${HEX}`],
    ["a key outside the File store", "attachments/01x/notes.txt"],
    ["a key that escapes the root", "files/../../etc/passwd"],
    ["a key naming nothing", "files/org_01aaaaaaaaaaaaaaaaaaaaaaaa/absent"],
    ["a directory", "files/org_01aaaaaaaaaaaaaaaaaaaaaaaa"],
  ])("answers a signed link to %s with 404", async (_name, key) => {
    // Straight to the handler: a client's URL parser would fold the dot
    // segments before the lane saw them.
    const lane = newFileTransferLane({ slots, root, signer, logger: silentLogger });
    const query = signer.signedQuery(key, 60_000, "");
    const encoded = key.split("/").map((segment) => (segment === ".." ? "%2E%2E" : encodeURIComponent(segment)));
    expect((await laneAnswer(lane, "GET", `/v1/file-transfer/${encoded.join("/")}?${query}`)).status).toBe(404);
  });
});

describe("the lane's own edges", () => {
  it("answers a path outside its prefix with 404 when reached directly", async () => {
    const lane = newFileTransferLane({ slots, root, signer, logger: silentLogger });
    expect((await laneAnswer(lane, "GET", "/v1/elsewhere")).status).toBe(404);
  });

  it("logs a handler that fails after the router returned, never leaving an unhandled rejection", async () => {
    const error = vi.fn();
    const logger = { ...silentLogger, error } as Logger;
    const lane = newFileTransferLane({ slots, root, signer, logger });
    for (const [method, url] of [
      ["PUT", `/v1/file-transfer/uploads/${REF}`],
      ["GET", `/v1/file-transfer/${BLOB_KEY}`],
    ] as const) {
      const response = {
        setHeader: () => {
          throw new Error("client went away");
        },
        end: () => undefined,
        statusCode: 0,
      } as unknown as LaneResponse;
      lane({ method, url } as LaneRequest, response);
    }
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(2));
    expect(error).toHaveBeenCalledWith("file transfer lane upload handler failed", { error: "client went away" });
    expect(error).toHaveBeenCalledWith("file transfer lane download handler failed", { error: "client went away" });
  });
});

/** What the lane answers one in-memory request, once it has ended the response. */
function laneAnswer(
  lane: (request: LaneRequest, response: LaneResponse) => void,
  method: string,
  url: string,
): Promise<{ status: number }> {
  return new Promise((resolve) => {
    const response = {
      statusCode: 0,
      setHeader: () => undefined,
      end(this: { statusCode: number }) {
        resolve({ status: this.statusCode });
      },
    };
    lane({ method, url } as LaneRequest, response as unknown as LaneResponse);
  });
}
