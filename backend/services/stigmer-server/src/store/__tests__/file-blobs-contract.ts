/**
 * The File blob store contract (../file-blobs.ts): every behaviour both
 * drivers must show through `Store.files`, as a suite each driver's test
 * runs over a fresh store (`sqlite/__tests__/file-blobs.test.ts`,
 * `postgres/__tests__/file-blobs.postgres.test.ts`). The cases speak only
 * the Store interface: a blob's row through `getBlob`, a File's row
 * through `getResource` and the list index, its blob through `blobKeyOf`.
 *
 * Covered: recording a blob once; `insert` landing a File on a blob a File
 * may name (a leased orphan, or a stored blob another File shares) with
 * its row, its list keys and its ref in one write, answering false for a
 * held id, and refusing an absent, staged, foreign or expired blob while
 * writing nothing; `remove` orphaning a blob only with its last File;
 * `claimStaged` handing a live staged blob out once; the sweep's read and
 * its guarded forget; an organization's purge. Two races
 * close it: two removes of a blob's last two Files orphan it exactly once,
 * and an insert racing the remove of a blob's last File either lands
 * first or is refused, never leaving a stored blob no File names. SQLite serializes
 * every writer, so there the races hold by construction; Postgres proves
 * the row lock.
 */
import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import type { File } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { etagOf } from "../etag.js";
import { FileBlobUnavailableError } from "../file-blobs.js";
import type { FileBlobRecord } from "../file-blobs.js";
import { ResourceNotFoundError } from "../interface.js";
import type { Store, StoreOpenOptions } from "../interface.js";
import { declareListIndex, field } from "../list-index.js";

/** The kit's own File declaration, so the list-key arms do not depend on the server's list. */
export const FILE_BLOBS_CONTRACT_INDEX = declareListIndex({
  kind: ApiResourceKind.file,
  schema: FileSchema,
  revision: 1,
  keys: {
    session: field("status.session_id"),
  },
});

/** What every File blob contract store opens with. */
export const FILE_BLOBS_CONTRACT_STORE_OPTIONS: StoreOpenOptions = {
  listIndexes: [FILE_BLOBS_CONTRACT_INDEX],
};

/** One fresh, isolated store per case, opened with `FILE_BLOBS_CONTRACT_STORE_OPTIONS`. */
export interface FileBlobStoreContractFixture {
  readonly store: Store;
  cleanup(): Promise<void>;
}

const KIND = ApiResourceKind.file;
const ORG = "org_01kfileblobs000000000000000";
const OTHER_ORG = "org_01kotherorg000000000000000";
const SESSION = "ses_01kfileblobs000000000000000";
const NOW = 1_800_000_000;
const LEASE = NOW + 600;

function fileRow(id: string, org = ORG, filename = "notes.txt"): File {
  return create(FileSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "File",
    metadata: { id, org, name: filename },
    spec: { filename, mimeType: "text/plain" },
    status: { sessionId: SESSION },
  });
}

function blob(blobKey: string, overrides: Partial<FileBlobRecord> = {}): FileBlobRecord {
  return { blobKey, org: ORG, state: "orphaned", sizeBytes: 0, expiresAt: LEASE, ...overrides };
}

export function describeFileBlobStoreContract(
  makeFixture: () => Promise<FileBlobStoreContractFixture>,
): void {
  let fx: FileBlobStoreContractFixture;
  let store: Store;

  beforeEach(async () => {
    fx = await makeFixture();
    store = fx.store;
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  const insertFile = (id: string, blobKey: string, sizeBytes = 42, org = ORG, now = NOW) =>
    store.files.insert(KIND, id, FileSchema, fileRow(id, org), { blobKey, org, sizeBytes }, now);

  const sessionFiles = async (): Promise<string[]> =>
    (
      await store.queryResources(FILE_BLOBS_CONTRACT_INDEX, {
        org: ORG,
        anyKey: [{ name: "session", value: SESSION }],
      })
    )
      .map((row) => row.id)
      .sort();

  describe("recording a blob", () => {
    it("round-trips a recorded blob and refuses a key already recorded", async () => {
      const staged = blob("blob/a", { state: "staged", sizeBytes: 9, expiresAt: NOW + 30 });
      await store.files.recordBlob(staged);
      expect(await store.files.getBlob("blob/a")).toEqual(staged);
      await expect(store.files.recordBlob(blob("blob/a"))).rejects.toThrow();
      expect(await store.files.getBlob("blob/a")).toEqual(staged);
    });

    it("answers undefined for a key never recorded", async () => {
      expect(await store.files.getBlob("blob/none")).toBeUndefined();
    });
  });

  describe("insert", () => {
    it("lands a File on a leased orphan: the blob stored with the size, the row, its list keys and its ref", async () => {
      await store.files.recordBlob(blob("blob/a"));
      expect(await insertFile("file_01a", "blob/a", 42)).toBe(true);

      expect(await store.files.getBlob("blob/a")).toEqual({
        blobKey: "blob/a",
        org: ORG,
        state: "stored",
        sizeBytes: 42,
        expiresAt: 0,
      });
      const stored = await store.getResource(KIND, "file_01a", FileSchema);
      expect(stored.metadata?.id).toBe("file_01a");
      expect(stored.metadata?.etag, "the row is stamped as insertResource stamps it").toBe(etagOf(FileSchema, stored));
      expect(stored.metadata?.etag).not.toBe("");
      expect(await store.files.blobKeyOf("file_01a")).toBe("blob/a");
      expect(await sessionFiles()).toEqual(["file_01a"]);
    });

    it("answers false for an id already held and changes nothing", async () => {
      await store.files.recordBlob(blob("blob/a"));
      await store.files.recordBlob(blob("blob/b"));
      expect(await insertFile("file_01a", "blob/a")).toBe(true);

      const again = await store.files.insert(
        KIND,
        "file_01a",
        FileSchema,
        fileRow("file_01a", ORG, "other.txt"),
        { blobKey: "blob/b", org: ORG, sizeBytes: 7 },
        NOW,
      );
      expect(again).toBe(false);
      expect(await store.files.getBlob("blob/b")).toEqual(blob("blob/b"));
      expect(await store.files.blobKeyOf("file_01a")).toBe("blob/a");
      expect((await store.getResource(KIND, "file_01a", FileSchema)).spec?.filename).toBe("notes.txt");
    });

    it.each([
      ["an absent blob", undefined],
      ["a staged blob", blob("blob/a", { state: "staged", expiresAt: LEASE })],
      ["a blob of another organization", blob("blob/a", { org: OTHER_ORG })],
      ["an orphaned blob expiring now", blob("blob/a", { expiresAt: NOW })],
      ["an orphaned blob past its expiry", blob("blob/a", { expiresAt: NOW - 1 })],
    ])("refuses %s and writes nothing", async (_name, recorded) => {
      if (recorded !== undefined) {
        await store.files.recordBlob(recorded);
      }
      await expect(insertFile("file_01a", "blob/a")).rejects.toThrow(FileBlobUnavailableError);
      await expect(store.getResource(KIND, "file_01a", FileSchema)).rejects.toThrow(ResourceNotFoundError);
      expect(await store.files.blobKeyOf("file_01a")).toBeUndefined();
      expect(await store.files.getBlob("blob/a")).toEqual(recorded);
      expect(await sessionFiles()).toEqual([]);
    });
  });

  describe("remove", () => {
    it("orphans a shared blob only with its last File, which keeps the first File's size", async () => {
      await store.files.recordBlob(blob("blob/a"));
      expect(await insertFile("file_01a", "blob/a", 42)).toBe(true);
      expect(await insertFile("file_01b", "blob/a", 7)).toBe(true);
      expect((await store.files.getBlob("blob/a"))?.sizeBytes).toBe(42);
      expect(await sessionFiles()).toEqual(["file_01a", "file_01b"]);

      expect(await store.files.remove(KIND, "file_01a")).toEqual({
        removed: true,
        orphanedBlobKey: undefined,
      });
      expect((await store.files.getBlob("blob/a"))?.state).toBe("stored");
      await expect(store.getResource(KIND, "file_01a", FileSchema)).rejects.toThrow(ResourceNotFoundError);
      expect(await store.files.blobKeyOf("file_01a")).toBeUndefined();
      expect(await sessionFiles()).toEqual(["file_01b"]);

      expect(await store.files.remove(KIND, "file_01b")).toEqual({
        removed: true,
        orphanedBlobKey: "blob/a",
      });
      expect(await store.files.getBlob("blob/a")).toEqual({
        blobKey: "blob/a",
        org: ORG,
        state: "orphaned",
        sizeBytes: 42,
        expiresAt: 0,
      });
      await expect(store.getResource(KIND, "file_01b", FileSchema)).rejects.toThrow(ResourceNotFoundError);
      expect(await sessionFiles()).toEqual([]);
    });

    it("a blob its last File left cannot be named again", async () => {
      await store.files.recordBlob(blob("blob/a"));
      await insertFile("file_01a", "blob/a");
      await store.files.remove(KIND, "file_01a");
      await expect(insertFile("file_01b", "blob/a")).rejects.toThrow(FileBlobUnavailableError);
    });

    it("removing an absent File is not an error", async () => {
      expect(await store.files.remove(KIND, "file_01none")).toEqual({
        removed: false,
        orphanedBlobKey: undefined,
      });
    });
  });

  describe("claimStaged", () => {
    it("hands a live staged blob of the organization out once, orphaned until the lease", async () => {
      const staged = blob("blob/a", { state: "staged", sizeBytes: 9, expiresAt: NOW + 30 });
      await store.files.recordBlob(staged);

      expect(await store.files.claimStaged("blob/a", ORG, NOW, LEASE)).toEqual(staged);
      expect(await store.files.getBlob("blob/a")).toEqual({ ...staged, state: "orphaned", expiresAt: LEASE });
      expect(await store.files.claimStaged("blob/a", ORG, NOW, LEASE)).toBeUndefined();
    });

    it.each([
      ["an absent blob", undefined, ORG],
      ["an expired staged blob", blob("blob/a", { state: "staged", expiresAt: NOW }), ORG],
      ["another organization's staged blob", blob("blob/a", { state: "staged", expiresAt: NOW + 30 }), OTHER_ORG],
      ["an orphaned blob", blob("blob/a"), ORG],
    ])("answers undefined for %s and changes nothing", async (_name, recorded, org) => {
      if (recorded !== undefined) {
        await store.files.recordBlob(recorded);
      }
      expect(await store.files.claimStaged("blob/a", org, NOW, LEASE)).toBeUndefined();
      expect(await store.files.getBlob("blob/a")).toEqual(recorded);
    });

    it("answers undefined for a stored blob", async () => {
      await store.files.recordBlob(blob("blob/a"));
      await insertFile("file_01a", "blob/a");
      expect(await store.files.claimStaged("blob/a", ORG, NOW, LEASE)).toBeUndefined();
      expect((await store.files.getBlob("blob/a"))?.state).toBe("stored");
    });
  });

  describe("the sweep", () => {
    async function seedSweep(): Promise<void> {
      await store.files.recordBlob(blob("blob/staged-expired", { state: "staged", expiresAt: NOW - 1 }));
      await store.files.recordBlob(blob("blob/orphan-expired", { expiresAt: NOW }));
      await store.files.recordBlob(blob("blob/staged-live", { state: "staged", expiresAt: NOW + 1 }));
      await store.files.recordBlob(blob("blob/orphan-live", { expiresAt: NOW + 1 }));
      await store.files.recordBlob(blob("blob/stored"));
      await insertFile("file_01a", "blob/stored");
    }

    it("lists the staged and orphaned blobs expired at now, bounded by the limit", async () => {
      await seedSweep();
      expect((await store.files.listSweepable(NOW, 10)).sort()).toEqual([
        "blob/orphan-expired",
        "blob/staged-expired",
      ]);
      expect(await store.files.listSweepable(NOW, 1)).toHaveLength(1);
    });

    it("forgets only a blob that is still sweepable", async () => {
      await seedSweep();
      expect(await store.files.forgetBlob("blob/stored", NOW)).toBe(false);
      expect(await store.files.forgetBlob("blob/orphan-live", NOW)).toBe(false);
      expect(await store.files.forgetBlob("blob/staged-live", NOW)).toBe(false);
      expect(await store.files.forgetBlob("blob/none", NOW)).toBe(false);
      expect(await store.files.forgetBlob("blob/orphan-expired", NOW)).toBe(true);
      expect(await store.files.forgetBlob("blob/staged-expired", NOW)).toBe(true);
      expect(await store.files.getBlob("blob/orphan-expired")).toBeUndefined();
      expect(await store.files.listSweepable(NOW, 10)).toEqual([]);
      expect((await store.files.getBlob("blob/stored"))?.state).toBe("stored");
      expect((await store.files.getBlob("blob/orphan-live"))?.state).toBe("orphaned");
    });
  });

  describe("an organization's purge", () => {
    it("pages the organization's blob keys in key order", async () => {
      for (const key of ["blob/c", "blob/a", "blob/b"]) {
        await store.files.recordBlob(blob(key));
      }
      await store.files.recordBlob(blob("blob/0-other", { org: OTHER_ORG }));
      expect(await store.files.listBlobKeysByOrg(ORG, "", 2)).toEqual(["blob/a", "blob/b"]);
      expect(await store.files.listBlobKeysByOrg(ORG, "blob/b", 2)).toEqual(["blob/c"]);
      expect(await store.files.listBlobKeysByOrg(ORG, "blob/c", 2)).toEqual([]);
    });

    it("removes the organization's blob and ref rows only, answering the blob count", async () => {
      await store.files.recordBlob(blob("blob/a"));
      await store.files.recordBlob(blob("blob/b", { state: "staged" }));
      await insertFile("file_01a", "blob/a");
      await store.files.recordBlob(blob("blob/other", { org: OTHER_ORG }));
      await insertFile("file_01other", "blob/other", 3, OTHER_ORG);

      expect(await store.files.deleteByOrg(ORG)).toBe(2);
      expect(await store.files.getBlob("blob/a")).toBeUndefined();
      expect(await store.files.getBlob("blob/b")).toBeUndefined();
      expect(await store.files.blobKeyOf("file_01a")).toBeUndefined();
      expect((await store.files.getBlob("blob/other"))?.state).toBe("stored");
      expect(await store.files.blobKeyOf("file_01other")).toBe("blob/other");
      expect(await store.files.deleteByOrg(ORG)).toBe(0);
    });
  });

  describe("races", () => {
    const ROUNDS = 12;

    it("two removes of a blob's last two Files orphan it exactly once", async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const key = `blob/race-${round}`;
        await store.files.recordBlob(blob(key));
        await insertFile(`file_${round}a`, key);
        await insertFile(`file_${round}b`, key);
      }
      for (let round = 0; round < ROUNDS; round++) {
        const key = `blob/race-${round}`;
        const results = await Promise.all([
          store.files.remove(KIND, `file_${round}a`),
          store.files.remove(KIND, `file_${round}b`),
        ]);
        expect(results.map((result) => result.removed)).toEqual([true, true]);
        expect(results.filter((result) => result.orphanedBlobKey === key), `round ${round}`).toHaveLength(1);
        expect((await store.files.getBlob(key))?.state).toBe("orphaned");
      }
    });

    it("an insert racing the remove of a blob's last File lands first or is refused, never leaving a stored blob unnamed", async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const key = `blob/race-${round}`;
        await store.files.recordBlob(blob(key));
        await insertFile(`file_${round}a`, key);
      }
      for (let round = 0; round < ROUNDS; round++) {
        const key = `blob/race-${round}`;
        const [removal, insertion] = await Promise.allSettled([
          store.files.remove(KIND, `file_${round}a`),
          insertFile(`file_${round}b`, key),
        ]);
        expect(removal.status).toBe("fulfilled");
        const removed = removal.status === "fulfilled" ? removal.value : undefined;
        const after = await store.files.getBlob(key);
        if (insertion.status === "fulfilled") {
          expect(insertion.value).toBe(true);
          expect(removed?.orphanedBlobKey, `round ${round}`).toBeUndefined();
          expect(after?.state).toBe("stored");
          expect(await store.files.blobKeyOf(`file_${round}b`)).toBe(key);
        } else {
          expect(insertion.reason).toBeInstanceOf(FileBlobUnavailableError);
          expect(removed?.orphanedBlobKey, `round ${round}`).toBe(key);
          expect(after?.state).toBe("orphaned");
          expect(await store.files.blobKeyOf(`file_${round}b`)).toBeUndefined();
        }
      }
    });
  });
}
