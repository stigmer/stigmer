/**
 * Pins a turn's files (../message-files.ts) over the SQLite store and the
 * real local driver, the step run as the run create runs it once the
 * conversation exists:
 *   - a File of the organization the caller may view becomes the
 *     conversation's own copy, joins the conversation's resources under a
 *     unique mount path, and the run names the copy in file_ids and carries
 *     its block (image for an image type, document otherwise);
 *   - a File already the conversation's is used as it is and not added
 *     twice to the list;
 *   - a File of another organization, and one the caller may not view, are
 *     refused before anything is written;
 *   - the conversation's 500-file cap is held;
 *   - undoMessageFiles takes back the list's new entries and the copies.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SessionResourceSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { LocalArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import { testUrlSigner } from "../../../artifactstorage/__test-utils__/url-signer.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { newFileBlobs } from "../blobs.js";
import type { FileBlobs } from "../blobs.js";
import { newFileInstances } from "../instances.js";
import type { FileInstances } from "../instances.js";
import {
  MESSAGE_FILES_ADDED_KEY,
  newResolveMessageFilesStep,
  undoMessageFiles,
} from "../message-files.js";
import type { MessageFilesAdded } from "../message-files.js";

const ORG = "org_01aaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_ORG = "org_01bbbbbbbbbbbbbbbbbbbbbbbb";
const SESSION = "ses_01msgfilesmsgfilesmsgfil";
const CALLER = testCallerIdentity();

const allowing: Authorizer = { authorize: () => Promise.resolve({ kind: "allow" }) };
const denying: Authorizer = { authorize: () => Promise.resolve({ kind: "deny", reason: "" }) };

let fx: TempStore;
let root: string;
let blobs: FileBlobs;

beforeEach(async () => {
  fx = tempStore();
  root = mkdtempSync(path.join(tmpdir(), "message-files-"));
  const storage = new LocalArtifactStorage(root, "http://files.test", testUrlSigner());
  blobs = newFileBlobs({ store: fx.store, storage, logger: silentLogger, maxBytes: 1024 });
  await fx.store.saveResource(
    ApiResourceKind.session,
    SESSION,
    SessionSchema,
    create(SessionSchema, { metadata: { id: SESSION, org: ORG }, spec: {} }),
  );
});

afterEach(async () => {
  await fx.cleanup();
  rmSync(root, { recursive: true, force: true });
});

function instancesWith(authorizer: Authorizer): FileInstances {
  return newFileInstances({ store: fx.store, blobs, authorizer, lifecycle: undefined, logger: silentLogger });
}

async function seedFile(id: string, filename: string, mimeType: string, org = ORG, sessionId = ""): Promise<void> {
  const blob = await blobs.storeInline(org, new Uint8Array([1, 2]), "");
  await blobs.insertFile(
    id,
    FileSchema,
    create(FileSchema, {
      metadata: { id, org, name: filename },
      spec: { filename, mimeType },
      status: { sizeBytes: 2n, sessionId },
    }),
    blob,
  );
}

function runContext(fileIds: string[]): RequestContext<typeof RunSchema> {
  return new RequestContext(
    RunSchema,
    create(RunSchema, {
      metadata: { id: "run_01msgfiles", org: ORG },
      spec: { target: { case: "sessionId", value: SESSION }, message: "here", fileIds },
    }),
    CALLER,
    ApiResourceKind.run,
  );
}

async function sessionFiles(): Promise<Array<[string, string]>> {
  const session = await fx.store.getResource(ApiResourceKind.session, SESSION, SessionSchema);
  return (session.spec?.resources ?? []).flatMap((entry) =>
    entry.resource.case === "file" ? [[entry.resource.value.fileId, entry.resource.value.mountPath] as [string, string]] : [],
  );
}

async function run(ctx: RequestContext<typeof RunSchema>, instances: FileInstances): Promise<unknown> {
  return Promise.resolve(newResolveMessageFilesStep(fx.store, instances).execute(ctx)).catch((e: unknown) => e);
}

describe("a turn's files", () => {
  it("copies an organization File into the conversation, lists it, and records its block", async () => {
    await seedFile("file_01shot", "shot.png", "image/png");
    await seedFile("file_01brief", "brief.pdf", "application/pdf");
    const ctx = runContext(["file_01shot", "file_01brief"]);
    expect(await run(ctx, instancesWith(allowing))).toBeUndefined();

    const run_: Run = ctx.newState;
    const [shot, brief] = run_.spec?.fileIds ?? [];
    expect(shot).toMatch(/^file_/);
    expect(shot).not.toBe("file_01shot");
    expect(await sessionFiles()).toEqual([
      [shot, "shot.png"],
      [brief, "brief.pdf"],
    ]);
    expect(run_.status?.messageFiles.map((block) => [block.type, block.source?.type, block.source?.fileId])).toEqual([
      ["image", "file", shot],
      ["document", "file", brief],
    ]);
    expect((ctx.get(MESSAGE_FILES_ADDED_KEY) as MessageFilesAdded).fileIds).toEqual([shot, brief]);
  });

  it("uses the conversation's own File as it is and lists it once", async () => {
    await seedFile("file_01own", "own.txt", "text/plain", ORG, SESSION);
    const first = runContext(["file_01own"]);
    await run(first, instancesWith(allowing));
    const second = runContext(["file_01own"]);
    await run(second, instancesWith(allowing));
    expect(second.newState.spec?.fileIds).toEqual(["file_01own"]);
    expect(await sessionFiles()).toEqual([["file_01own", "own.txt"]]);
  });

  it("refuses another organization's File and one the caller may not view, writing nothing", async () => {
    await seedFile("file_01theirs", "theirs.txt", "text/plain", OTHER_ORG);
    const foreign = await run(runContext(["file_01theirs"]), instancesWith(allowing));
    expect((foreign as ConnectError).code).toBe(Code.FailedPrecondition);

    await seedFile("file_01private", "private.txt", "text/plain");
    const hidden = await run(runContext(["file_01private"]), instancesWith(denying));
    expect((hidden as ConnectError).code).toBe(Code.PermissionDenied);
    expect(await sessionFiles()).toEqual([]);
  });

  it("holds the conversation's 500-file cap", async () => {
    await fx.store.updateResource(ApiResourceKind.session, SESSION, SessionSchema, (row) => {
      row.spec!.resources = Array.from({ length: 500 }, (_, i) =>
        create(SessionResourceSchema, { resource: { case: "file", value: { fileId: `file_01held${i}`, mountPath: `f${i}` } } }),
      );
    });
    await seedFile("file_01extra", "extra.txt", "text/plain", ORG, SESSION);
    const refused = await run(runContext(["file_01extra"]), instancesWith(allowing));
    expect((refused as ConnectError).code).toBe(Code.InvalidArgument);
    expect((refused as ConnectError).rawMessage).toContain("at most 500 files");
  });

  it("is taken back by undoMessageFiles: the list's new entries and the copies go", async () => {
    await seedFile("file_01undo", "undo.txt", "text/plain");
    const instances = instancesWith(allowing);
    const ctx = runContext(["file_01undo"]);
    await run(ctx, instances);
    const [copy] = ctx.newState.spec?.fileIds ?? [];
    await undoMessageFiles(
      { store: fx.store, logger: silentLogger },
      ctx.get(MESSAGE_FILES_ADDED_KEY) as MessageFilesAdded,
      instances,
      CALLER,
    );
    expect(await sessionFiles()).toEqual([]);
    expect(await fx.store.files.blobKeyOf(copy ?? "")).toBeUndefined();
    expect(await fx.store.files.blobKeyOf("file_01undo")).toBeDefined();
  });

  it("does nothing for a message with no files", async () => {
    const ctx = runContext([]);
    expect(await run(ctx, instancesWith(denying))).toBeUndefined();
    expect(ctx.newState.status?.messageFiles ?? []).toEqual([]);
  });
});
