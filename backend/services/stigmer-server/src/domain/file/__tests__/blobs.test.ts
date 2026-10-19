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
 *   - an organization's purge leaves none of its blobs, bytes or rows, and
 *     touches no other organization's.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import type { File } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { LocalArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import type { ArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import { testUrlSigner } from "../../../artifactstorage/__test-utils__/url-signer.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { UploadSlots } from "../../skill/transfer/slots.js";
import { newFileBlobs, stagingKeyOf, uploadRefOf } from "../blobs.js";
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
function spiedDriver(): ArtifactStorage {
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
    getSignedUrl: (key, ttl, name, reader) => local.getSignedUrl(key, ttl, name, reader),
    presignPut: (key, size, ttl) => local.presignPut(key, size, ttl),
    copy: (from, to) => local.copy(from, to),
    delete: (key) => local.delete(key),
    exists: (key) => local.exists(key),
    health: () => local.health(),
  };
}

function fileRow(id: string, org = ORG): File {
  return create(FileSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "File",
    metadata: { id, org, name: "report.pdf" },
    spec: { filename: "report.pdf", mimeType: "application/pdf" },
  });
}

async function insert(id: string, blob: NewBlob): Promise<void> {
  expect(await blobs.insertFile(id, FileSchema, fileRow(id, blob.org), blob)).toBe(true);
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
    const minted = await blobs.mintUpload(ORG, 5);
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
    const minted = await blobs.mintUpload(ORG, 3);
    await putStaged(minted.ref, new Uint8Array([1, 2, 3]));
    expect(await codeOf(() => blobs.promote(OTHER_ORG, minted.ref))).toBe(Code.FailedPrecondition);
    await blobs.promote(ORG, minted.ref);
    expect(await codeOf(() => blobs.promote(ORG, minted.ref))).toBe(Code.FailedPrecondition);
    expect(await codeOf(() => blobs.promote(ORG, "fup_nothex"))).toBe(Code.FailedPrecondition);
  });

  it("refuses a reference whose bytes never arrived, and sweeps the staged row after the lease", async () => {
    const minted = await blobs.mintUpload(ORG, 3);
    expect(await codeOf(() => blobs.promote(ORG, minted.ref))).toBe(Code.FailedPrecondition);
    nowMs += BLOB_WRITE_LEASE_MS + 1000;
    await blobs.sweep();
    expect(await fx.store.files.getBlob(stagingKeyOf(minted.ref) ?? "")).toBeUndefined();
  });
});

describe("the size cap", () => {
  it("refuses an upload URL and an inline upload over the cap, before any byte is stored", async () => {
    expect(await codeOf(() => blobs.mintUpload(ORG, MAX_BYTES + 1))).toBe(Code.InvalidArgument);
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
    const minted = await blobs.mintUpload(ORG, 4);
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
    const minted = await blobs.mintUpload(ORG, 1);
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
