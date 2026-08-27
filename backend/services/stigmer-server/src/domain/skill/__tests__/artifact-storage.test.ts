/**
 * Pins the skill artifact store against Go's artifact_storage_test.go:
 * path layout ({root}/skills/{hash}.zip — cutover inherits Go-written
 * directories), permissions, traversal-guarded reads, and the dedupe
 * surface (exists/getStorageKey). Since O5 the store is the domain port
 * over the local blob driver — the assertions are UNCHANGED from the
 * pre-reconciliation class on purpose: they are the byte-identity proof.
 */
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import {
  ArtifactNotFoundError,
  newSkillArtifactStorage,
} from "../storage/artifact-storage.js";
import type { SkillArtifactStorage } from "../storage/artifact-storage.js";

const HASH = "a".repeat(64);
const DATA = new TextEncoder().encode("zip bytes");

let dir: string;
let storage: SkillArtifactStorage;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "skill-artifact-test-"));
  // Mirrors the compose local arm (boot/compose.ts): skills/ boot-created
  // 0755 (the Go layout invariant), the driver rooted at the storage path,
  // the port owning keys and the not-found vocabulary.
  mkdirSync(path.join(dir, "skills"), { recursive: true, mode: 0o755 });
  storage = newSkillArtifactStorage(new LocalArtifactStorage(dir, ""));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("skill artifact store over the local driver", () => {
  it("stores under skills/{hash}.zip — a LITERAL forward-slash key on every platform — and round-trips the bytes", async () => {
    const key = await storage.store(HASH, DATA);
    expect(key).toBe(`skills/${HASH}.zip`);
    expect(await storage.get(key)).toEqual(Buffer.from(DATA));
  });

  it("writes artifacts owner-only (0600) under a 0755 directory", async () => {
    const key = await storage.store(HASH, DATA);
    const mode = statSync(path.join(dir, key)).mode & 0o777;
    expect(mode).toBe(0o600);
    const dirMode = statSync(path.join(dir, "skills")).mode & 0o777;
    expect(dirMode).toBe(0o755);
  });

  it("reports existence by hash for dedupe", async () => {
    expect(await storage.exists(HASH)).toBe(false);
    await storage.store(HASH, DATA);
    expect(await storage.exists(HASH)).toBe(true);
  });

  it("stats size without loading", async () => {
    const key = await storage.store(HASH, DATA);
    expect(await storage.size(key)).toBe(DATA.length);
  });

  it("answers not-found for a missing key", async () => {
    await expect(storage.get("skills/missing.zip")).rejects.toThrow(
      new ArtifactNotFoundError("skills/missing.zip").message,
    );
    await expect(storage.size("skills/missing.zip")).rejects.toThrow(
      "artifact not found: skills/missing.zip",
    );
  });

  it("treats traversal keys as missing artifacts, never reading escaped paths", async () => {
    for (const key of ["../../etc/passwd", "skills/../../secret", "/etc/passwd"]) {
      await expect(storage.get(key)).rejects.toThrow(`artifact not found: ${key}`);
      await expect(storage.size(key)).rejects.toThrow(`artifact not found: ${key}`);
    }
  });
});
