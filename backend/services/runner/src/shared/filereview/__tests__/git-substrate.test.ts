/**
 * @regression file-hitl-phase0 — pins file-edit HITL fixes #7, #8 (see _projects/2026-06/20260630.01.file-change-hitl-redesign/tasks/T01_3_regression-manifest.md)
 *
 * Unit tests for the git snapshot/restore capture substrate (the PRIMITIVES:
 * snapshot / capture / restore / apply / recompute / drop).
 *
 * These run against a REAL temporary git repo (the behavior is entirely git
 * plumbing, so a real repo is the only faithful test). They exercise each
 * primitive directly — restoreToBaseline and applyApprovedPaths are the
 * reconcile pair the resume path composes (capture mode leaves the tree applied
 * during review and reconciles to the refs on resume) — plus the hard invariants
 * (the `.stigmer` SDK state and gitignored paths survive; the harness's
 * runner-owned files, passed as excludePaths, never pollute the diff).
 */

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileChangeType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  applyApprovedPaths,
  captureChangeSet,
  dropCaptureRefs,
  isGitWorkTree,
  isPathCapturable,
  recomputeChangeSet,
  restoreToBaseline,
  snapshotBaseline,
} from "../git-substrate.js";
import { sha256Bytes } from "../digest.js";

const execFileAsync = promisify(execFile);

const EXEC_ID = "exec-test-1";

/** The runner-owned files a harness (here, Cursor) writes into the workspace. */
const RUNNER_OWNED_PATHS: readonly string[] = [
  ".cursor/hooks.json",
  ".cursor/rules/stigmer-tool-approval.mdc",
];

let repo: string;

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: repo });
  return stdout;
}

async function exists(rel: string): Promise<boolean> {
  try {
    await stat(join(repo, rel));
    return true;
  } catch {
    return false;
  }
}

async function read(rel: string): Promise<string> {
  return readFile(join(repo, rel), "utf-8");
}

async function write(rel: string, content: string): Promise<void> {
  await mkdir(join(repo, rel, ".."), { recursive: true });
  await writeFile(join(repo, rel), content, "utf-8");
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "stigmer-substrate-"));
  await git(["init", "-q"]);
  await git(["config", "user.email", "t@t.local"]);
  await git(["config", "user.name", "t"]);
  // A committed baseline file so HEAD exists and we can exercise modify/delete.
  await write("src/main.ts", "export const x = 1;\n");
  await write("notes.md", "platon notes\n");
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "initial"]);
  // A gitignored path and the SDK-state dir that MUST survive capture/restore.
  await write(".gitignore", ".env\n.stigmer/\n");
  await git(["add", ".gitignore"]);
  await git(["commit", "-q", "-m", "gitignore"]);
  // .stigmer is added to .git/info/exclude in production (git.ts); replicate so
  // the test mirrors the real exclude surface.
  await write(".git/info/exclude", ".stigmer\nlost+found\n");
  await mkdir(join(repo, ".stigmer", "cursor-sdk-state"), { recursive: true });
  await writeFile(join(repo, ".stigmer", "cursor-sdk-state", "db.sqlite"), "STATE", "utf-8");
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("isGitWorkTree", () => {
  it("returns true inside a repo and false outside", async () => {
    expect(await isGitWorkTree(repo)).toBe(true);
    const plain = await mkdtemp(join(tmpdir(), "stigmer-plain-"));
    try {
      expect(await isGitWorkTree(plain)).toBe(false);
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });
});

describe("capture lifecycle", () => {
  it("captures create+modify+delete, restores to baseline, and nothing lands until apply", async () => {
    const baseline = await snapshotBaseline(repo, EXEC_ID);

    // Agent makes a full turn's worth of edits.
    await write("notes.md", "planton notes\n\n## TODO\n- ship it\n"); // modify
    await write("src/new.ts", "export const y = 2;\n"); // create
    await rm(join(repo, "src/main.ts"), { force: true }); // delete

    const { changes } = await captureChangeSet(repo, EXEC_ID, baseline);

    const byPath = new Map(changes.map((c) => [c.path, c]));
    expect(byPath.get("notes.md")?.changeType).toBe(FileChangeType.MODIFY);
    expect(byPath.get("src/new.ts")?.changeType).toBe(FileChangeType.CREATE);
    expect(byPath.get("src/main.ts")?.changeType).toBe(FileChangeType.DELETE);

    // The capture carries the true before/after net change (text, inline) with a
    // byte-true content address (for valid UTF-8, equal to the utf-8 hash).
    const beforeText = "platon notes\n";
    const afterText = "planton notes\n\n## TODO\n- ship it\n";
    const notes = byPath.get("notes.md")!;
    expect(notes.before).toEqual({
      kind: "inline",
      text: beforeText,
      sha256: sha256Bytes(Buffer.from(beforeText, "utf8")),
    });
    expect(notes.after).toEqual({
      kind: "inline",
      text: afterText,
      sha256: sha256Bytes(Buffer.from(afterText, "utf8")),
    });

    // Restore: the working tree is byte-identical to pre-turn (nothing landed).
    await restoreToBaseline(repo, baseline, changes);
    expect(await read("notes.md")).toBe("platon notes\n");
    expect(await read("src/main.ts")).toBe("export const x = 1;\n");
    expect(await exists("src/new.ts")).toBe(false);
  });

  it("applies only the approved subset; rejected files stay at baseline", async () => {
    const baseline = await snapshotBaseline(repo, EXEC_ID);
    await write("notes.md", "planton notes\n");
    await write("src/main.ts", "export const x = 99;\n");
    const { afterTree, changes } = await captureChangeSet(repo, EXEC_ID, baseline);
    await restoreToBaseline(repo, baseline, changes);

    // Approve notes.md only; reject src/main.ts.
    const approved = changes.filter((c) => c.path === "notes.md");
    await applyApprovedPaths(repo, afterTree, approved);

    expect(await read("notes.md")).toBe("planton notes\n"); // applied
    expect(await read("src/main.ts")).toBe("export const x = 1;\n"); // untouched
  });

  it("applies an approved create and an approved delete", async () => {
    const baseline = await snapshotBaseline(repo, EXEC_ID);
    await write("src/new.ts", "export const y = 2;\n"); // create
    await rm(join(repo, "src/main.ts"), { force: true }); // delete
    const { afterTree, changes } = await captureChangeSet(repo, EXEC_ID, baseline);
    await restoreToBaseline(repo, baseline, changes);

    await applyApprovedPaths(repo, afterTree, changes); // approve all
    expect(await read("src/new.ts")).toBe("export const y = 2;\n");
    expect(await exists("src/main.ts")).toBe(false);
  });
});

describe("binary content identity + reconcile", () => {
  // Non-UTF-8 bytes: a NUL (triggers binary detection) plus high bytes
  // (0xFF/0xFE/0x80) a lossy UTF-8 decode would mangle — so a lossy hash of these
  // would differ from the true byte hash.
  const BIN_V1 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x80, 0x01]);
  const BIN_V2 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x00, 0x42, 0x99, 0x7f]);

  async function writeBytes(rel: string, bytes: Buffer): Promise<void> {
    await mkdir(join(repo, rel, ".."), { recursive: true });
    await writeFile(join(repo, rel), bytes);
  }
  async function readBytes(rel: string): Promise<Buffer> {
    return readFile(join(repo, rel));
  }

  it("captures a binary side as a body-less, byte-true content address", async () => {
    const baseline = await snapshotBaseline(repo, EXEC_ID);
    await writeBytes("assets/logo.png", BIN_V1); // create a binary file

    const { changes } = await captureChangeSet(repo, EXEC_ID, baseline);
    const change = changes.find((c) => c.path === "assets/logo.png")!;
    expect(change.changeType).toBe(FileChangeType.CREATE);
    // Body-less binary side carrying only its byte-true content address.
    expect(change.after).toEqual({ kind: "binary", sha256: sha256Bytes(BIN_V1) });
    expect(change.before).toBeUndefined();
    // The digest is over the RAW bytes; a lossy UTF-8 re-encode would differ —
    // this is the latent break the byte-true capture closes.
    const lossy = sha256Bytes(Buffer.from(BIN_V1.toString("utf8"), "utf8"));
    expect(sha256Bytes(BIN_V1)).not.toBe(lossy);
  });

  it("reconciles an approved binary create byte-exact from the git ref", async () => {
    const baseline = await snapshotBaseline(repo, EXEC_ID);
    await writeBytes("assets/logo.png", BIN_V1);
    const { afterTree, changes } = await captureChangeSet(repo, EXEC_ID, baseline);

    await restoreToBaseline(repo, baseline, changes); // discard removes the create
    expect(await exists("assets/logo.png")).toBe(false);

    await applyApprovedPaths(repo, afterTree, changes); // approve re-applies exact bytes
    expect((await readBytes("assets/logo.png")).equals(BIN_V1)).toBe(true);
  });

  it("reconciles a binary modify: approve keeps new bytes, reject restores old (byte-exact)", async () => {
    // Commit a binary baseline so a modify is exercised.
    await writeBytes("assets/logo.png", BIN_V1);
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "add binary"]);

    const baseline = await snapshotBaseline(repo, EXEC_ID);
    await writeBytes("assets/logo.png", BIN_V2); // modify the binary
    const { afterTree, changes } = await captureChangeSet(repo, EXEC_ID, baseline);
    const change = changes.find((c) => c.path === "assets/logo.png")!;
    expect(change.changeType).toBe(FileChangeType.MODIFY);
    expect(change.before).toEqual({ kind: "binary", sha256: sha256Bytes(BIN_V1) });
    expect(change.after).toEqual({ kind: "binary", sha256: sha256Bytes(BIN_V2) });

    // Approve -> the new bytes are kept byte-exact.
    await applyApprovedPaths(repo, afterTree, changes);
    expect((await readBytes("assets/logo.png")).equals(BIN_V2)).toBe(true);

    // Reject -> snap back to the exact baseline bytes.
    await restoreToBaseline(repo, baseline, changes);
    expect((await readBytes("assets/logo.png")).equals(BIN_V1)).toBe(true);
  });
});

describe("hard invariants", () => {
  it("never captures or disturbs the gitignored .stigmer SDK state", async () => {
    const baseline = await snapshotBaseline(repo, EXEC_ID);
    await write("notes.md", "planton\n");
    // Simulate the SDK writing more state mid-turn.
    await writeFile(join(repo, ".stigmer", "cursor-sdk-state", "db.sqlite"), "STATE2", "utf-8");

    const { changes } = await captureChangeSet(repo, EXEC_ID, baseline);
    expect(changes.some((c) => c.path.startsWith(".stigmer"))).toBe(false);

    await restoreToBaseline(repo, baseline, changes);
    // The SDK state is untouched by restore (it was never in the change set).
    expect(await read(".stigmer/cursor-sdk-state/db.sqlite")).toBe("STATE2");
  });

  it("excludes the passed runner-owned paths from the captured diff", async () => {
    const baseline = await snapshotBaseline(repo, EXEC_ID, RUNNER_OWNED_PATHS);
    // The gate writes these during the turn.
    await write(".cursor/hooks.json", '{"version":1,"hooks":{}}\n');
    await write(".cursor/rules/stigmer-tool-approval.mdc", "rule\n");
    await write("notes.md", "planton\n");

    const { changes } = await captureChangeSet(repo, EXEC_ID, baseline, RUNNER_OWNED_PATHS);
    expect(changes.some((c) => c.path === ".cursor/hooks.json")).toBe(false);
    expect(
      changes.some((c) => c.path === ".cursor/rules/stigmer-tool-approval.mdc"),
    ).toBe(false);
    expect(changes.some((c) => c.path === "notes.md")).toBe(true);
  });

  it("captures everything when no excludePaths are passed (deep-agent: no runner-owned files)", async () => {
    // The deep-agent harness writes no gate files into the work tree, so it passes
    // no excludePaths; a normal source file is captured as usual.
    const baseline = await snapshotBaseline(repo, EXEC_ID);
    await write("src/new.ts", "export const y = 2;\n");

    const { changes } = await captureChangeSet(repo, EXEC_ID, baseline);
    expect(changes.some((c) => c.path === "src/new.ts")).toBe(true);
  });

  it("preserves a gitignored file the agent created (NOT in the change set)", async () => {
    // .env is gitignored, so capture cannot see it. (Production gates such
    // writes via git check-ignore; here we assert capture itself never touches
    // it — restore must leave it alone, not delete it.)
    const baseline = await snapshotBaseline(repo, EXEC_ID);
    await write(".env", "SECRET=1\n");
    await write("notes.md", "planton\n");

    const { changes } = await captureChangeSet(repo, EXEC_ID, baseline);
    expect(changes.some((c) => c.path === ".env")).toBe(false);

    await restoreToBaseline(repo, baseline, changes);
    expect(await exists(".env")).toBe(true); // not clobbered by restore
  });
});

describe("recomputeChangeSet (resume source of truth)", () => {
  it("returns baselineTree, afterTree, and changes from the pinned refs", async () => {
    const baseline = await snapshotBaseline(repo, EXEC_ID);
    await write("notes.md", "planton notes\n");
    await write("src/new.ts", "export const y = 2;\n");
    const captured = await captureChangeSet(repo, EXEC_ID, baseline);

    // On resume the refs (not the live tree) are the source of truth: recompute
    // re-derives the exact baseline/after trees and the per-file change set.
    const recomputed = await recomputeChangeSet(repo, EXEC_ID);
    expect(recomputed).toBeDefined();
    expect(recomputed!.baselineTree).toBe(baseline);
    expect(recomputed!.afterTree).toBe(captured.afterTree);
    expect(recomputed!.changes.map((c) => c.path).sort()).toEqual([
      "notes.md",
      "src/new.ts",
    ]);
  });

  it("returns undefined when the execution never captured (no refs)", async () => {
    expect(await recomputeChangeSet(repo, "never-captured")).toBeUndefined();
  });
});

describe("isPathCapturable (capture-mode gate predicate)", () => {
  beforeEach(async () => {
    // .env + the build/ dir are gitignored; everything else is capturable.
    await write(".gitignore", ".env\nbuild/\n");
    await git(["add", ".gitignore"]);
    await git(["commit", "-q", "-m", "gitignore"]);
  });

  it("returns true for a git-tracked path (capturable -> flows)", async () => {
    expect(await isPathCapturable(repo, "src/main.ts")).toBe(true);
  });

  it("returns true for a new untracked-but-not-ignored path (capturable)", async () => {
    expect(await isPathCapturable(repo, "src/brand-new.ts")).toBe(true);
  });

  it("returns false for a gitignored file (NOT capturable -> stays gated)", async () => {
    expect(await isPathCapturable(repo, ".env")).toBe(false);
  });

  it("returns false for a path under a gitignored directory", async () => {
    expect(await isPathCapturable(repo, "build/out.js")).toBe(false);
  });

  it("returns false for an empty path", async () => {
    expect(await isPathCapturable(repo, "")).toBe(false);
  });
});

describe("dropCaptureRefs", () => {
  it("removes the per-execution refs and is idempotent", async () => {
    await snapshotBaseline(repo, EXEC_ID);
    await write("notes.md", "planton\n");
    await captureChangeSet(repo, EXEC_ID, (await git(["rev-parse", "HEAD^{tree}"])).trim());

    await dropCaptureRefs(repo, EXEC_ID);
    const refs = await git(["for-each-ref", "refs/stigmer/"]);
    expect(refs.trim()).toBe("");
    // Idempotent: a second drop does not throw.
    await dropCaptureRefs(repo, EXEC_ID);
  });
});
