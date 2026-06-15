import { appendFileSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { followFile, tailLines } from "./tail.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stigmer-tail-"));
});

describe("tailLines", () => {
  it("returns the last n lines, ignoring a trailing newline", () => {
    const file = join(dir, "a.log");
    writeFileSync(file, "l1\nl2\nl3\nl4\n");
    expect(tailLines(file, 2)).toEqual(["l3", "l4"]);
    expect(tailLines(file, 0)).toEqual(["l1", "l2", "l3", "l4"]);
    expect(tailLines(file, 10)).toEqual(["l1", "l2", "l3", "l4"]);
  });

  it("returns empty for a missing file", () => {
    expect(tailLines(join(dir, "nope.log"), 5)).toEqual([]);
  });
});

describe("followFile", () => {
  const tick = () => vi.advanceTimersByTimeAsync(250);

  beforeEach(() => {
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  it("emits only newly appended lines", async () => {
    const file = join(dir, "f.log");
    writeFileSync(file, "old\n");
    const seen: string[] = [];
    const handle = followFile(file, (line) => seen.push(line), { pollMs: 200 });

    appendFileSync(file, "new1\nnew2\n");
    await tick();
    expect(seen).toEqual(["new1", "new2"]);
    handle.stop();
  });

  it("reopens after rotation (inode change)", async () => {
    const file = join(dir, "r.log");
    writeFileSync(file, "before\n");
    const seen: string[] = [];
    const handle = followFile(file, (line) => seen.push(line), { pollMs: 200 });

    // Rotate: move the file aside and create a fresh one in its place.
    renameSync(file, join(dir, "r.log.1"));
    writeFileSync(file, "after-rotate\n");
    await tick();

    expect(seen).toContain("after-rotate");
    handle.stop();
  });

  it("with fromStart, emits existing content too", async () => {
    const file = join(dir, "s.log");
    writeFileSync(file, "existing\n");
    const seen: string[] = [];
    const handle = followFile(file, (line) => seen.push(line), { pollMs: 200, fromStart: true });
    await tick();
    expect(seen).toContain("existing");
    handle.stop();
  });
});
