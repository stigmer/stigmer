/**
 * Unit tests for mid-run live capture (DD-32):
 *  - `captureProgressDelta` (git-substrate) against a REAL temp git repo — the
 *    only faithful test for git plumbing (kinds, counts, binary, rename→add+del,
 *    tree-unchanged short-circuit, excludePaths).
 *  - `buildFileChangeProgress` (pure) — secret zeroing, entry cap with honest
 *    totals, aggregate sums.
 *  - `shouldCaptureProgress` (pure) — the debounce floor.
 *  - `captureFileChangeProgress` — a capture that fails is skipped, never
 *    thrown: the snapshot already attached stands, the floor is spent, one
 *    warning names the change set and the cause, and the next capture
 *    converges (over a fake substrate and over real git).
 *  - `createHybridProgressSubstrate` — the slice merge, and a slice's change
 *    carried across a capture its sibling failed.
 */

import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { FileChangeKind, FileChangeType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  captureProgressDelta,
  snapshotBaseline,
  dropCaptureRefs,
  type GitProgressEntry,
  type GitProgressDelta,
} from "../git-substrate.js";
import {
  buildFileChangeProgress,
  captureFileChangeProgress,
  createGitProgressSubstrate,
  createHybridProgressSubstrate,
  newProgressCaptureState,
  PROGRESS_MAX_ENTRIES,
  shouldCaptureProgress,
  type ProgressCapture,
  type ProgressDelta,
  type ProgressEntry,
  type ProgressSubstrate,
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

function entryFor(delta: GitProgressDelta, path: string): GitProgressEntry | undefined {
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
  function delta(entries: ProgressEntry[], totalFilesChanged?: number): ProgressDelta {
    return totalFilesChanged === undefined ? { entries } : { entries, totalFilesChanged };
  }
  function entry(
    path: string,
    added: number,
    removed: number,
    kind: FileChangeKind = FileChangeKind.MODIFY,
  ): ProgressEntry {
    return {
      pathBefore: kind === FileChangeKind.ADD ? "" : path,
      pathAfter: path,
      kind,
      linesAdded: added,
      linesRemoved: removed,
    };
  }

  it("sums aggregate counts and carries the per-entry kind through unchanged", () => {
    const progress = buildFileChangeProgress(
      delta([
        entry("a.ts", 5, 0, FileChangeKind.ADD),
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

  it("reports totalFilesChanged when a substrate capped its reads, else the entry count", () => {
    // git substrate leaves totalFilesChanged undefined -> filesChanged = entries.length.
    const gitLike = buildFileChangeProgress(delta([entry("a.ts", 1, 0)]), CHANGE_SET_ID);
    expect(gitLike.filesChanged).toBe(1);

    // cas substrate read only a bounded prefix -> filesChanged reflects the honest
    // total even though fewer entries were emitted.
    const casLike = buildFileChangeProgress(delta([entry("a.ts", 1, 0)], 7), CHANGE_SET_ID);
    expect(casLike.filesChanged).toBe(7);
    expect(casLike.entries).toHaveLength(1);
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
    const entries: ProgressEntry[] = [];
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

describe("createGitProgressSubstrate (real git repo)", () => {
  it("reports changed:true then reuses the cached full delta on an unchanged tree", async () => {
    const baseline = await snapshotBaseline(repo, EXEC_ID);
    const sub = createGitProgressSubstrate({
      workspaceRoot: repo,
      executionId: EXEC_ID,
      baselineTree: baseline,
    });

    await write("src/new.ts", "a\nb\n");
    const first = await sub.capture();
    expect(first.changed).toBe(true);
    expect(first.delta.entries.length).toBeGreaterThan(0);

    // Nothing moved since the last capture: the tree-sha short-circuits, but the
    // full delta is still returned (changed:false) so a hybrid can merge it.
    const second = await sub.capture();
    expect(second.changed).toBe(false);
    expect(second.delta.entries).toEqual(first.delta.entries);
  });
});

/** A fake substrate returning a fixed capture — for merge/short-circuit logic. */
function fakeSubstrate(capture: ProgressCapture): ProgressSubstrate {
  return { capture: () => Promise.resolve(capture) };
}

function progressEntry(path: string): ProgressEntry {
  return { pathBefore: "", pathAfter: path, kind: FileChangeKind.ADD, linesAdded: 1, linesRemoved: 0 };
}

/** A fake substrate answering one scripted step per capture: a capture, or a failure. */
function scriptedSubstrate(steps: Array<ProgressCapture | Error>): ProgressSubstrate {
  return {
    capture: () => {
      const step = steps.shift();
      if (step === undefined) throw new Error("scriptedSubstrate: more captures than scripted steps");
      return step instanceof Error ? Promise.reject(step) : Promise.resolve(step);
    },
  };
}

describe("createHybridProgressSubstrate", () => {
  it("concatenates disjoint git + cas slices and sums the honest totals", async () => {
    const git = fakeSubstrate({
      delta: { entries: [progressEntry("tracked.ts")] }, // git: total = entries.length
      changed: true,
    });
    const cas = fakeSubstrate({
      delta: { entries: [progressEntry(".env.local")], totalFilesChanged: 3 }, // cas capped
      changed: true,
    });
    const hybrid = createHybridProgressSubstrate(git, cas);

    const { delta, changed } = await hybrid.capture();
    expect(changed).toBe(true);
    expect(delta.entries.map((e) => e.pathAfter)).toEqual(["tracked.ts", ".env.local"]);
    // 1 (git entries) + 3 (cas honest total) = 4.
    expect(delta.totalFilesChanged).toBe(4);
  });

  it("still emits the full git slice when only the cas slice changed", async () => {
    // Git unchanged returns its cached full delta with changed:false; the hybrid
    // must keep it (a `ProgressDelta | undefined` contract would have dropped it).
    const git = fakeSubstrate({
      delta: { entries: [progressEntry("tracked.ts")] },
      changed: false,
    });
    const cas = fakeSubstrate({
      delta: { entries: [progressEntry("build/out.js")], totalFilesChanged: 1 },
      changed: true,
    });
    const hybrid = createHybridProgressSubstrate(git, cas);

    const { delta, changed } = await hybrid.capture();
    expect(changed).toBe(true);
    expect(delta.entries.map((e) => e.pathAfter)).toEqual(["tracked.ts", "build/out.js"]);
    expect(delta.totalFilesChanged).toBe(2);
  });

  it("reports changed:false only when NEITHER slice moved", async () => {
    const git = fakeSubstrate({ delta: { entries: [] }, changed: false });
    const cas = fakeSubstrate({ delta: { entries: [], totalFilesChanged: 0 }, changed: false });
    const hybrid = createHybridProgressSubstrate(git, cas);

    const { changed } = await hybrid.capture();
    expect(changed).toBe(false);
  });

  it("delivers the CAS slice's change on the next capture when the git slice failed the one that consumed it, once", async () => {
    // The CAS slice advances its own cache whenever it answers, so the change it
    // reported beside a failed git slice is "changed: false" from then on. The
    // tracked tree is back where it was, so git says "changed: false" too.
    const tracked = { delta: { entries: [progressEntry("tracked.ts")] }, changed: false };
    const git = scriptedSubstrate([new Error("git add failed"), tracked, tracked]);
    const cas = scriptedSubstrate([
      { delta: { entries: [progressEntry("cache/data.txt")], totalFilesChanged: 1 }, changed: true },
      { delta: { entries: [progressEntry("cache/data.txt")], totalFilesChanged: 1 }, changed: false },
      { delta: { entries: [progressEntry("cache/data.txt")], totalFilesChanged: 1 }, changed: false },
    ]);
    const hybrid = createHybridProgressSubstrate(git, cas);

    await expect(hybrid.capture(), "the failed slice fails the capture").rejects.toThrow("git add failed");
    const next = await hybrid.capture();
    expect(next.changed, "the change the failed capture consumed is delivered now").toBe(true);
    expect(next.delta.entries.map((e) => e.pathAfter)).toEqual(["tracked.ts", "cache/data.txt"]);
    const after = await hybrid.capture();
    expect(after.changed, "delivered once, then quiet again").toBe(false);
  });

  it("keeps a carried change across two failed captures in a row, then delivers it once", async () => {
    // The second failure's surviving slice reports nothing new; that must not
    // erase the change the first failure left undelivered.
    const tracked = { delta: { entries: [progressEntry("tracked.ts")] }, changed: false };
    const git = scriptedSubstrate([new Error("git add failed"), new Error("git add failed again"), tracked, tracked]);
    const ignored = { delta: { entries: [progressEntry("cache/data.txt")], totalFilesChanged: 1 } };
    const cas = scriptedSubstrate([
      { ...ignored, changed: true },
      { ...ignored, changed: false },
      { ...ignored, changed: false },
      { ...ignored, changed: false },
    ]);
    const hybrid = createHybridProgressSubstrate(git, cas);

    await expect(hybrid.capture()).rejects.toThrow("git add failed");
    await expect(hybrid.capture()).rejects.toThrow("git add failed again");
    const next = await hybrid.capture();
    expect(next.changed, "the change the first failure consumed survives the second").toBe(true);
    expect(next.delta.entries.map((e) => e.pathAfter)).toEqual(["tracked.ts", "cache/data.txt"]);
    expect((await hybrid.capture()).changed, "delivered once, then quiet again").toBe(false);
  });

  it("delivers the git slice's change on the next capture when the CAS slice failed the one that consumed it, once", async () => {
    const tracked = { delta: { entries: [progressEntry("tracked.ts")] } };
    const git = scriptedSubstrate([{ ...tracked, changed: true }, { ...tracked, changed: false }, { ...tracked, changed: false }]);
    const quiet = { delta: { entries: [], totalFilesChanged: 0 }, changed: false };
    const cas = scriptedSubstrate([new Error("observations unreadable"), quiet, quiet]);
    const hybrid = createHybridProgressSubstrate(git, cas);

    await expect(hybrid.capture()).rejects.toThrow("observations unreadable");
    const next = await hybrid.capture();
    expect(next.changed, "the change the failed capture consumed is delivered now").toBe(true);
    expect(next.delta.entries.map((e) => e.pathAfter)).toEqual(["tracked.ts"]);
    expect((await hybrid.capture()).changed, "delivered once, then quiet again").toBe(false);
  });
});

describe("captureFileChangeProgress: a failed capture is skipped, never thrown", () => {
  it("leaves the attached snapshot in place, spends the floor, and warns once with the change set and the cause", async () => {
    const status = create(AgentExecutionStatusSchema, {});
    const state = newProgressCaptureState();
    const substrate = scriptedSubstrate([
      { delta: { entries: [progressEntry("a.ts")] }, changed: true },
      new Error("Command failed: git add -A -- .\nerror: short read while indexing a.ts"),
    ]);
    await captureFileChangeProgress({ status, changeSetId: CHANGE_SET_ID, substrate, state, nowMs: 10_000 });
    const attached = status.fileChangeProgress;
    expect(attached?.filesChanged).toBe(1);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(
        captureFileChangeProgress({ status, changeSetId: CHANGE_SET_ID, substrate, state, nowMs: 20_000 }),
        "a failed capture resolves: the persist it rides must not fail",
      ).resolves.toBeUndefined();
      expect(status.fileChangeProgress, "the snapshot already attached stands").toBe(attached);
      expect(state.lastAtMs, "a failed capture spends the floor, so a persistent failure costs one attempt per interval").toBe(20_000);
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0]![0]);
      expect(line).toContain(`changeSet=${CHANGE_SET_ID}`);
      expect(line).toContain("short read while indexing a.ts");
    } finally {
      warn.mockRestore();
    }
  });

  it("over real git, a file git cannot read fails the substrate; the capture is skipped and the next one converges", async () => {
    // Root reads a mode-000 file, so git add would succeed and this case would
    // prove nothing: it refuses to run as root rather than pass vacuously.
    expect(process.getuid?.(), "this case needs a non-root user (root can read a mode-000 file)").not.toBe(0);
    const baseline = await snapshotBaseline(repo, EXEC_ID);
    const substrate = createGitProgressSubstrate({ workspaceRoot: repo, executionId: EXEC_ID, baselineTree: baseline });
    const status = create(AgentExecutionStatusSchema, {});
    const state = newProgressCaptureState();
    await write("src/new.ts", "a\nb\n");
    await write("keep.txt", "line1\nLINE2\nline3\n");
    const keep = join(repo, "keep.txt");
    await chmod(keep, 0o000);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await captureFileChangeProgress({ status, changeSetId: CHANGE_SET_ID, substrate, state, nowMs: 10_000 });
      expect(status.fileChangeProgress, "nothing is attached from a capture that failed").toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0]), "the warning carries git's own reason").toContain("unable to index file");

      await chmod(keep, 0o644);
      await captureFileChangeProgress({ status, changeSetId: CHANGE_SET_ID, substrate, state, nowMs: 20_000 });
      const entries = status.fileChangeProgress?.entries.map((e) => [e.pathAfter, e.kind, e.linesAdded, e.linesRemoved]);
      expect(entries, "the next capture converges to both edits").toEqual([
        ["keep.txt", FileChangeKind.MODIFY, 1, 1],
        ["src/new.ts", FileChangeKind.ADD, 2, 0],
      ]);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      await chmod(keep, 0o644);
      warn.mockRestore();
    }
  });
});
