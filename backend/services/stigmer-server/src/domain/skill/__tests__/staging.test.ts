/**
 * Pins the archive staging port (transfer/staging.ts): the reference ⇄
 * staging-key mapping and its refusals; mint handing the driver the
 * domain's key and the slot TTL; consume reading then deleting, with the
 * delete best-effort and loud; the one "unknown or expired" condition for
 * a malformed, missing or already-consumed reference; a driver fault
 * propagating untouched; the download capability's floor TTL. First over
 * a recording fake driver (what any bucket sees), then over the real local
 * driver with its slot registry, wired exactly as boot/compose.ts wires it
 * — the two drivers must be indistinguishable above this module.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ArtifactStorageNotFoundError,
  LocalArtifactStorage,
} from "../../../artifactstorage/artifact-storage.js";
import type { ArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import { createLogger } from "../../../boot/logger.js";
import { SKILL_ARTIFACTS_PATH_PREFIX } from "../../../transport/constants.js";
import {
  DEFAULT_SLOT_TTL_MS,
  DOWNLOAD_URL_TTL_MS,
  MAX_ZIP_SIZE,
  STAGING_KEY_PREFIX,
  UPLOADS_SEGMENT,
} from "../constants.js";
import { transferServeUrl, uploadUrl } from "../transfer/handler.js";
import { SlotUnknownError, UploadSlots } from "../transfer/slots.js";
import {
  newArchiveStaging,
  newUploadRef,
  stagingKeyOf,
  uploadRefOf,
} from "../transfer/staging.js";
import type { ArchiveStaging } from "../transfer/staging.js";

const logLines: string[] = [];
const logger = createLogger({
  level: "error",
  pretty: false,
  write: (line) => {
    logLines.push(line);
  },
});

describe("the reference ⇄ staging key mapping", () => {
  it("mints sau_-prefixed 128-bit hex references whose key sits under the staging prefix", () => {
    const ref = newUploadRef();
    expect(ref).toMatch(/^sau_[0-9a-f]{32}$/);
    const key = stagingKeyOf(ref);
    expect(key).toBe(`${STAGING_KEY_PREFIX}${ref.slice(4)}.zip`);
    expect(uploadRefOf(key!)).toBe(ref);
  });

  it("answers no key for a reference this server could not have minted", () => {
    for (const bad of [
      "",
      "sau_",
      "sau_nope",
      "sau_" + "g".repeat(32),
      "sau_" + "0".repeat(31),
      "skl_" + "0".repeat(32),
      "sau_" + "A".repeat(32),
    ]) {
      expect(stagingKeyOf(bad), bad).toBeUndefined();
    }
  });

  it("refuses to derive a reference from a foreign key", () => {
    expect(() => uploadRefOf("skills/deadbeef.zip")).toThrow(
      "is not a staging key this domain minted",
    );
    expect(() => uploadRefOf(`${STAGING_KEY_PREFIX}notes.txt`)).toThrow(
      "is not a staging key this domain minted",
    );
  });
});

// ─── Over a recording fake: what a bucket driver is asked to do ──────────

interface Recorded {
  presignPut: Array<{ key: string; declaredSizeBytes: number; ttlMs: number }>;
  downloads: string[];
  deletes: string[];
  signed: Array<{ key: string; expiresInMs: number; downloadFilename: string }>;
}

function fakeDriver(
  options: { failDelete?: boolean; failDownload?: Error } = {},
): {
  driver: ArtifactStorage;
  blobs: Map<string, Uint8Array>;
  recorded: Recorded;
} {
  const blobs = new Map<string, Uint8Array>();
  const recorded: Recorded = {
    presignPut: [],
    downloads: [],
    deletes: [],
    signed: [],
  };
  const driver: ArtifactStorage = {
    upload: (key, data) => {
      blobs.set(key, data);
      return Promise.resolve();
    },
    download: (key) => {
      recorded.downloads.push(key);
      if (options.failDownload) return Promise.reject(options.failDownload);
      const data = blobs.get(key);
      return data === undefined
        ? Promise.reject(new ArtifactStorageNotFoundError(key))
        : Promise.resolve(data);
    },
    size: (key) => Promise.resolve(blobs.get(key)?.length ?? 0),
    presignPut: (key, declaredSizeBytes, ttlMs) => {
      recorded.presignPut.push({ key, declaredSizeBytes, ttlMs });
      return Promise.resolve({
        url: `https://bucket.test/${key}?sig=put`,
        ttlMs: ttlMs / 2,
      });
    },
    getSignedUrl: (key, expiresInMs, downloadFilename) => {
      recorded.signed.push({ key, expiresInMs, downloadFilename });
      return Promise.resolve(`https://bucket.test/${key}?sig=get`);
    },
    delete: (key) => {
      recorded.deletes.push(key);
      if (options.failDelete)
        return Promise.reject(new Error("bucket refused the delete"));
      blobs.delete(key);
      return Promise.resolve();
    },
    exists: (key) => Promise.resolve(blobs.has(key)),
    health: () => Promise.resolve(),
  };
  return { driver, blobs, recorded };
}

describe("newArchiveStaging over a bucket-shaped driver", () => {
  beforeEach(() => {
    logLines.length = 0;
  });

  it("mint hands the driver the domain's key and the slot TTL, and returns the driver's URL and granted TTL", async () => {
    const { driver, recorded } = fakeDriver();
    const staging = newArchiveStaging(driver, logger);
    const minted = await staging.mint(1234);

    expect(recorded.presignPut).toEqual([
      {
        key: stagingKeyOf(minted.ref),
        declaredSizeBytes: 1234,
        ttlMs: DEFAULT_SLOT_TTL_MS,
      },
    ]);
    expect(minted.url).toBe(
      `https://bucket.test/${stagingKeyOf(minted.ref)}?sig=put`,
    );
    expect(minted.ttlMs).toBe(DEFAULT_SLOT_TTL_MS / 2);
  });

  it("mint refuses a declaration outside the archive ceiling before any driver call", async () => {
    const { driver, recorded } = fakeDriver();
    const staging = newArchiveStaging(driver, logger);
    await expect(staging.mint(0)).rejects.toThrow(
      `declared size 0 outside (0, ${MAX_ZIP_SIZE}]`,
    );
    await expect(staging.mint(MAX_ZIP_SIZE + 1)).rejects.toThrow("outside");
    expect(recorded.presignPut).toEqual([]);
  });

  it("consume reads the staged key, deletes it, and a replay is unknown", async () => {
    const { driver, blobs, recorded } = fakeDriver();
    const staging = newArchiveStaging(driver, logger);
    const minted = await staging.mint(5);
    const key = stagingKeyOf(minted.ref)!;
    blobs.set(key, Buffer.from("hello"));

    expect(Buffer.from(await staging.consume(minted.ref)).toString()).toBe(
      "hello",
    );
    expect(recorded.downloads).toEqual([key]);
    expect(recorded.deletes).toEqual([key]);
    await expect(staging.consume(minted.ref)).rejects.toThrow(SlotUnknownError);
  });

  it("a malformed or never-uploaded reference is one condition: unknown or expired", async () => {
    const { driver, recorded } = fakeDriver();
    const staging = newArchiveStaging(driver, logger);
    await expect(staging.consume("not-a-ref")).rejects.toThrow(
      "upload reference unknown or expired",
    );
    // Nothing shaped like a key reaches the driver for a malformed ref.
    expect(recorded.downloads).toEqual([]);

    const minted = await staging.mint(5);
    await expect(staging.consume(minted.ref)).rejects.toThrow(SlotUnknownError);
  });

  it("a failed delete is loud and does not fail the consume", async () => {
    const { driver, blobs } = fakeDriver({ failDelete: true });
    const staging = newArchiveStaging(driver, logger);
    const minted = await staging.mint(5);
    blobs.set(stagingKeyOf(minted.ref)!, Buffer.from("hello"));

    expect(Buffer.from(await staging.consume(minted.ref)).toString()).toBe(
      "hello",
    );
    expect(
      logLines.some((line) =>
        line.includes("failed to delete consumed staged artifact"),
      ),
    ).toBe(true);
  });

  it("a driver fault on download propagates as itself, never as an unusable reference", async () => {
    const fault = new Error("bucket unreachable");
    const { driver } = fakeDriver({ failDownload: fault });
    const staging = newArchiveStaging(driver, logger);
    const minted = await staging.mint(5);
    await expect(staging.consume(minted.ref)).rejects.toBe(fault);
  });

  it("downloadUrl signs the stored key for the floor TTL and reports it", async () => {
    const { driver, recorded } = fakeDriver();
    const staging = newArchiveStaging(driver, logger);
    const capability = await staging.downloadUrl("skills/abc.zip");
    expect(recorded.signed).toEqual([
      {
        key: "skills/abc.zip",
        expiresInMs: DOWNLOAD_URL_TTL_MS,
        downloadFilename: "",
      },
    ]);
    expect(capability).toEqual({
      url: "https://bucket.test/skills/abc.zip?sig=get",
      ttlMs: DOWNLOAD_URL_TTL_MS,
    });
  });
});

// ─── Over the real local driver: the slot registry behind the same port ──

describe("newArchiveStaging over LocalArtifactStorage and its slot registry", () => {
  const BASE_URL = "http://localhost:8080";
  let root: string;
  let slots: UploadSlots;
  let staging: ArchiveStaging;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "archive-staging-local-"));
    slots = new UploadSlots(root, STAGING_KEY_PREFIX, 60_000, 1024 * 1024);
    const driver = new LocalArtifactStorage(root, transferServeUrl(BASE_URL), {
      reserve: (key, declaredSizeBytes) => {
        const { ttlMs } = slots.reserve(key, declaredSizeBytes);
        return { url: uploadUrl(BASE_URL, uploadRefOf(key)), ttlMs };
      },
    });
    staging = newArchiveStaging(driver, logger);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("mint → lane receive → consume round-trips the bytes and retires the reference", async () => {
    const bytes = Buffer.from("staged artifact bytes");
    const minted = await staging.mint(bytes.length);

    // The URL is the lane's wire shape and the ref is its last segment —
    // exactly how the lane handler dispatches a PUT.
    expect(minted.url).toBe(
      `${BASE_URL}${SKILL_ARTIFACTS_PATH_PREFIX}${UPLOADS_SEGMENT}${minted.ref}`,
    );
    // The registry's slot TTL governs, not the domain's ask.
    expect(minted.ttlMs).toBe(60_000);

    await slots.receive(stagingKeyOf(minted.ref)!, Readable.from(bytes));
    expect(Buffer.from(await staging.consume(minted.ref))).toEqual(bytes);
    await expect(staging.consume(minted.ref)).rejects.toThrow(SlotUnknownError);
  });

  it("a reserved-but-never-uploaded reference is unknown, exactly as on a bucket", async () => {
    const minted = await staging.mint(4);
    await expect(staging.consume(minted.ref)).rejects.toThrow(
      "upload reference unknown or expired",
    );
  });

  it("downloadUrl renders the lane's own GET route with the floor TTL", async () => {
    const capability = await staging.downloadUrl("skills/abc.zip");
    expect(capability).toEqual({
      url: `${BASE_URL}${SKILL_ARTIFACTS_PATH_PREFIX}/skills/abc.zip`,
      ttlMs: DOWNLOAD_URL_TTL_MS,
    });
  });
});
