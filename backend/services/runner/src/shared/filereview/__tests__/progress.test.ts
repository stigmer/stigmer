/**
 * Unit tests for mid-run live capture (DD-32):
 *  - `captureProgressDelta` (git-substrate) against a REAL temp git repo — the
 *    only faithful test for git plumbing (kinds, counts, binary, rename→add+del,
 *    tree-unchanged short-circuit, excludePaths).
 *  - `buildFileChangeProgress` (pure) — secret zeroing, entry cap with honest
 *    totals, aggregate sums.
 *  - `shouldCaptureProgress` (pure) — the debounce floor.
 */

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { FileChangeKind, FileChangeType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  captureProgressDelta,
  snapshotBaseline,
  dropCaptureRefs,
  type GitProgressEntry,
  type ProgressDelta,
} from "../git-substrate.js";
import {
  buildFileChangeProgress,
  PROGRESS_MAX_ENTRIES,
  shouldCaptureProgress,
} from "../progress.js";

const execFileAsync = promisify(execFile);
const EXEC_ID = "exec-progress-1";
const CHANGE_SET_ID = "exec-progress-1:0";
const RUNNER_OWNED_PATHS: readonly string[] = [".cursor/hooks.json"];

let repo: string;

async function git(args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: repo });
}

async function write(rel: string, content: string): Promise<void> {
  await mkdir(join(repo, rel, ".."), { recursive: true });
  await writeFile(join(repo, rel), content, "utf-8");
}

async function writeBytes(rel: string, bytes: Uint8Array): Promise<void> {
  await mkdir(join(repo, rel, ".."), { recursive: true });
  await writeFile(join(repo, rel), bytes);
}

function entryFor(delta: ProgressDelta, path: string): GitProgressEntry | undefined {
  return delta.entries.find((e) => e.pathAfter === path || e.pathBefore === path);
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "stigmer-progress-"));
  await git(["init", "-q"]);
  await git(["config", "user.email", "t@t.local"]);
  await git(["config", "user.name", "t"]);
  await write("src/main.ts", "export const x = 1;\n");
  await write("keep.txt", "line1\nline2\nline3\n");
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "initial"]);
});

afterEach(async () => {
  await dropCaptureRefs(repo, EXEC_ID).catch(() => {});
  await rm(repo, { recursive: true, force: true });
});

describe("captureProgressDelta (real git repo)", () => {
  it("reports ADD / MODIFY / DELETE with line counts and honest path sides", async () => {
    const baseline = await snapshotBaseline(repo, EXEC_ID);

    await write("src/new.ts", "a\nb\nc\n"); // ADD (3 added)
    await write("src/main.ts", "export const x = 2;\nexport const y = 3;\n"); // MODIFY
    await rm(join(repo, "keep.txt")); // DELETE (3 removed)

    const delta = await captureProgressDelta(repo, EXEC_ID, baseline);
    expect(delta).toBeDefined();
    expect(delta!.entries).toHaveLength(3);

    const added = entryFor(delta!, "src/new.ts")!;
    expect(added.changeType).toBe(FileChangeType.CREATE);
    expect(added.pathBefore).toBe("");
    expect(added.pathAfter).toBe("src/new.ts");
    expect(added.linesAdded).toBe(3);
    expect(added.linesRemoved).toBe(0);

    const modified = entryFor(delta!, "src/main.ts")!;
    expect(modified.changeType).toBe(FileChangeType.MODIFY);
    expect(modified.pathBefore).toBe("src/main.ts");
    expect(modified.pathAfter).toBe("src/main.ts");
    expect(modified.linesAdded).toBeGreaterThan(0);

    const deleted = entryFor(delta!, "keep.txt")!;
    expect(deleted.changeType).toBe(FileChangeType.DELETE);
    expect(deleted.pathBefore).toBe("keep.txt");
    expect(deleted.pathAfter).toBe("");
    expect(deleted.linesRemoved).toBe(3);
    expect(deleted.linesAdded).toBe(0);
  });

  it("surfaces a binary change with zero counts (numstat reports '-')", async () => {
    const baseline = await snapshotBaseline(repo, EXEC_ID);
    await writeBytes("blob.bin", new Uint8Array([0, 1, 2, 0, 255, 0, 3]));

    const delta = await captureProgressDelta(repo, EXEC_ID, baseline);
    const bin = entryFor(delta!, "blob.bin")!;
    expect(bin.changeType).toBe(FileChangeType.CREATE);
    expect(bin.linesAdded).toBe(0);
    expect(bin.linesRemoved).toBe(0);
  });

  it("splits a rename into a delete + create (--no-renames)", async () => {
    const baseline = await snapshotBaseline(repo, EXEC_ID);
    await rm(join(repo, "keep.txt"));
    await write("renamed.txt", "line1\nline2\nline3\n");

    const delta = await captureProgressDelta(repo, EXEC_ID, baseline);
    expect(entryFor(delta!, "keep.txt")!.changeType).toBe(FileChangeType.DELETE);
    expect(entryFor(delta!, "renamed.txt")!.changeType).toBe(FileChangeType.CREATE);
  });

  it("short-circuits (returns undefined) when the tree is unchanged since lastTreeSha", async () => {
    const baseline = await snapshotBaseline(repo, EXEC_ID);
    await write("src/new.ts", "a\nb\n");

    const first = await captureProgressDelta(repo, EXEC_ID, baseline);
    expect(first).toBeDefined();

    const second = await captureProgressDelta(repo, EXEC_ID, baseline, [], first!.afterTree);
    expect(second).toBeUndefined();
  });

  it("recomputes (0 entries) after the agent reverts its own edits", async () => {
    const baseline = await snapshotBaseline(repo, EXEC_ID);
    await write("src/new.ts", "a\nb\n");
    const first = await captureProgressDelta(repo, EXEC_ID, baseline);

    await rm(join(repo, "src/new.ts")); // revert to clean
    const second = await captureProgressDelta(repo, EXEC_ID, baseline, [], first!.afterTree);
    expect(second).toBeDefined();
    expect(second!.entries).toHaveLength(0);
  });

  it("excludes runner-owned gate files from the delta", async () => {
    const baseline = await snapshotBaseline(repo, EXEC_ID, RUNNER_OWNED_PATHS);
    await write(".cursor/hooks.json", "{}\n");
    await write("real.ts", "x\n");

    const delta = await captureProgressDelta(repo, EXEC_ID, baseline, RUNNER_OWNED_PATHS);
    expect(entryFor(delta!, ".cursor/hooks.json")).toBeUndefined();
    expect(entryFor(delta!, "real.ts")).toBeDefined();
  });
});

describe("buildFileChangeProgress (pure)", () => {
  function delta(entries: GitProgressEntry[]): ProgressDelta {
    return { afterTree: "tree-sha", entries };
  }
  function entry(path: string, added: number, removed: number): GitProgressEntry {
    return {
      pathBefore: path,
      pathAfter: path,
      changeType: FileChangeType.MODIFY,
      linesAdded: added,
      linesRemoved: removed,
    };
  }

  it("sums aggregate counts and maps kind", () => {
    const progress = buildFileChangeProgress(
      delta([
        { pathBefore: "", pathAfter: "a.ts", changeType: FileChangeType.CREATE, linesAdded: 5, linesRemoved: 0 },
        entry("b.ts", 2, 3),
      ]),
      CHANGE_SET_ID,
    );
    expect(progress.changeSetId).toBe(CHANGE_SET_ID);
    expect(progress.filesChanged).toBe(2);
    expect(progress.linesAdded).toBe(7);
    expect(progress.linesRemoved).toBe(3);
    expect(progress.entries[0].kind).toBe(FileChangeKind.ADD);
    expect(progress.entries[1].kind).toBe(FileChangeKind.MODIFY);
    expect(progress.capturedAt).not.toBe("");
  });

  it("zeroes counts for secret-like paths (path visible, magnitude withheld)", () => {
    const progress = buildFileChangeProgress(
      delta([entry(".env", 10, 2), entry("app.ts", 4, 1)]),
      CHANGE_SET_ID,
    );
    // The secret path is still counted as a changed file and its path is present…
    expect(progress.filesChanged).toBe(2);
    const secret = progress.entries.find((e) => e.pathAfter === ".env")!;
    expect(secret.linesAdded).toBe(0);
    expect(secret.linesRemoved).toBe(0);
    // …but its magnitude is excluded from the aggregate.
    expect(progress.linesAdded).toBe(4);
    expect(progress.linesRemoved).toBe(1);
  });

  it("caps entries but keeps files_changed and totals honest over all files", () => {
    const entries: GitProgressEntry[] = [];
    for (let i = 0; i < PROGRESS_MAX_ENTRIES + 25; i++) {
      entries.push(entry(`f${i}.ts`, 1, 1));
    }
    const progress = buildFileChangeProgress(delta(entries), CHANGE_SET_ID);
    expect(progress.entries).toHaveLength(PROGRESS_MAX_ENTRIES);
    expect(progress.filesChanged).toBe(PROGRESS_MAX_ENTRIES + 25);
    expect(progress.linesAdded).toBe(PROGRESS_MAX_ENTRIES + 25);
    expect(progress.linesRemoved).toBe(PROGRESS_MAX_ENTRIES + 25);
  });

  it("produces a zero-file snapshot for an empty delta (revert-to-clean)", () => {
    const progress = buildFileChangeProgress(delta([]), CHANGE_SET_ID);
    expect(progress.filesChanged).toBe(0);
    expect(progress.entries).toHaveLength(0);
  });
});

describe("shouldCaptureProgress (pure)", () => {
  it("always captures on the first call (lastAtMs = 0, real clock)", () => {
    // The caller starts a fresh turn with lastAtMs = 0 and now = Date.now(),
    // which is always far past any floor.
    expect(shouldCaptureProgress(0, Date.now(), 2000)).toBe(true);
  });

  it("gates within the floor and allows once it elapses", () => {
    expect(shouldCaptureProgress(1000, 2500, 2000)).toBe(false);
    expect(shouldCaptureProgress(1000, 3000, 2000)).toBe(true);
    expect(shouldCaptureProgress(1000, 3001, 2000)).toBe(true);
  });
});
