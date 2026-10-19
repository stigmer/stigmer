/**
 * Pins PersistUploadedFile (../steps.ts), the upload chain's store write,
 * over the SQLite store and the real local driver:
 *   - a File of a conversation that no longer exists is taken back, row
 *     and bytes, and the upload answers NOT_FOUND naming the conversation;
 *   - a store fault reading the conversation answers Internal;
 *   - the insert's own refusal (a write that outlived its lease) reaches
 *     the caller as FAILED_PRECONDITION, not Internal;
 *   - a File of no conversation is stored without reading one.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { LocalArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import { testUrlSigner } from "../../../artifactstorage/__test-utils__/url-signer.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import type { Store } from "../../../store/interface.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { newFileBlobs } from "../blobs.js";
import type { FileBlobs } from "../blobs.js";
import { BLOB_WRITE_LEASE_MS } from "../constants.js";
import { newPersistUploadedFileStep } from "../steps.js";

const ORG = "org_01aaaaaaaaaaaaaaaaaaaaaaaa";
const CALLER = { callerClass: "internal" } as CallerIdentity;
const admits = { admitsOrganization: () => Promise.resolve(true) };

let fx: TempStore;
let root: string;
let nowMs: number;
let blobs: FileBlobs;

beforeEach(() => {
  fx = tempStore();
  root = mkdtempSync(path.join(tmpdir(), "persist-uploaded-file-"));
  nowMs = Date.UTC(2026, 9, 19, 12, 0, 0);
  const storage = new LocalArtifactStorage(root, "http://files.test", testUrlSigner());
  blobs = newFileBlobs({ store: fx.store, storage, logger: silentLogger, maxBytes: 1024, now: () => nowMs });
});

afterEach(async () => {
  await fx.cleanup();
  rmSync(root, { recursive: true, force: true });
});

function contextFor(id: string): RequestContext<typeof FileSchema> {
  return new RequestContext(
    FileSchema,
    create(FileSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "File",
      metadata: { id, org: ORG, name: "a.txt" },
      spec: { filename: "a.txt" },
    }),
    CALLER,
    ApiResourceKind.file,
  );
}

async function run(store: Store, id: string, sessionId: string): Promise<unknown> {
  const blob = await blobs.storeInline(ORG, new Uint8Array([1]), "");
  const step = newPersistUploadedFileStep({ store, credentialBinding: admits, blobs }, blob, sessionId);
  return Promise.resolve(step.execute(contextFor(id))).then(
    () => blob,
    (e: unknown) => e,
  );
}

describe("PersistUploadedFile", () => {
  it("takes back the File of a conversation that is gone, and answers NOT_FOUND", async () => {
    const error = await run(fx.store, "file_01gone", "ses_01aaaaaaaaaaaaaaaaaaaaaaaa");
    expect((error as ConnectError).code).toBe(Code.NotFound);
    expect((error as ConnectError).rawMessage).toContain("ses_01aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(await fx.store.files.blobKeyOf("file_01gone")).toBeUndefined();
    expect(existsSync(path.join(root, "files", ORG))).toBe(false);
  });

  it("answers a fault reading the conversation as Internal", async () => {
    const failing = new Proxy(fx.store, {
      get: (target, key) =>
        key === "getResource" ? () => Promise.reject(new Error("store down")) : Reflect.get(target, key),
    });
    expect(((await run(failing, "file_01fault", "ses_01x")) as ConnectError).code).toBe(Code.Internal);
  });

  it("passes the insert's refusal to the caller as it is", async () => {
    const blob = await blobs.storeInline(ORG, new Uint8Array([1]), "");
    nowMs += BLOB_WRITE_LEASE_MS + 1000;
    const step = newPersistUploadedFileStep({ store: fx.store, credentialBinding: admits, blobs }, blob, "");
    const error = await Promise.resolve(step.execute(contextFor("file_01late"))).catch((e: unknown) => e);
    expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
  });

  it("stores a File of no conversation without reading one", async () => {
    const result = await run(fx.store, "file_01own", "");
    expect(result).not.toBeInstanceOf(ConnectError);
    expect(await fx.store.files.blobKeyOf("file_01own")).toBeDefined();
  });
});
