import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contentDir, contentHash, extractToDir, listContentFiles, SEEDPACK_ENTRIES } from "./index.js";

describe("contentDir", () => {
  it("resolves a directory containing stigmer.yaml", () => {
    expect(existsSync(join(contentDir(), "stigmer.yaml"))).toBe(true);
  });
});

describe("listContentFiles", () => {
  it("includes the project manifest and known resources, lexically sorted", () => {
    const files = listContentFiles();
    expect(files).toContain("stigmer.yaml");
    expect(files).toContain("organizations/stigmer.yaml");
    expect(files.some((f) => f.startsWith("skills/") && f.endsWith("/SKILL.md"))).toBe(true);
    expect(files.some((f) => f.startsWith("agents/"))).toBe(true);
    expect([...files]).toEqual([...files].sort());
  });

  it("only lists files under the canonical entries (no tools/, icons/, or canary/)", () => {
    const files = listContentFiles();
    expect(files.some((f) => f.startsWith("tools/"))).toBe(false);
    expect(files.some((f) => f.startsWith("icons/"))).toBe(false);
    expect(files.some((f) => f.startsWith("canary/"))).toBe(false);
    // The CI canary manifest is a non-resource (no kind); it must never enter the
    // content set, or the declarative-apply bootstrap rejects it as kind-less.
    expect(files.some((f) => f.endsWith("credential-manifest.yaml"))).toBe(false);
  });
});

describe("contentHash", () => {
  it("is deterministic and sha256-prefixed", () => {
    expect(contentHash()).toBe(contentHash());
    expect(contentHash()).toMatch(/^sha256:[0-9a-f]{16}$/);
  });
});

describe("extractToDir", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  // The seedpack carries hundreds of files (fonts, multi-language references), so
  // a full recursive copy + double hash is I/O-heavy; allow generous headroom.
  it("extracts a clean project of only the canonical entries", () => {
    dir = mkdtempSync(join(tmpdir(), "seedpack-extract-"));
    extractToDir(dir);

    expect(existsSync(join(dir, "stigmer.yaml"))).toBe(true);
    const top = readdirSync(dir).sort();
    for (const entry of top) {
      expect(SEEDPACK_ENTRIES).toContain(entry as (typeof SEEDPACK_ENTRIES)[number]);
    }
    // An extracted copy hashes identically to the source.
    expect(contentHash(dir)).toBe(contentHash());
  }, 60_000);
});
