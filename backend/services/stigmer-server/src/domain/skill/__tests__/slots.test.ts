/**
 * Pins the upload-slot registry against Go's slots_test.go: mint bounds,
 * ref shape, TTL expiry (injected clock), exact-declared-size enforcement
 * (short AND long bodies), strict single-use consume, staged-file cleanup,
 * expiry sweep on mint, and the boot-time staging wipe.
 */
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SizeMismatchError,
  SlotConsumedError,
  SlotEmptyError,
  SlotUnknownError,
  UploadSlots,
} from "../transfer/slots.js";

const TTL_MS = 15 * 60 * 1000;
const MAX_SIZE = 100 * 1024 * 1024;

let dir: string;
let stagingDir: string;
let nowMs: number;
let slots: UploadSlots;

function body(text: string): Readable {
  return Readable.from([Buffer.from(text)]);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "skill-slots-test-"));
  stagingDir = path.join(dir, "skills-staging");
  nowMs = 1_000_000;
  slots = new UploadSlots(stagingDir, TTL_MS, MAX_SIZE, () => nowMs);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("UploadSlots", () => {
  it("mints sau_-prefixed 128-bit hex refs with the registry TTL", () => {
    const { ref, ttlMs } = slots.mint(1024);
    expect(ref).toMatch(/^sau_[0-9a-f]{32}$/);
    expect(ttlMs).toBe(TTL_MS);
  });

  it("rejects out-of-bounds declarations at mint", () => {
    expect(() => slots.mint(0)).toThrow("declared size 0 outside (0, 104857600]");
    expect(() => slots.mint(-1)).toThrow(`declared size -1 outside (0, ${MAX_SIZE}]`);
    expect(() => slots.mint(MAX_SIZE + 1)).toThrow(
      `declared size ${MAX_SIZE + 1} outside (0, ${MAX_SIZE}]`,
    );
  });

  it("round-trips: mint → receive → consume returns the exact bytes and retires the slot", async () => {
    const { ref } = slots.mint(5);
    await slots.receive(ref, body("hello"));
    const data = await slots.consume(ref);
    expect(Buffer.from(data).toString()).toBe("hello");
    // Strictly single-use: the slot AND its staged file are gone.
    await expect(slots.consume(ref)).rejects.toThrow(SlotUnknownError);
    expect(readdirSync(stagingDir)).toEqual([]);
  });

  it("rejects receive on an unknown ref", async () => {
    await expect(slots.receive("sau_nope", body("x"))).rejects.toThrow(SlotUnknownError);
  });

  it("rejects receive on an expired ref", async () => {
    const { ref } = slots.mint(1);
    nowMs += TTL_MS + 1;
    await expect(slots.receive(ref, body("x"))).rejects.toThrow(SlotUnknownError);
  });

  it("rejects a second upload to the same ref", async () => {
    const { ref } = slots.mint(1);
    await slots.receive(ref, body("x"));
    await expect(slots.receive(ref, body("x"))).rejects.toThrow(SlotConsumedError);
  });

  it("rejects a short body, naming both sizes, and stages nothing", async () => {
    const { ref } = slots.mint(10);
    await expect(slots.receive(ref, body("short"))).rejects.toThrow(
      "upload size mismatch: received 5 bytes, declared 10",
    );
    await expect(slots.receive(ref, body("short"))).rejects.toBeInstanceOf(SizeMismatchError);
    expect(readdirSync(stagingDir)).toEqual([]);
  });

  it("rejects an over-declaration body without buffering it whole (declared+1 proof)", async () => {
    const { ref } = slots.mint(3);
    await expect(slots.receive(ref, body("longer than three"))).rejects.toThrow(
      "upload size mismatch: received 4 bytes, declared 3",
    );
  });

  it("rejects consume on a minted-but-never-uploaded ref", async () => {
    const { ref } = slots.mint(1);
    await expect(slots.consume(ref)).rejects.toThrow(SlotEmptyError);
  });

  it("rejects consume on an expired ref", async () => {
    const { ref } = slots.mint(1);
    await slots.receive(ref, body("x"));
    nowMs += TTL_MS + 1;
    await expect(slots.consume(ref)).rejects.toThrow(SlotUnknownError);
  });

  it("sweeps expired slots and their staged files on mint", async () => {
    const { ref } = slots.mint(1);
    await slots.receive(ref, body("x"));
    expect(readdirSync(stagingDir)).toHaveLength(1);
    nowMs += TTL_MS + 1;
    slots.mint(1);
    expect(readdirSync(stagingDir)).toEqual([]);
  });

  it("wipes the staging directory at construction (orphans are unreachable)", () => {
    const orphanDir = path.join(dir, "staging-with-orphans");
    mkdirSync(orphanDir, { recursive: true });
    const orphan = path.join(orphanDir, "sau_orphan.zip");
    writeFileSync(orphan, "stale bytes");
    new UploadSlots(orphanDir, TTL_MS, MAX_SIZE);
    expect(existsSync(orphan)).toBe(false);
    expect(readdirSync(orphanDir)).toEqual([]);
  });
});
