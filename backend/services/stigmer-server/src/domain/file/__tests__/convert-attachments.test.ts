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
 *   - an attachment whose bytes are gone, whose run or conversation is
 *     gone, or whose run is in no conversation is skipped and its row
 *     forgotten;
 *   - so is one whose key is not the minted `attachments/<ULID>/<filename>`
 *     for its own filename (a traversal, another name, a lower-case id),
 *     and one whose key's blob row is another organization's or staged;
 *   - a blob a stopped pass recorded, whose lease ran out, is leased again
 *     and converted; a blob another server records first is used as it
 *     is, and one that turns unavailable before its File is skipped;
 *   - a storage or store fault stops the pass with the row kept;
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
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import { LocalArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import { testUrlSigner } from "../../../artifactstorage/__test-utils__/url-signer.js";
import type { ResourceAuthorizationLifecycle, ResourceCreatedEvent } from "../../../extensions/resource-authorization.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { FileBlobUnavailableError } from "../../../store/file-blobs.js";
import type { AttachmentConversion } from "../../../store/file-blobs.js";
import type { Store } from "../../../store/interface.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { convertStoredAttachments, convertedFileId, isMintedAttachmentKey } from "../convert-attachments.js";

const ORG = "org_01aaaaaaaaaaaaaaaaaaaaaaaa";
const SESSION = "ses_01convertconvertconvert";
const CREATOR = "acc_01creatorcreatorcreatorc";
/** The ULIDs the removed upload minted into its keys. */
const ULID_A = "01J9ZQ6V8W3X4Y5Z6A7B8C9D0E";
const ULID_B = "01J9ZQ7A1B2C3D4E5F6G7H8J9K";
const keyOf = (ulid: string, filename: string) => `attachments/${ulid}/${filename}`;

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

beforeEach(async () => {
  fx = tempStore();
  await fx.store.saveResource(
    ApiResourceKind.session,
    SESSION,
    SessionSchema,
    create(SessionSchema, { metadata: { id: SESSION, org: ORG } }),
  );
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
    storageKey: keyOf(ULID_A, conversion.filename ?? "brief.pdf"),
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
    await storage.upload(keyOf(ULID_A, "brief.pdf"), new TextEncoder().encode("%PDF-1"), "application/pdf");
    await storage.upload(keyOf(ULID_A, "shot.png"), new Uint8Array([137, 80, 78, 71]), "image/png");
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
    expect(await fx.store.files.blobKeyOf(briefId)).toBe(keyOf(ULID_A, "brief.pdf"));
    expect((await fx.store.files.getBlob(keyOf(ULID_A, "brief.pdf")))?.state).toBe("stored");

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
    await storage.upload(keyOf(ULID_A, "brief.pdf"), new Uint8Array([1]), "");
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
    seedConversion({ runId: "run_01norun", storageKey: keyOf(ULID_B, "x.txt"), filename: "x.txt" });
    await storage.upload(keyOf(ULID_B, "y.txt"), new Uint8Array([1]), "");
    await seedRun("run_01lonely");
    seedConversion({ runId: "run_01lonely", sessionId: "", filename: "y.txt", storageKey: keyOf(ULID_B, "y.txt") });

    expect(await convert()).toBe(0);
    expect(await conversionCount()).toBe(0);
    expect(created).toEqual([]);
  });

  it("skips and forgets a conversation that is gone", async () => {
    await storage.upload(keyOf(ULID_A, "brief.pdf"), new Uint8Array([1]), "");
    await fx.store.saveResource(
      ApiResourceKind.run,
      "run_01orphan",
      RunSchema,
      create(RunSchema, { metadata: { id: "run_01orphan", org: ORG }, spec: { target: { case: "sessionId", value: "ses_01gone" } } }),
    );
    seedConversion({ runId: "run_01orphan", sessionId: "ses_01gone" });
    expect(await convert()).toBe(0);
    expect(await conversionCount()).toBe(0);
  });

  it("trusts a key only as the upload minted it for the row's own filename", async () => {
    await seedRun("run_01keys");
    const keys: Array<[string, string]> = [
      ["attachments/../files/org_01other/blob", "blob"],
      [keyOf(ULID_A, "other.pdf"), "brief.pdf"],
      [`attachments/${ULID_A.toLowerCase()}/brief.pdf`, "brief.pdf"],
      [`files/${ORG}/0123456789abcdef`, "0123456789abcdef"],
    ];
    for (const [position, [storageKey, filename]] of keys.entries()) {
      seedConversion({ runId: "run_01keys", position, storageKey, filename });
    }
    expect(await convert()).toBe(0);
    expect(await conversionCount()).toBe(0);
    expect(created).toEqual([]);
    expect(isMintedAttachmentKey(keyOf(ULID_A, "brief.pdf"), "brief.pdf")).toBe(true);
    expect(isMintedAttachmentKey(keyOf(ULID_A, ".."), "..")).toBe(false);
  });

  it("skips a key whose blob row is another organization's, or a staged upload's", async () => {
    await storage.upload(keyOf(ULID_A, "brief.pdf"), new Uint8Array([1]), "");
    await storage.upload(keyOf(ULID_B, "brief.pdf"), new Uint8Array([1]), "");
    await fx.store.files.recordBlob({
      blobKey: keyOf(ULID_A, "brief.pdf"),
      org: "org_01bbbbbbbbbbbbbbbbbbbbbbbb",
      state: "stored",
      sizeBytes: 1,
      expiresAt: 0,
    });
    await fx.store.files.recordBlob({
      blobKey: keyOf(ULID_B, "brief.pdf"),
      org: ORG,
      state: "staged",
      sizeBytes: 1,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    await seedRun("run_01blobs");
    seedConversion({ runId: "run_01blobs" });
    seedConversion({ runId: "run_01blobs", position: 1, storageKey: keyOf(ULID_B, "brief.pdf") });
    expect(await convert()).toBe(0);
    expect(await conversionCount()).toBe(0);
  });

  it("leases again a blob a stopped pass recorded, and converts it", async () => {
    await storage.upload(keyOf(ULID_A, "brief.pdf"), new Uint8Array([1, 2]), "");
    await fx.store.files.recordBlob({
      blobKey: keyOf(ULID_A, "brief.pdf"),
      org: ORG,
      state: "orphaned",
      sizeBytes: 2,
      expiresAt: Math.floor(Date.now() / 1000) - 7200,
    });
    await seedRun("run_01lapsed");
    seedConversion({ runId: "run_01lapsed" });
    expect(await convert()).toBe(1);
    expect((await fx.store.files.getBlob(keyOf(ULID_A, "brief.pdf")))?.state).toBe("stored");
  });

  /** The test store with some of its File door's methods replaced. */
  function withFiles(overrides: Partial<Store["files"]>): Store {
    const files = new Proxy(fx.store.files, {
      get(target, property, receiver) {
        const own = (overrides as Record<string | symbol, unknown>)[property];
        if (own !== undefined) {
          return own;
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    return new Proxy(fx.store, {
      get(target, property, receiver) {
        if (property === "files") {
          return files;
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
  }

  it("uses a blob row another server recorded first, and stops when none is there", async () => {
    await storage.upload(keyOf(ULID_A, "brief.pdf"), new Uint8Array([1]), "");
    await seedRun("run_01race");
    seedConversion({ runId: "run_01race" });
    const raced = withFiles({
      recordBlob: async (blob) => {
        await fx.store.files.recordBlob(blob);
        throw new Error("duplicate key value violates unique constraint");
      },
    });
    expect(await convertStoredAttachments({ store: raced, storage, lifecycle, logger: silentLogger })).toBe(1);

    await storage.upload(keyOf(ULID_B, "brief.pdf"), new Uint8Array([1]), "");
    seedConversion({ runId: "run_01race", position: 1, storageKey: keyOf(ULID_B, "brief.pdf") });
    const broken = withFiles({ recordBlob: () => Promise.reject(new Error("database unreachable")) });
    await expect(convertStoredAttachments({ store: broken, storage, lifecycle, logger: silentLogger })).rejects.toThrow(
      "database unreachable",
    );
    expect(await conversionCount()).toBe(1);
  });

  it("skips a blob that turns unavailable before its File is written", async () => {
    await storage.upload(keyOf(ULID_A, "brief.pdf"), new Uint8Array([1]), "");
    await seedRun("run_01gone");
    seedConversion({ runId: "run_01gone" });
    const store = withFiles({
      insert: () => Promise.reject(new FileBlobUnavailableError(keyOf(ULID_A, "brief.pdf"), "it is orphaned past its expiry")),
    });
    expect(await convertStoredAttachments({ store, storage, lifecycle, logger: silentLogger })).toBe(0);
    expect(await conversionCount()).toBe(0);

    await storage.upload(keyOf(ULID_B, "brief.pdf"), new Uint8Array([1]), "");
    seedConversion({ runId: "run_01gone", position: 1, storageKey: keyOf(ULID_B, "brief.pdf") });
    const faulty = withFiles({ insert: () => Promise.reject(new Error("database unreachable")) });
    await expect(convertStoredAttachments({ store: faulty, storage, lifecycle, logger: silentLogger })).rejects.toThrow(
      "database unreachable",
    );
    expect(await conversionCount()).toBe(1);
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

  it("stops on a store fault reading the run, keeping the row", async () => {
    seedConversion({ runId: "run_01unreadable" });
    const store = new Proxy(fx.store, {
      get(target, property, receiver) {
        if (property === "getResource") {
          return () => Promise.reject(new Error("database unreachable"));
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    await expect(
      convertStoredAttachments({ store, storage, lifecycle, logger: silentLogger }),
    ).rejects.toThrow("database unreachable");
    expect(await conversionCount()).toBe(1);
  });

  it("derives a File's id from its run and position, shaped as a minted one", () => {
    expect(convertedFileId("run_1", 0)).toBe(convertedFileId("run_1", 0));
    expect(convertedFileId("run_1", 0)).not.toBe(convertedFileId("run_1", 1));
    expect(convertedFileId("run_1", 0)).toMatch(/^file_[0-9a-hjkmnp-tv-z]{26}$/);
  });
});
