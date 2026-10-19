/**
 * Pins the File's organization purge (../purge.ts) and the faults its
 * neighbours turn into Internal, over the SQLite store and the real local
 * driver:
 *   - a purge removes the organization's Files a batch at a time, says
 *     whether more are left, and once none is left removes every blob the
 *     organization still holds (an upload URL nobody used included), so
 *     the census finds nothing; another organization's Files stay;
 *   - a store fault while authorizing an upload into a conversation, while
 *     a conversation's delete lists its Files, and while updateVisibility
 *     loads or saves a File answers Internal; a File deleted between that
 *     load and save answers NOT_FOUND.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { FileCommandController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/command_pb";
import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import { SessionIdSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { UpdateVisibilityInputSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";

import { LocalArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import { testUrlSigner } from "../../../artifactstorage/__test-utils__/url-signer.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { RESOURCE_ID_KEY } from "../../../pipeline/steps/delete.js";
import type { Store } from "../../../store/interface.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { newFileBlobs } from "../blobs.js";
import type { FileBlobs } from "../blobs.js";
import {
  UPDATE_VISIBILITY_FILE_KEY,
  newLoadFileForVisibilityUpdateStep,
  newPersistFileVisibilityStep,
} from "../controller.js";
import { newFilePurge } from "../purge.js";
import { newCascadeDeleteSessionFilesStep } from "../session-files.js";
import { authorizeFileUpload } from "../steps.js";

const ORG = "org_01aaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_ORG = "org_01bbbbbbbbbbbbbbbbbbbbbbbb";
const CALLER: CallerIdentity = { callerClass: "internal" } as CallerIdentity;

let fx: TempStore;
let root: string;
let blobs: FileBlobs;

beforeEach(() => {
  fx = tempStore();
  root = mkdtempSync(path.join(tmpdir(), "file-purge-"));
  const storage = new LocalArtifactStorage(root, "http://files.test", testUrlSigner());
  blobs = newFileBlobs({ store: fx.store, storage, logger: silentLogger, maxBytes: 1024 });
});

afterEach(async () => {
  await fx.cleanup();
  rmSync(root, { recursive: true, force: true });
});

async function upload(id: string, org = ORG): Promise<void> {
  const blob = await blobs.storeInline(org, new Uint8Array([1]), "");
  await blobs.insertFile(
    id,
    FileSchema,
    create(FileSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "File",
      metadata: { id, org, name: "a.txt" },
      spec: { filename: "a.txt" },
    }),
    blob,
  );
}

/** A store whose one read faults, everything else its own. */
function faulting(store: Store, method: "getResource" | "queryResources"): Store {
  return new Proxy(store, {
    get: (target, key) =>
      key === method ? () => Promise.reject(new Error("store down")) : Reflect.get(target, key),
  });
}

describe("the File purge", () => {
  it("removes the organization's Files a batch at a time, then every blob it still holds", async () => {
    await upload("file_01a");
    await upload("file_01b");
    await upload("file_01other", OTHER_ORG);
    // An upload URL nobody used: its staged row outlives every File.
    await fx.store.files.recordBlob({
      blobKey: `files/staging/${"ab".repeat(16)}`,
      org: ORG,
      state: "staged",
      sizeBytes: 10,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    const purge = newFilePurge({
      store: fx.store,
      logger: silentLogger,
      grantPath: { cleanupResource: () => Promise.resolve() },
      authorizationLifecycle: undefined,
      fileBlobs: blobs,
    });
    const target = { id: ORG, parentOrg: "" };
    expect(purge.kind).toBe(ApiResourceKind.file);
    expect(await purge.holdsAny(target)).toBe(true);

    expect(await purge.purge(target, CALLER, 1)).toEqual({ more: true });
    expect(await purge.purge(target, CALLER, 10)).toEqual({ more: false });

    expect(await purge.holdsAny(target)).toBe(false);
    expect(await blobs.holdsAny(OTHER_ORG)).toBe(true);
    await expect(fx.store.getResource(ApiResourceKind.file, "file_01other", FileSchema)).resolves.toBeDefined();
  });
});

describe("store faults", () => {
  function visibilityContext(): RequestContext<typeof FileCommandController.method.updateVisibility.input> {
    return new RequestContext(
      FileCommandController.method.updateVisibility.input,
      create(UpdateVisibilityInputSchema, { resourceId: "file_01v", visibility: ApiResourceVisibility.visibility_org }),
      CALLER,
      ApiResourceKind.file,
    );
  }

  it("answers a fault loading a File for updateVisibility as Internal", async () => {
    const step = newLoadFileForVisibilityUpdateStep(faulting(fx.store, "getResource"));
    const error = await Promise.resolve(step.execute(visibilityContext())).catch((e: unknown) => e);
    expect((error as ConnectError).code).toBe(Code.Internal);
  });

  it("answers a File deleted before updateVisibility saves NOT_FOUND, and a save fault Internal", async () => {
    const ctx = visibilityContext();
    ctx.set(UPDATE_VISIBILITY_FILE_KEY, create(FileSchema, { metadata: { id: "file_01gone", org: ORG } }));
    const gone = await Promise.resolve(newPersistFileVisibilityStep(fx.store).execute(ctx)).catch((e: unknown) => e);
    expect((gone as ConnectError).code).toBe(Code.NotFound);

    const failing = new Proxy(fx.store, {
      get: (target, key) =>
        key === "updateResource" ? () => Promise.reject(new Error("store down")) : Reflect.get(target, key),
    });
    const fault = await Promise.resolve(newPersistFileVisibilityStep(failing).execute(ctx)).catch((e: unknown) => e);
    expect((fault as ConnectError).code).toBe(Code.Internal);
  });

  it("answers a fault reading the conversation an upload names as Internal", async () => {
    const allowing: Authorizer = { authorize: () => Promise.resolve({ kind: "allow" }) } as unknown as Authorizer;
    const error = await authorizeFileUpload(
      {
        store: faulting(fx.store, "getResource"),
        authorizer: allowing,
        credentialBinding: { admitsOrganization: () => Promise.resolve(true) },
      },
      { callerClass: "user", subject: "u" } as unknown as CallerIdentity,
      ORG,
      "ses_01aaaaaaaaaaaaaaaaaaaaaaaa",
    ).catch((e: unknown) => e);
    expect((error as ConnectError).code).toBe(Code.Internal);
  });

  it("answers a fault listing a conversation's Files as Internal", async () => {
    const step = newCascadeDeleteSessionFilesStep(faulting(fx.store, "queryResources"), blobs, undefined, silentLogger);
    const ctx = new RequestContext(
      SessionCommandController.method.delete.input,
      create(SessionIdSchema, { value: "ses_01x" }),
      CALLER,
      ApiResourceKind.session,
    );
    ctx.set(RESOURCE_ID_KEY, "ses_01x");
    const error = await Promise.resolve(step.execute(ctx)).catch((e: unknown) => e);
    expect((error as ConnectError).code).toBe(Code.Internal);
  });
});
