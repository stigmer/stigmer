/**
 * Pins the platform folder's hold to one turn's mounts (`../platform-hold.ts`):
 * a skill or a plugin an earlier turn mounted and this turn did not is gone,
 * and so is a cached archive this turn did not use (an earlier runner's
 * `plugins/<digest>.zip` included), while this turn's, the File mount's
 * uploads, the outputs folder, an eval case's inputs and every plugin's data
 * stay. Where the runner does not separate there are no runner-owned trees
 * to hold.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { holdPlatformMounts, NO_MOUNTS } from "../platform-hold.js";

let platform: string;

function place(path: string): void {
  mkdirSync(join(platform, path, ".."), { recursive: true });
  writeFileSync(join(platform, path), "x");
}

beforeEach(() => {
  platform = mkdtempSync(join(tmpdir(), "platform-hold-"));
  place("skills/kept/SKILL.md");
  place("skills/dropped/SKILL.md");
  place("plugins/aaa/hooks/hooks.json");
  place("plugins/aaa.zip");
  place("plugins/bbb/skills/x/SKILL.md");
  place("plugins/bbb.zip");
  place(`archives/${"a".repeat(64)}.zip`);
  place(`archives/${"b".repeat(64)}.zip`);
  place("plugin-data/old-plugin/state.json");
  place("uploads/brief.pdf");
  place("outputs/report.md");
  place("inputs/case-1/reference.txt");
  place("uploads.index.json");
});

afterEach(() => {
  rmSync(platform, { recursive: true, force: true });
});

describe("holdPlatformMounts", () => {
  it("removes the skills and plugins this turn did not mount, and nothing else", async () => {
    await holdPlatformMounts("ses-1", platform, { skills: ["kept"], plugins: ["aaa"], archives: ["a".repeat(64)], trees: [] });

    expect(readdirSync(join(platform, "skills"))).toEqual(["kept"]);
    expect(readdirSync(join(platform, "plugins")).sort()).toEqual(["aaa"]);
    expect(readdirSync(join(platform, "archives"))).toEqual([`${"a".repeat(64)}.zip`]);
    expect(readdirSync(platform).sort()).toEqual(
      ["archives", "inputs", "outputs", "plugin-data", "plugins", "skills", "uploads", "uploads.index.json"].sort(),
    );
    expect(readdirSync(join(platform, "plugin-data"))).toEqual(["old-plugin"]);
  });

  it("empties all three on a turn that mounted none, and is quiet when no folder exists", async () => {
    await holdPlatformMounts("ses-1", platform, NO_MOUNTS);
    expect(readdirSync(join(platform, "skills"))).toEqual([]);
    expect(readdirSync(join(platform, "plugins"))).toEqual([]);
    expect(readdirSync(join(platform, "archives"))).toEqual([]);

    const bare = mkdtempSync(join(tmpdir(), "platform-hold-bare-"));
    try {
      await expect(holdPlatformMounts("ses-1", bare, NO_MOUNTS)).resolves.toBeUndefined();
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
