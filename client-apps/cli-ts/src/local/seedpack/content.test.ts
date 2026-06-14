import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classify, ExitCode } from "../../errors/index.js";
import {
  acquireSeedpack,
  extractSeedpack,
  hashSeedpackContent,
  listContentFiles,
  readMarker,
  resolveSeedpackContent,
  SEEDPACK_ENTRIES,
  writeMarker,
} from "./content.js";

// Build a minimal seedpack content tree with one non-canonical sibling (tools/)
// to prove the canonical-entry filtering.
function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "seedpack-content-"));
  writeFileSync(join(dir, "stigmer.yaml"), "kind: Project\n");
  mkdirSync(join(dir, "organizations"), { recursive: true });
  writeFileSync(join(dir, "organizations", "stigmer.yaml"), "kind: Organization\n");
  mkdirSync(join(dir, "skills", "demo"), { recursive: true });
  writeFileSync(join(dir, "skills", "demo", "SKILL.md"), "---\nname: demo\n---\n");
  mkdirSync(join(dir, "agents"), { recursive: true });
  writeFileSync(join(dir, "agents", "a.yaml"), "kind: Agent\n");
  // Non-canonical siblings that must never be hashed/extracted.
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, "tools", "gen.sh"), "echo hi\n");
  mkdirSync(join(dir, "icons"), { recursive: true });
  writeFileSync(join(dir, "icons", "logo.svg"), "<svg/>\n");
  return dir;
}

let fixture: string;
beforeEach(() => {
  fixture = makeFixture();
});
afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe("listContentFiles", () => {
  it("lists only canonical entries, lexically sorted", () => {
    const files = listContentFiles(fixture);
    expect(files).toEqual([
      "agents/a.yaml",
      "organizations/stigmer.yaml",
      "skills/demo/SKILL.md",
      "stigmer.yaml",
    ]);
    expect(files.some((f) => f.startsWith("tools/") || f.startsWith("icons/"))).toBe(false);
  });
});

describe("hashSeedpackContent", () => {
  it("is deterministic and sha256-prefixed", () => {
    expect(hashSeedpackContent(fixture)).toBe(hashSeedpackContent(fixture));
    expect(hashSeedpackContent(fixture)).toMatch(/^sha256:[0-9a-f]{16}$/);
  });

  it("changes when content changes but ignores non-canonical files", () => {
    const before = hashSeedpackContent(fixture);
    writeFileSync(join(fixture, "tools", "extra.sh"), "noise\n");
    expect(hashSeedpackContent(fixture)).toBe(before);
    writeFileSync(join(fixture, "agents", "b.yaml"), "kind: Agent\n");
    expect(hashSeedpackContent(fixture)).not.toBe(before);
  });
});

describe("extractSeedpack", () => {
  it("copies only canonical entries and hashes identically to the source", () => {
    const dest = mkdtempSync(join(tmpdir(), "seedpack-extract-"));
    try {
      extractSeedpack(fixture, dest);
      for (const entry of readdirSync(dest)) {
        expect(SEEDPACK_ENTRIES).toContain(entry as (typeof SEEDPACK_ENTRIES)[number]);
      }
      expect(existsSync(join(dest, "tools"))).toBe(false);
      expect(hashSeedpackContent(dest)).toBe(hashSeedpackContent(fixture));
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });
});

describe("marker", () => {
  it("round-trips and returns null when absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "seedpack-marker-"));
    try {
      expect(readMarker(dir)).toBeNull();
      writeMarker(dir, "sha256:abc123");
      expect(readMarker(dir)).toBe("sha256:abc123");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveSeedpackContent", () => {
  it("uses the repo seedpack tree in dev", () => {
    const content = resolveSeedpackContent();
    expect(content.source).toBe("repo");
    expect(existsSync(join(content.dir, "stigmer.yaml"))).toBe(true);
  });
});

describe("acquireSeedpack", () => {
  it("refuses a non-release (dev) build", () => {
    const err = (() => {
      try {
        acquireSeedpack({ home: fixture, version: "0.0.0-dev" });
      } catch (e) {
        return e;
      }
    })();
    expect(classify(err)?.exitCode).toBe(ExitCode.General);
  });

  it("installs on demand and is idempotent on the second call", () => {
    const home = mkdtempSync(join(tmpdir(), "seedpack-home-"));
    let installs = 0;
    const install = (installDir: string) => {
      installs += 1;
      const pkgDir = join(installDir, "node_modules", "@stigmer", "seedpack");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, "stigmer.yaml"), "kind: Project\n");
    };
    try {
      const dir1 = acquireSeedpack({ home, version: "1.2.3", install });
      const dir2 = acquireSeedpack({ home, version: "1.2.3", install });
      expect(dir1).toBe(dir2);
      expect(existsSync(join(dir1, "stigmer.yaml"))).toBe(true);
      expect(installs).toBe(1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
