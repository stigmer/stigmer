/**
 * Unit tests for the Cursor mid-run progress substrate selection (DD-33) —
 * `buildCursorProgressSubstrate`. This is the Cursor adapter's responsibility:
 * pick git / non-git CAS / hybrid for the turn's workspace shape (the CAS + git
 * capture behaviors themselves are covered in shared/filereview/__tests__).
 *
 * The chosen substrate is driven against a real temp workspace to prove WHICH
 * kind was built: a git-only substrate surfaces the tracked change; a hybrid adds
 * the (empty here) CAS slice; a non-git substrate reads the (empty) hook sidecar
 * without touching git.
 */

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCursorProgressSubstrate } from "../capture-flow.js";
import { snapshotBaseline, dropCaptureRefs } from "../../../shared/filereview/git-substrate.js";
import { makeInMemoryArtifactStorage } from "../../../__test-utils__/fake-artifact-storage.js";

const execFileAsync = promisify(execFile);
const EXEC_ID = "exec-cursor-progress";

let repo: string;
let hitlDir: string;

async function git(args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: repo });
}

async function write(rel: string, content: string): Promise<void> {
  await mkdir(join(repo, rel, ".."), { recursive: true });
  await writeFile(join(repo, rel), content, "utf-8");
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "cursor-progress-"));
  hitlDir = await mkdtemp(join(tmpdir(), "cursor-progress-hitl-"));
  await git(["init", "-q"]);
  await git(["config", "user.email", "t@t.local"]);
  await git(["config", "user.name", "t"]);
  await write("src/main.ts", "export const x = 1;\n");
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "initial"]);
});

afterEach(async () => {
  await dropCaptureRefs(repo, EXEC_ID).catch(() => {});
  await rm(repo, { recursive: true, force: true });
  await rm(hitlDir, { recursive: true, force: true });
});

describe("buildCursorProgressSubstrate — selection", () => {
  it("returns undefined outside capture mode", () => {
    const sub = buildCursorProgressSubstrate({
      captureMode: false,
      gitWorkspace: true,
      workspaceRoot: repo,
      baselineTree: "sha",
      executionId: EXEC_ID,
      hitlDir,
      storage: undefined,
    });
    expect(sub).toBeUndefined();
  });

  it("returns undefined with no workspace root", () => {
    const sub = buildCursorProgressSubstrate({
      captureMode: true,
      gitWorkspace: true,
      workspaceRoot: undefined,
      baselineTree: "sha",
      executionId: EXEC_ID,
      hitlDir,
      storage: undefined,
    });
    expect(sub).toBeUndefined();
  });

  it("returns undefined for a git tree with no baseline tree yet", () => {
    const sub = buildCursorProgressSubstrate({
      captureMode: true,
      gitWorkspace: true,
      workspaceRoot: repo,
      baselineTree: undefined,
      executionId: EXEC_ID,
      hitlDir,
      storage: undefined,
    });
    expect(sub).toBeUndefined();
  });

  it("returns undefined for a non-git workspace with no storage/sidecar", () => {
    const sub = buildCursorProgressSubstrate({
      captureMode: true,
      gitWorkspace: false,
      workspaceRoot: repo,
      baselineTree: undefined,
      executionId: EXEC_ID,
      hitlDir: undefined,
      storage: undefined,
    });
    expect(sub).toBeUndefined();
  });

  it("builds a git-only substrate (no storage) that surfaces the tracked change", async () => {
    const baselineTree = await snapshotBaseline(repo, EXEC_ID);
    const sub = buildCursorProgressSubstrate({
      captureMode: true,
      gitWorkspace: true,
      workspaceRoot: repo,
      baselineTree,
      executionId: EXEC_ID,
      hitlDir,
      storage: undefined,
    });
    expect(sub).toBeDefined();

    await write("src/main.ts", "export const x = 2;\nexport const y = 3;\n");
    const { delta, changed } = await sub!.capture();
    expect(changed).toBe(true);
    expect(delta.entries.some((e) => e.pathAfter === "src/main.ts")).toBe(true);
  });

  it("builds a hybrid substrate (git + storage) surfacing the git slice + empty CAS", async () => {
    const baselineTree = await snapshotBaseline(repo, EXEC_ID);
    const { storage } = makeInMemoryArtifactStorage();
    const sub = buildCursorProgressSubstrate({
      captureMode: true,
      gitWorkspace: true,
      workspaceRoot: repo,
      baselineTree,
      executionId: EXEC_ID,
      hitlDir,
      storage,
    });
    expect(sub).toBeDefined();

    await write("src/main.ts", "export const x = 9;\n");
    const { delta } = await sub!.capture();
    // The git slice contributes the tracked change; the CAS sidecar is empty, so
    // it adds nothing — total equals the git entries.
    expect(delta.entries.some((e) => e.pathAfter === "src/main.ts")).toBe(true);
    expect(delta.totalFilesChanged).toBe(delta.entries.length);
  });

  it("builds a non-git CAS substrate that reads the (empty) sidecar without git", async () => {
    const { storage } = makeInMemoryArtifactStorage();
    const sub = buildCursorProgressSubstrate({
      captureMode: true,
      gitWorkspace: false,
      workspaceRoot: repo,
      baselineTree: undefined,
      executionId: EXEC_ID,
      hitlDir,
      storage,
    });
    expect(sub).toBeDefined();

    // Even with a git change on disk, the non-git substrate ignores git entirely;
    // the sidecar is empty, so it reports zero changed files.
    await write("src/main.ts", "export const x = 42;\n");
    const { delta } = await sub!.capture();
    expect(delta.totalFilesChanged).toBe(0);
    expect(delta.entries).toHaveLength(0);
  });
});
