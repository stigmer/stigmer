/**
 * Pins the boot pass that turns stored attachments into Files
 * (../convert-attachments.ts) over the SQLite store and the real local
 * driver, the conversion rows seeded as the store's migration leaves them:
 *   - each attachment becomes a File of its run's conversation over the
 *     bytes at its key, with their real size, owned by the run's creator,
 *     its access written as a create's is, and the run's message_files
 *     gains its block; the row goes;
 *   - a second pass over the same row converges: one File, one block, its
 *     access written again;
 *   - an attachment whose bytes are gone, whose run is gone, or whose run
 *     is in no conversation is skipped and its row forgotten;
 *   - a storage fault stops the pass with the row kept;
 *   - a converted File's id is derived from its run and position, shaped
 *     as a minted one.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import { LocalArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import { testUrlSigner } from "../../../artifactstorage/__test-utils__/url-signer.js";
import type { ResourceAuthorizationLifecycle, ResourceCreatedEvent } from "../../../extensions/resource-authorization.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import type { AttachmentConversion } from "../../../store/file-blobs.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { convertStoredAttachments, convertedFileId } from "../convert-attachments.js";

const ORG = "org_01aaaaaaaaaaaaaaaaaaaaaaaa";
const SESSION = "ses_01convertconvertconvert";
const CREATOR = "acc_01creatorcreatorcreatorc";

let fx: TempStore;
let root: string;
let storage: LocalArtifactStorage;
let created: ResourceCreatedEvent[];

const lifecycle: ResourceAuthorizationLifecycle = {
  onResourceCreated: (event) => {
    created.push(event);
    return Promise.resolve();
  },
  onResourceDeleted: () => Promise.resolve(),
  onVisibilityChanged: () => Promise.resolve(),
};

beforeEach(() => {
  fx = tempStore();
  root = mkdtempSync(path.join(tmpdir(), "convert-attachments-"));
  storage = new LocalArtifactStorage(root, "http://files.test", testUrlSigner());
  created = [];
});

afterEach(async () => {
  await fx.cleanup();
  rmSync(root, { recursive: true, force: true });
});

function seedConversion(conversion: Partial<AttachmentConversion> & Pick<AttachmentConversion, "runId">): void {
  const row: AttachmentConversion = {
    position: 0,
    org: ORG,
    sessionId: SESSION,
    filename: "brief.pdf",
    storageKey: `attachments/01key/${conversion.filename ?? "brief.pdf"}`,
    contentType: "",
    createdAt: "2026-10-01T08:30:00.000000000Z",
    ...conversion,
  };
  const db = new DatabaseSync(fx.dbPath);
  try {
    db.prepare(
      `INSERT INTO file_conversions
         (run_id, position, org, session_id, filename, storage_key, content_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.runId, row.position, row.org, row.sessionId, row.filename, row.storageKey, row.contentType, row.createdAt);
  } finally {
    db.close();
  }
}

async function seedRun(runId: string): Promise<void> {
  await fx.store.saveResource(
    ApiResourceKind.run,
    runId,
    RunSchema,
    create(RunSchema, {
      metadata: { id: runId, org: ORG },
      spec: { target: { case: "sessionId", value: SESSION }, message: "see the brief" },
      status: { audit: { specAudit: { createdBy: { id: CREATOR } } } },
    }),
  );
}

async function conversionCount(): Promise<number> {
  return (await fx.store.files.listConversions(100)).length;
}

function convert(over: Partial<{ storage: ArtifactStorage }> = {}): Promise<number> {
  return convertStoredAttachments({ store: fx.store, storage: over.storage ?? storage, lifecycle, logger: silentLogger });
}

describe("converting stored attachments", () => {
  it("makes each a File of the run's conversation over its bytes, owned by the run's creator, and records its block", async () => {
    await storage.upload("attachments/01key/brief.pdf", new TextEncoder().encode("%PDF-1"), "application/pdf");
    await storage.upload("attachments/01key/shot.png", new Uint8Array([137, 80, 78, 71]), "image/png");
    await seedRun("run_01convert");
    seedConversion({ runId: "run_01convert" });
    seedConversion({ runId: "run_01convert", position: 1, filename: "shot.png" });

    expect(await convert()).toBe(2);

    const briefId = convertedFileId("run_01convert", 0);
    const shotId = convertedFileId("run_01convert", 1);
    const brief = await fx.store.getResource(ApiResourceKind.file, briefId, FileSchema);
    expect([brief.spec?.filename, brief.spec?.mimeType, brief.status?.sizeBytes, brief.status?.sessionId]).toEqual([
      "brief.pdf",
      "application/pdf",
      6n,
      SESSION,
    ]);
    expect(brief.status?.audit?.specAudit?.createdBy?.id).toBe(CREATOR);
    expect(await fx.store.files.blobKeyOf(briefId)).toBe("attachments/01key/brief.pdf");
    expect((await fx.store.files.getBlob("attachments/01key/brief.pdf"))?.state).toBe("stored");

    const run = await fx.store.getResource(ApiResourceKind.run, "run_01convert", RunSchema);
    expect(run.status?.messageFiles.map((block) => [block.type, block.source?.fileId])).toEqual([
      ["document", briefId],
      ["image", shotId],
    ]);
    expect(created.map((event) => [event.kind, event.resourceId, event.caller.identityId])).toEqual([
      [ApiResourceKind.file, briefId, CREATOR],
      [ApiResourceKind.file, shotId, CREATOR],
    ]);
    expect(await conversionCount()).toBe(0);
  });

  it("converges when a pass stopped after the File was made: one File, one block, its access rewritten", async () => {
    await storage.upload("attachments/01key/brief.pdf", new Uint8Array([1]), "");
    await seedRun("run_01again");
    seedConversion({ runId: "run_01again" });
    await convert();
    seedConversion({ runId: "run_01again" });
    await convert();

    const run = await fx.store.getResource(ApiResourceKind.run, "run_01again", RunSchema);
    expect(run.status?.messageFiles).toHaveLength(1);
    expect(created.map((event) => event.resourceId)).toEqual([convertedFileId("run_01again", 0), convertedFileId("run_01again", 0)]);
    expect(await conversionCount()).toBe(0);
  });

  it("skips and forgets an attachment whose bytes, run or conversation is gone", async () => {
    await seedRun("run_01nobytes");
    seedConversion({ runId: "run_01nobytes" });
    seedConversion({ runId: "run_01norun", storageKey: "attachments/01other/x.txt" });
    await storage.upload("attachments/01lone/y.txt", new Uint8Array([1]), "");
    await seedRun("run_01lonely");
    seedConversion({ runId: "run_01lonely", sessionId: "", storageKey: "attachments/01lone/y.txt" });

    expect(await convert()).toBe(0);
    expect(await conversionCount()).toBe(0);
    expect(created).toEqual([]);
  });

  it("stops on a storage fault, keeping the row for the next boot", async () => {
    await seedRun("run_01fault");
    seedConversion({ runId: "run_01fault" });
    const faulty: ArtifactStorage = Object.assign(Object.create(storage) as ArtifactStorage, {
      size: () => Promise.reject(new Error("bucket unreachable")),
    });
    await expect(convert({ storage: faulty })).rejects.toThrow("bucket unreachable");
    expect(await conversionCount()).toBe(1);
  });

  it("derives a File's id from its run and position, shaped as a minted one", () => {
    expect(convertedFileId("run_1", 0)).toBe(convertedFileId("run_1", 0));
    expect(convertedFileId("run_1", 0)).not.toBe(convertedFileId("run_1", 1));
    expect(convertedFileId("run_1", 0)).toMatch(/^file_[0-9a-hjkmnp-tv-z]{26}$/);
  });
});
