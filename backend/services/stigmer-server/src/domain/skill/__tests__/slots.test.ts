/**
 * Pins the upload-slot registry against Go's slots_test.go, keyed by the
 * domain's staging key: reservation bounds and key shape, TTL expiry
 * (injected clock), exact-declared-size enforcement (short AND long
 * bodies), single upload per key, staged-file placement under the driver
 * root, expiry sweep on reservation, the boot-time staging wipe, and the
 * staging directory's recreation after the driver's delete pruned it.
 */
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { STAGING_KEY_PREFIX } from "../constants.js";
import {
  SizeMismatchError,
  SlotConsumedError,
  SlotUnknownError,
  UploadSlots,
} from "../transfer/slots.js";
import { newUploadRef, stagingKeyOf } from "../transfer/staging.js";

const TTL_MS = 15 * 60 * 1000;
const MAX_SIZE = 100 * 1024 * 1024;

let root: string;
let stagingDir: string;
let nowMs: number;
let slots: UploadSlots;

function body(text: string): Readable {
  return Readable.from([Buffer.from(text)]);
}

/** A fresh, well-formed staging key — what the domain's mint hands the registry. */
function freshKey(): string {
  const key = stagingKeyOf(newUploadRef());
  if (key === undefined) throw new Error("a minted ref always has a key");
  return key;
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "skill-slots-test-"));
  stagingDir = path.join(root, STAGING_KEY_PREFIX);
  nowMs = 1_000_000;
  slots = new UploadSlots(
    root,
    STAGING_KEY_PREFIX,
    TTL_MS,
    MAX_SIZE,
    () => nowMs,
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("UploadSlots", () => {
  it("reserves a key with the registry TTL", () => {
    expect(slots.reserve(freshKey(), 1024)).toEqual({ ttlMs: TTL_MS });
  });

  it("rejects out-of-bounds declarations at reservation", () => {
    expect(() => slots.reserve(freshKey(), 0)).toThrow(
      "declared size 0 outside (0, 104857600]",
    );
    expect(() => slots.reserve(freshKey(), -1)).toThrow(
      `declared size -1 outside (0, ${MAX_SIZE}]`,
    );
    expect(() => slots.reserve(freshKey(), MAX_SIZE + 1)).toThrow(
      `declared size ${MAX_SIZE + 1} outside (0, ${MAX_SIZE}]`,
    );
  });

  it("refuses a key outside the staging prefix or not shaped like a staged archive", () => {
    expect(() => slots.reserve("skills/deadbeef.zip", 1)).toThrow(
      `staging key skills/deadbeef.zip is outside ${STAGING_KEY_PREFIX}`,
    );
    expect(() =>
      slots.reserve(`${STAGING_KEY_PREFIX}../escape.zip`, 1),
    ).toThrow("does not name a staged archive");
    expect(() => slots.reserve(`${STAGING_KEY_PREFIX}notes.txt`, 1)).toThrow(
      "does not name a staged archive",
    );
  });

  it("refuses to reserve the same key twice", () => {
    const key = freshKey();
    slots.reserve(key, 1);
    expect(() => slots.reserve(key, 1)).toThrow(
      `staging key ${key} is already reserved`,
    );
  });

  it("stages a received body at the key under the root — where the driver reads it", async () => {
    const key = freshKey();
    slots.reserve(key, 5);
    await slots.receive(key, body("hello"));
    expect(readFileSync(path.join(root, key), "utf8")).toBe("hello");
  });

  it("rejects receive on an unreserved key", async () => {
    await expect(slots.receive(freshKey(), body("x"))).rejects.toThrow(
      SlotUnknownError,
    );
  });

  it("rejects receive on an expired key", async () => {
    const key = freshKey();
    slots.reserve(key, 1);
    nowMs += TTL_MS + 1;
    await expect(slots.receive(key, body("x"))).rejects.toThrow(
      SlotUnknownError,
    );
  });

  it("rejects a second upload to the same key", async () => {
    const key = freshKey();
    slots.reserve(key, 1);
    await slots.receive(key, body("x"));
    await expect(slots.receive(key, body("x"))).rejects.toThrow(
      SlotConsumedError,
    );
  });

  it("rejects a short body, naming both sizes, and stages nothing", async () => {
    const key = freshKey();
    slots.reserve(key, 10);
    await expect(slots.receive(key, body("short"))).rejects.toThrow(
      "upload size mismatch: received 5 bytes, declared 10",
    );
    await expect(slots.receive(key, body("short"))).rejects.toBeInstanceOf(
      SizeMismatchError,
    );
    expect(readdirSync(stagingDir)).toEqual([]);
  });

  it("rejects an over-declaration body without buffering it whole (declared+1 proof)", async () => {
    const key = freshKey();
    slots.reserve(key, 3);
    await expect(slots.receive(key, body("longer than three"))).rejects.toThrow(
      "upload size mismatch: received 4 bytes, declared 3",
    );
  });

  it("sweeps expired slots and their staged files on reservation", async () => {
    const key = freshKey();
    slots.reserve(key, 1);
    await slots.receive(key, body("x"));
    expect(readdirSync(stagingDir)).toHaveLength(1);
    nowMs += TTL_MS + 1;
    slots.reserve(freshKey(), 1);
    expect(readdirSync(stagingDir)).toEqual([]);
  });

  it("recreates the staging directory when the driver's delete pruned it between uploads", async () => {
    const key = freshKey();
    slots.reserve(key, 1);
    rmSync(stagingDir, { recursive: true, force: true });
    await slots.receive(key, body("x"));
    expect(readFileSync(path.join(root, key), "utf8")).toBe("x");
  });

  it("wipes the staging directory at construction (orphans are unreachable)", () => {
    const orphanRoot = path.join(root, "orphan-root");
    const orphanDir = path.join(orphanRoot, STAGING_KEY_PREFIX);
    mkdirSync(orphanDir, { recursive: true });
    const orphan = path.join(orphanDir, "deadbeef.zip");
    writeFileSync(orphan, "stale bytes");
    new UploadSlots(orphanRoot, STAGING_KEY_PREFIX, TTL_MS, MAX_SIZE);
    expect(existsSync(orphan)).toBe(false);
    expect(readdirSync(orphanDir)).toEqual([]);
  });
});
