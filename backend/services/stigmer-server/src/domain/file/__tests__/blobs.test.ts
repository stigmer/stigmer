/**
 * Pins the File blob service (../blobs.ts) over the real local driver, its
 * real slot registry and the SQLite store, with an injected clock:
 *   - a staged upload is promoted by a copy inside the store: the driver's
 *     download is never called, the staging key is gone, and the new
 *     File's bytes are the uploaded ones; the reference promotes once;
 *   - a staged upload whose bytes differ in size from the declaration, or
 *     over the cap, is refused, and its bytes are swept after the lease;
 *   - bytes written for a File whose row never landed (a crash between the
 *     two) are swept once the lease lapses, row and bytes;
 *   - a blob two Files share goes only with the last of them;
 *   - an upload URL never used is swept after it expires;
 *   - a File's first bytes are read by range, never whole, and a driver
 *     without ranged reads gives the range of the whole;
 *   - an organization's purge leaves none of its blobs, bytes or rows, a
 *     page at a time, and touches no other organization's;
 *   - a reference this server could not have minted is unknown, and staged
 *     bytes of another size than declared, or over the cap, are refused;
 *   - every store or driver fault answers Internal, except two that are not
 *     the caller's to see: staged bytes that cannot be deleted after a
 *     promotion and an orphan that cannot be deleted after a remove are
 *     logged and left for the sweep, and a sweep that cannot list does
 *     nothing; a write that outlived its lease is refused as too slow.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import type { File } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { LocalArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import type { ArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import { testUrlSigner } from "../../../artifactstorage/__test-utils__/url-signer.js";
import type { Logger } from "../../../boot/logger.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { FileBlobUnavailableError } from "../../../store/file-blobs.js";
import type { FileBlobStore } from "../../../store/file-blobs.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { UploadSlots } from "../../skill/transfer/slots.js";
import { UPLOAD_REF_UNKNOWN, newFileBlobs, stagingKeyOf, uploadRefOf } from "../blobs.js";
import type { FileBlobs, NewBlob } from "../blobs.js";
import {
  BLOB_WRITE_LEASE_MS,
  STAGED_FILE_NAME,
  STAGING_KEY_PREFIX,
  UPLOAD_URL_TTL_MS,
} from "../constants.js";

const ORG = "org_01aaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_ORG = "org_01bbbbbbbbbbbbbbbbbbbbbbbb";
const MAX_BYTES = 64;

let fx: TempStore;
let root: string;
let nowMs: number;
let slots: UploadSlots;
let downloads: string[];
let storage: ArtifactStorage;
let blobs: FileBlobs;

/** The local driver, its download spied on: a promotion must never read bytes back. */
function spiedDriver(overrides: Partial<ArtifactStorage> = {}): ArtifactStorage {
  const local = new LocalArtifactStorage(root, "http://files.test/v1/file-transfer", testUrlSigner(() => nowMs), {
    reserve: (key, size) => ({ url: `http://files.test/uploads/${uploadRefOf(key)}`, ...slots.reserve(key, size) }),
  });
  return {
    upload: (key, data, type) => local.upload(key, data, type),
    download: (key) => {
      downloads.push(key);
      return local.download(key);
    },
    size: (key) => local.size(key),
    readRange: (key, offset, length) => local.readRange(key, offset, length),
    getSignedUrl: (key, ttl, name, reader) => local.getSignedUrl(key, ttl, name, reader),
    presignPut: (key, size, ttl, reader) => local.presignPut(key, size, ttl, reader),
    copy: (from, to) => local.copy(from, to),
    delete: (key) => local.delete(key),
    exists: (key) => local.exists(key),
    health: () => local.health(),
    ...overrides,
  };
}

/** The store, its blob door's methods replaced by `overrides`. */
function storeWithFiles(overrides: Partial<FileBlobStore>): Store {
  const files = new Proxy(fx.store.files, {
    get: (target, key) => {
      const override = overrides[key as keyof FileBlobStore];
      if (override !== undefined) return override;
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new Proxy(fx.store, {
    get: (target, key) => (key === "files" ? files : Reflect.get(target, key)),
  });
}

/** Blobs over the test store and the spied local driver, with some of either replaced. */
function blobsWith(options: { files?: Partial<FileBlobStore>; storage?: Partial<ArtifactStorage>; logger?: Logger }): FileBlobs {
  return newFileBlobs({
    store: storeWithFiles(options.files ?? {}),
    storage: spiedDriver(options.storage),
    logger: options.logger ?? silentLogger,
    maxBytes: MAX_BYTES,
    now: () => nowMs,
  });
}

const boom = (): Promise<never> => Promise.reject(new Error("boom"));

function fileRow(id: string, org = ORG): File {
  return create(FileSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "File",
    metadata: { id, org, name: "report.pdf" },
    spec: { filename: "report.pdf", mimeType: "application/pdf" },
  });
}

async function insert(id: string, blob: NewBlob): Promise<void> {
  await blobs.insertFile(id, FileSchema, fileRow(id, blob.org), blob);
}

/** Puts `bytes` to the slot a minted reference names, as the transfer lane would. */
async function putStaged(ref: string, bytes: Uint8Array): Promise<void> {
  const key = stagingKeyOf(ref);
  if (key === undefined) throw new Error(`bad ref ${ref}`);
  await slots.receive(key, Readable.from([Buffer.from(bytes)]));
}

function onDisk(key: string): boolean {
  return existsSync(path.join(root, key));
}

async function codeOf(op: () => Promise<unknown>): Promise<Code> {
  const error = await op().then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConnectError);
  return (error as ConnectError).code;
}

beforeEach(() => {
  fx = tempStore();
  root = mkdtempSync(path.join(tmpdir(), "file-blobs-"));
  nowMs = Date.UTC(2026, 9, 19, 12, 0, 0);
  slots = new UploadSlots(root, STAGING_KEY_PREFIX, UPLOAD_URL_TTL_MS, MAX_BYTES, () => nowMs, STAGED_FILE_NAME);
  downloads = [];
  storage = spiedDriver();
  blobs = newFileBlobs({ store: fx.store, storage, logger: silentLogger, maxBytes: MAX_BYTES, now: () => nowMs });
});

afterEach(async () => {
  await fx.cleanup();
  rmSync(root, { recursive: true, force: true });
});

describe("promoting a staged upload", () => {
  it("copies inside the store: no read-back, the staging key gone, the File's bytes the uploaded ones", async () => {
    const minted = await blobs.mintUpload(ORG, 5, "person");
    await putStaged(minted.ref, new TextEncoder().encode("hello"));
    const blob = await blobs.promote(ORG, minted.ref);
    await insert("file_01a", blob);

    expect(downloads).toEqual([]);
    expect(onDisk(stagingKeyOf(minted.ref) ?? "")).toBe(false);
    expect(blob.blobKey.startsWith(`files/${ORG}/`)).toBe(true);
    expect(blob.sizeBytes).toBe(5);
    expect(Buffer.from(await storage.download(blob.blobKey)).toString()).toBe("hello");
    expect(await fx.store.files.blobKeyOf("file_01a")).toBe(blob.blobKey);
  });

  it("promotes a reference once, and refuses one of another organization or never minted", async () => {
    const minted = await blobs.mintUpload(ORG, 3, "person");
    await putStaged(minted.ref, new Uint8Array([1, 2, 3]));
    expect(await codeOf(() => blobs.promote(OTHER_ORG, minted.ref))).toBe(Code.FailedPrecondition);
    await blobs.promote(ORG, minted.ref);
    expect(await codeOf(() => blobs.promote(ORG, minted.ref))).toBe(Code.FailedPrecondition);
    expect(await codeOf(() => blobs.promote(ORG, "fup_nothex"))).toBe(Code.FailedPrecondition);
  });

  it("refuses a reference whose bytes never arrived, and sweeps the staged row after the lease", async () => {
    const minted = await blobs.mintUpload(ORG, 3, "person");
    expect(await codeOf(() => blobs.promote(ORG, minted.ref))).toBe(Code.FailedPrecondition);
    nowMs += BLOB_WRITE_LEASE_MS + 1000;
    await blobs.sweep();
    expect(await fx.store.files.getBlob(stagingKeyOf(minted.ref) ?? "")).toBeUndefined();
  });
});

describe("reading a File's first bytes", () => {
  it("reads only the range asked, and from a driver without ranged reads takes the range of the whole", async () => {
    const bytes = new TextEncoder().encode("0123456789");
    const blob = await blobs.storeInline(ORG, bytes, "text/plain");
    await insert("file_01head", blob);
    expect(new TextDecoder().decode(await blobs.readHead("file_01head", 4))).toBe("0123");
    expect(downloads, "a ranged read loads nothing whole").toEqual([]);

    const plain = blobsWith({ storage: { readRange: undefined } });
    expect(new TextDecoder().decode(await plain.readHead("file_01head", 4))).toBe("0123");
    expect(downloads).toEqual([blob.blobKey]);
  });

  it("answers Internal when the File's storage cannot be read or names no blob", async () => {
    const blob = await blobs.storeInline(ORG, new TextEncoder().encode("x"), "text/plain");
    await insert("file_01headfault", blob);
    for (const failing of [
      blobsWith({ files: { blobKeyOf: boom } }),
      blobsWith({ storage: { readRange: boom } }),
    ]) {
      await expect(failing.readHead("file_01headfault", 4)).rejects.toMatchObject({ code: Code.Internal });
    }
    await expect(blobs.readHead("file_01nostoredblobnostored", 4)).rejects.toMatchObject({ code: Code.Internal });
  });
});

describe("the size cap", () => {
  it("refuses an upload URL and an inline upload over the cap, before any byte is stored", async () => {
    expect(await codeOf(() => blobs.mintUpload(ORG, MAX_BYTES + 1, "person"))).toBe(Code.InvalidArgument);
    expect(await codeOf(() => blobs.storeInline(ORG, new Uint8Array(MAX_BYTES + 1), ""))).toBe(Code.InvalidArgument);
    expect(await fx.store.files.listBlobKeysByOrg(ORG, "", 10)).toEqual([]);
  });
});

describe("blobs nobody names", () => {
  it("sweeps a new File's bytes whose row never landed, once the lease lapses", async () => {
    const blob = await blobs.storeInline(ORG, new Uint8Array([9]), "");
    expect(onDisk(blob.blobKey)).toBe(true);
    await blobs.sweep();
    expect(onDisk(blob.blobKey)).toBe(true);

    nowMs += BLOB_WRITE_LEASE_MS + 1000;
    expect(await blobs.sweep()).toBe(1);
    expect(onDisk(blob.blobKey)).toBe(false);
    expect(await fx.store.files.getBlob(blob.blobKey)).toBeUndefined();
  });

  it("sweeps an upload URL nobody used once it expires", async () => {
    const minted = await blobs.mintUpload(ORG, 4, "person");
    await putStaged(minted.ref, new Uint8Array([1, 2, 3, 4]));
    nowMs += UPLOAD_URL_TTL_MS + 1000;
    expect(await blobs.sweep()).toBe(1);
    expect(onDisk(stagingKeyOf(minted.ref) ?? "")).toBe(false);
  });

  it("keeps a blob two Files share until the last of them is removed", async () => {
    const blob = await blobs.storeInline(ORG, new Uint8Array([7, 7]), "");
    await insert("file_01a", blob);
    await insert("file_01b", blob);

    await blobs.removeFile("file_01a");
    expect(onDisk(blob.blobKey)).toBe(true);
    await expect(fx.store.getResource(ApiResourceKind.file, "file_01a", FileSchema)).rejects.toThrow(
      ResourceNotFoundError,
    );

    await blobs.removeFile("file_01b");
    expect(onDisk(blob.blobKey)).toBe(false);
    expect(await fx.store.files.getBlob(blob.blobKey)).toBeUndefined();
  });
});

describe("an organization's purge", () => {
  it("leaves none of its blobs, bytes or rows, and keeps another organization's", async () => {
    const stored = await blobs.storeInline(ORG, new Uint8Array([1]), "");
    await insert("file_01a", stored);
    await fx.store.files.remove(ApiResourceKind.file, "file_01a");
    const minted = await blobs.mintUpload(ORG, 1, "person");
    await putStaged(minted.ref, new Uint8Array([2]));
    const kept = await blobs.storeInline(OTHER_ORG, new Uint8Array([3]), "");
    await insert("file_01other", kept);

    expect(await blobs.holdsAny(ORG)).toBe(true);
    await blobs.purgeOrganization(ORG);

    expect(await blobs.holdsAny(ORG)).toBe(false);
    expect(onDisk(stored.blobKey)).toBe(false);
    expect(onDisk(stagingKeyOf(minted.ref) ?? "")).toBe(false);
    expect(onDisk(kept.blobKey)).toBe(true);
    expect(await blobs.holdsAny(OTHER_ORG)).toBe(true);
  });
});

describe("references", () => {
  it("read only a reference this server could have minted, and name only a staging key it minted", () => {
    expect(stagingKeyOf(`fup_${"ab".repeat(16)}`)).toBe(`files/staging/${"ab".repeat(16)}`);
    expect(stagingKeyOf(`sau_${"ab".repeat(16)}`)).toBeUndefined();
    expect(stagingKeyOf("fup_ABCD")).toBeUndefined();
    expect(uploadRefOf(`files/staging/${"cd".repeat(16)}`)).toBe(`fup_${"cd".repeat(16)}`);
    expect(() => uploadRefOf("skills/staging/x.zip")).toThrow("not a staging key the File domain minted");
  });

  it("answers a reference this server could not have minted as unknown", async () => {
    const error = await blobs.promote(ORG, `sau_${"ab".repeat(16)}`).catch((e: unknown) => e);
    expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((error as ConnectError).rawMessage).toBe(UPLOAD_REF_UNKNOWN);
  });
});

describe("a staged upload that is not what was declared", () => {
  it("refuses bytes of another size than the declaration", async () => {
    const minted = await blobs.mintUpload(ORG, 5, "person");
    await storage.upload(stagingKeyOf(minted.ref) ?? "", new Uint8Array(3), "");
    const error = await blobs.promote(ORG, minted.ref).catch((e: unknown) => e);
    expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((error as ConnectError).rawMessage).toContain("is 3 bytes, not the 5 bytes");
  });

  it("refuses a declaration over the cap at promotion too", async () => {
    const key = `files/staging/${"ee".repeat(16)}`;
    await fx.store.files.recordBlob({
      blobKey: key,
      org: ORG,
      state: "staged",
      sizeBytes: MAX_BYTES + 1,
      expiresAt: Math.floor(nowMs / 1000) + 60,
    });
    await storage.upload(key, new Uint8Array(MAX_BYTES + 1), "");
    expect(await codeOf(() => blobs.promote(ORG, uploadRefOf(key)))).toBe(Code.InvalidArgument);
  });
});

describe("faults", () => {
  it.each([
    ["recording the blob", () => blobsWith({ files: { recordBlob: boom } }).storeInline(ORG, new Uint8Array([1]), "")],
    ["writing inline bytes", () => blobsWith({ storage: { upload: boom } }).storeInline(ORG, new Uint8Array([1]), "")],
    ["minting an upload URL", () => blobsWith({ storage: { presignPut: boom } }).mintUpload(ORG, 1, "person")],
    ["claiming a staged upload", () => blobsWith({ files: { claimStaged: boom } }).promote(ORG, `fup_${"ab".repeat(16)}`)],
    ["removing a File", () => blobsWith({ files: { remove: boom } }).removeFile("file_01a")],
    ["reading a File's blob", () => blobsWith({ files: { blobKeyOf: boom } }).downloadUrl("file_01a", "a.txt")],
  ])("answers a store or driver fault while %s as Internal", async (_name, op) => {
    expect(await codeOf(op)).toBe(Code.Internal);
  });

  it("answers Internal when the staged bytes cannot be read or copied", async () => {
    const minted = await blobs.mintUpload(ORG, 2, "person");
    await putStaged(minted.ref, new Uint8Array([1, 2]));
    expect(await codeOf(() => blobsWith({ storage: { size: boom } }).promote(ORG, minted.ref))).toBe(Code.Internal);

    const second = await blobs.mintUpload(ORG, 2, "person");
    await putStaged(second.ref, new Uint8Array([1, 2]));
    expect(await codeOf(() => blobsWith({ storage: { copy: boom } }).promote(ORG, second.ref))).toBe(Code.Internal);
  });

  it("promotes when the staged bytes cannot be deleted, logging them for the sweep", async () => {
    const warn = vi.fn();
    const minted = await blobs.mintUpload(ORG, 2, "person");
    await putStaged(minted.ref, new Uint8Array([1, 2]));
    const blob = await blobsWith({ storage: { delete: boom }, logger: { ...silentLogger, warn } as Logger }).promote(
      ORG,
      minted.ref,
    );
    expect(blob.sizeBytes).toBe(2);
    expect(warn).toHaveBeenCalledWith("staged file delete failed; the next sweep retries it", expect.anything());
  });

  it("refuses a File whose write outlived its lease, and answers any other insert fault as Internal", async () => {
    const blob = await blobs.storeInline(ORG, new Uint8Array([1]), "");
    nowMs += BLOB_WRITE_LEASE_MS + 1000;
    const late = await blobs.insertFile("file_01late", FileSchema, fileRow("file_01late"), blob).catch((e: unknown) => e);
    expect((late as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((late as ConnectError).rawMessage).toContain("took too long");

    const failing = blobsWith({ files: { insert: () => Promise.reject(new FileBlobUnavailableError("k", "x")) } });
    expect(await codeOf(() => failing.insertFile("file_01x", FileSchema, fileRow("file_01x"), blob))).toBe(
      Code.FailedPrecondition,
    );
    expect(await codeOf(() => blobsWith({ files: { insert: boom } }).insertFile("file_01y", FileSchema, fileRow("file_01y"), blob))).toBe(
      Code.Internal,
    );
  });

  it("answers an id already held as Internal: the server minted it", async () => {
    const blob = await blobs.storeInline(ORG, new Uint8Array([1]), "");
    await insert("file_01twice", blob);
    expect(await codeOf(() => blobs.insertFile("file_01twice", FileSchema, fileRow("file_01twice"), blob))).toBe(
      Code.Internal,
    );
  });

  it("keeps an orphan's row when its bytes cannot be deleted, so the sweep retries it", async () => {
    const warn = vi.fn();
    const blob = await blobs.storeInline(ORG, new Uint8Array([4]), "");
    await insert("file_01keep", blob);
    await blobsWith({ storage: { delete: boom }, logger: { ...silentLogger, warn } as Logger }).removeFile("file_01keep");
    expect(warn).toHaveBeenCalledWith("file blob delete failed; the next sweep retries it", expect.anything());
    expect((await fx.store.files.getBlob(blob.blobKey))?.state).toBe("orphaned");
    expect(await blobs.sweep()).toBe(1);
    expect(onDisk(blob.blobKey)).toBe(false);
  });

  it("sweeps nothing, and fails nothing, when the store cannot list expired blobs", async () => {
    const warn = vi.fn();
    const failing = blobsWith({ files: { listSweepable: boom }, logger: { ...silentLogger, warn } as Logger });
    expect(await failing.sweep()).toBe(0);
    expect(warn).toHaveBeenCalledWith("file blob sweep could not list expired blobs", { error: "boom" });
  });
});

describe("download links", () => {
  it("signs a person's link for an hour, and answers a File with no blob or a signing fault as Internal", async () => {
    const blob = await blobs.storeInline(ORG, new Uint8Array([1]), "");
    await insert("file_01link", blob);
    const link = await blobs.downloadUrl("file_01link", "report.pdf");
    expect(link.url.startsWith(`http://files.test/v1/file-transfer/${blob.blobKey}?`)).toBe(true);
    expect(link.expiresAtMs).toBe(nowMs + 60 * 60 * 1000);

    expect(await codeOf(() => blobs.downloadUrl("file_01none", "x"))).toBe(Code.Internal);
    expect(await codeOf(() => blobsWith({ storage: { getSignedUrl: boom } }).downloadUrl("file_01link", "x"))).toBe(
      Code.Internal,
    );
  });
});

describe("a purge of many blobs", () => {
  it("pages through every blob of the organization", async () => {
    for (let i = 0; i < 205; i++) {
      await fx.store.files.recordBlob({
        blobKey: `files/${ORG}/${String(i).padStart(4, "0")}`,
        org: ORG,
        state: "orphaned",
        sizeBytes: 0,
        expiresAt: 0,
      });
    }
    await blobs.purgeOrganization(ORG);
    expect(await blobs.holdsAny(ORG)).toBe(false);
  });
});
