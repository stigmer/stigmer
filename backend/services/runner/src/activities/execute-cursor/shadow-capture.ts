/**
 * Git snapshot/restore capture for the Cursor HITL "capture mode".
 *
 * THE MODEL
 * ---------
 * The Cursor IDE applies edits live and lets you review them after; rejecting a
 * file snaps it back exactly. We reproduce that 1:1 on the server: the agent's
 * edits stay APPLIED to the working tree while the user reviews, and approval is
 * a KEEP/DISCARD decision over the real, on-disk change — not an apply-after-the-
 * fact. The deny-only harness cannot do this (it fragments one logical change
 * into many approval cycles), so for a GIT workspace we let every file edit flow
 * during the turn and use git as a NO-COMMIT snapshot/restore substrate at the
 * turn boundary:
 *
 *  1. snapshotBaseline() at turn start — record the exact pre-turn working tree
 *     and pin it behind a ref so it survives a multi-day approval wait.
 *  2. The agent edits files freely (the hook allows write/edit/delete).
 *  3. captureChangeSet() at turn end — diff the post-turn tree against the
 *     baseline into a per-file change set, and pin the post-turn ("after") tree
 *     behind a ref. The working tree is LEFT in its "after" state: the user
 *     reviews the real, applied change (Cursor parity) and the workspace browser
 *     shows it.
 *  4. On resume, reconcile the working tree to the per-file decisions, sourced
 *     ENTIRELY from the two pinned refs (not the live tree, not the persisted
 *     card bodies — the refs are the single source of truth):
 *       - approved           -> applyApprovedPaths() ensures the "after" bytes.
 *       - rejected/undecided -> restoreToBaseline() snaps the file back to its
 *         exact pre-turn bytes.
 *     This is symmetric and idempotent: it converges to the correct end state
 *     regardless of the tree's current contents, so a Temporal retry or a tree
 *     reset is harmless. Approved work stays UNCOMMITTED (the harness never
 *     commits — see the no-writeback finding in the plan).
 *  5. dropCaptureRefs() releases the pinned objects.
 *
 * NOTHING IS PERMANENT UNTIL APPROVAL
 * -----------------------------------
 * Edits are visible during review (as in the Cursor IDE), but nothing is
 * committed and the next turn is blocked until the user decides; a reject snaps
 * the file back byte-for-byte from the baseline ref. Shell/MCP and gitignored
 * writes/deletes are NOT reversible by this substrate, so they stay on the
 * deny-gate (approve-before-run) — see hook-script.ts.
 *
 * WHY GIT, NO COMMITS
 * -------------------
 * The Cursor harness has no git writeback and never commits — agent edits
 * accumulate as uncommitted working-tree changes across turns. We honor that:
 * approved work stays uncommitted, and git is used ONLY as an exact, reversible
 * capture/restore mechanism. We never move HEAD, never touch a branch, never
 * push. The deep-agent WriteBackCoordinator is a separate path and is untouched.
 *
 * HARD INVARIANTS
 * ---------------
 * - NEVER `git clean -x`/`-a` or `git stash -a`: the git-excluded `.stigmer/`
 *   directory holds the Cursor SDK resume state and MUST survive. `git clean -fd`
 *   (no `-x`) leaves ignored paths alone, so `.stigmer`/`lost+found` are safe.
 * - The runner-owned gate files written into the workspace
 *   (`.cursor/hooks.json`, `.cursor/rules/stigmer-tool-approval.mdc`) are
 *   EXCLUDED from both the baseline and the after tree, so they never pollute
 *   the captured diff regardless of gate-teardown ordering.
 * - All staging uses a TEMP index (GIT_INDEX_FILE) so the repo's real index is
 *   never disturbed.
 */

import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  FileChangeType,
  FileChangeCaptureLevel,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { buildFileChange, looksBinary } from "../../shared/file-change.js";

const execFileAsync = promisify(execFile);

/**
 * Workspace-relative paths the runner writes into the repo for the approval
 * gate. They are excluded from capture so a turn's diff never shows the gate's
 * own machinery. (The workspace-scoped gate dir and SDK state live under
 * `~/.stigmer` / the git-excluded `.stigmer`, so they need no exclusion here.)
 */
const RUNNER_OWNED_PATHS: readonly string[] = [
  ".cursor/hooks.json",
  ".cursor/rules/stigmer-tool-approval.mdc",
];

/** `:(exclude)` pathspecs for the runner-owned gate files. */
const EXCLUDE_PATHSPECS: readonly string[] = RUNNER_OWNED_PATHS.map(
  (p) => `:(exclude)${p}`,
);

/** Refs that pin the per-execution baseline and after trees against GC. */
function baselineRef(executionId: string): string {
  return `refs/stigmer/baseline/${executionId}`;
}
function captureRef(executionId: string): string {
  return `refs/stigmer/capture/${executionId}`;
}

/**
 * A non-interactive identity for the snapshot commit objects. These commits are
 * never on a branch, never pushed, and exist only to anchor a tree against
 * garbage collection — but `git commit-tree` still requires an author/committer,
 * and the repo may have no user.name/email configured. Supplied via env so we
 * never mutate the repo's config.
 */
const SNAPSHOT_IDENTITY_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: "stigmer-runner",
  GIT_AUTHOR_EMAIL: "runner@stigmer.local",
  GIT_COMMITTER_NAME: "stigmer-runner",
  GIT_COMMITTER_EMAIL: "runner@stigmer.local",
};

/**
 * A single file mutation captured from the git diff between the baseline and
 * after trees. `path` is repo-relative (forward slashes); `changeType` drives
 * restore/apply; `fileChange` is the proto rendered on the approval card.
 */
export interface CapturedFileChange {
  /** Repo-relative path (the diff's path; the destination for a create/modify). */
  readonly path: string;
  readonly changeType: FileChangeType;
  /** The proto for the approval card (WHOLE_FILE before/after). */
  readonly fileChange: FileChange;
}

/** Result of {@link captureChangeSet} / {@link recomputeChangeSet}. */
export interface CaptureResult {
  /**
   * The pre-turn tree sha (pinned behind the baseline ref). On resume this is
   * the authoritative source for reverting rejected/undecided files exactly.
   */
  readonly baselineTree: string;
  /** The post-turn tree sha, also pinned behind the capture ref. */
  readonly afterTree: string;
  /** One entry per changed file (excluding runner-owned gate files). */
  readonly changes: readonly CapturedFileChange[];
}

/**
 * Run a git command in `gitRoot`. Returns stdout as a UTF-8 string. Binary
 * output (file bodies) must use {@link gitBuffer} instead so bytes are exact.
 */
async function git(
  gitRoot: string,
  args: string[],
  env?: Record<string, string>,
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: gitRoot,
    env: env ? { ...process.env, ...env } : process.env,
    maxBuffer: 256 * 1024 * 1024,
    encoding: "utf-8",
  });
  return stdout;
}

/** Run a git command returning raw stdout BYTES (for exact file-body reads). */
async function gitBuffer(gitRoot: string, args: string[]): Promise<Buffer> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: gitRoot,
    maxBuffer: 256 * 1024 * 1024,
    encoding: "buffer",
  });
  return stdout as unknown as Buffer;
}

/**
 * Whether `dir` is inside a git work tree (the capability switch: a real git
 * workspace gets capture mode, anything else keeps the deny-gate fallback).
 */
export async function isGitWorkTree(dir: string): Promise<boolean> {
  try {
    const out = await git(dir, ["rev-parse", "--is-inside-work-tree"]);
    return out.trim() === "true";
  } catch {
    return false;
  }
}

/** Whether the repo has a resolvable HEAD (false for a brand-new empty repo). */
async function headExists(gitRoot: string): Promise<boolean> {
  try {
    await git(gitRoot, ["rev-parse", "--verify", "--quiet", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

/** Absolute path of the repo's `.git` dir (for temp index placement). */
async function resolveGitDir(gitRoot: string): Promise<string> {
  const out = (await git(gitRoot, ["rev-parse", "--absolute-git-dir"])).trim();
  return out;
}

/**
 * Stage the entire working tree (tracked + untracked, honoring `.gitignore` /
 * `.git/info/exclude`, EXCLUDING the runner-owned gate files) into a TEMP index
 * and write it out as a tree object. The real index is never touched.
 *
 * Using a temp index with `git add -A` records every present file as the tree's
 * content; files absent from the working tree are simply absent from the tree,
 * so the result is an exact snapshot of "what files exist right now and their
 * bytes". `.stigmer` and other ignored paths are never staged.
 */
async function writeWorkingTree(
  gitRoot: string,
  gitDir: string,
  label: string,
  executionId: string,
): Promise<string> {
  const tmpIndex = join(gitDir, `stigmer-index-${label}-${executionId}`);
  try {
    await rm(tmpIndex, { force: true });
    const env = { GIT_INDEX_FILE: tmpIndex };
    await git(gitRoot, ["add", "-A", "--", ".", ...EXCLUDE_PATHSPECS], env);
    return (await git(gitRoot, ["write-tree"], env)).trim();
  } finally {
    await rm(tmpIndex, { force: true });
  }
}

/** Pin `tree` behind `ref` as a parent-less-or-HEAD-parented commit (anti-GC). */
async function pinTree(
  gitRoot: string,
  ref: string,
  tree: string,
  message: string,
): Promise<void> {
  const args = ["commit-tree", tree, "-m", message];
  if (await headExists(gitRoot)) {
    args.push("-p", "HEAD");
  }
  const commit = (await git(gitRoot, args, SNAPSHOT_IDENTITY_ENV)).trim();
  await git(gitRoot, ["update-ref", ref, commit]);
}

/**
 * Snapshot the working tree at turn start and pin it behind the baseline ref.
 * Returns the baseline tree sha (used by {@link captureChangeSet} and
 * {@link restoreToBaseline} later in the SAME activity invocation).
 */
export async function snapshotBaseline(
  gitRoot: string,
  executionId: string,
): Promise<string> {
  const gitDir = await resolveGitDir(gitRoot);
  const tree = await writeWorkingTree(gitRoot, gitDir, "baseline", executionId);
  await pinTree(gitRoot, baselineRef(executionId), tree, `stigmer baseline ${executionId}`);
  return tree;
}

/**
 * Capture the change set the turn produced: write the post-turn working tree,
 * pin it behind the capture ref (so it survives the approval wait), and diff it
 * against `baselineTree` into a per-file {@link CapturedFileChange} list.
 *
 * Renames are intentionally NOT detected (`--no-renames`): a rename surfaces as
 * a delete + create, which restores and applies exactly and matches the plan's
 * per-file review model.
 */
export async function captureChangeSet(
  gitRoot: string,
  executionId: string,
  baselineTree: string,
): Promise<CaptureResult> {
  const gitDir = await resolveGitDir(gitRoot);
  const afterTree = await writeWorkingTree(gitRoot, gitDir, "capture", executionId);
  await pinTree(gitRoot, captureRef(executionId), afterTree, `stigmer capture ${executionId}`);

  const raw = await git(gitRoot, [
    "diff",
    "--no-renames",
    "--name-status",
    "-z",
    baselineTree,
    afterTree,
  ]);

  const changes: CapturedFileChange[] = [];
  for (const { status, path } of parseNameStatusZ(raw)) {
    const change = await buildCapturedChange(gitRoot, baselineTree, afterTree, status, path);
    if (change) changes.push(change);
  }
  return { baselineTree, afterTree, changes };
}

/**
 * Restore the given files to their `baselineTree` (pre-turn) bytes. On resume
 * this reverts the REJECTED/undecided subset so a discarded change snaps back
 * exactly; it is the generic "ensure baseline bytes" primitive. Surgical
 * (bounded by the passed change set): an agent-created file is removed; an
 * agent-modified or agent-deleted file is rewritten with its baseline bytes.
 * `.stigmer` and other ignored paths are never touched (they are not in the
 * change set). Idempotent — safe to re-run (e.g. on a Temporal retry).
 */
export async function restoreToBaseline(
  gitRoot: string,
  baselineTree: string,
  changes: readonly CapturedFileChange[],
): Promise<void> {
  for (const change of changes) {
    const abs = join(gitRoot, change.path);
    if (change.changeType === FileChangeType.CREATE) {
      await rm(abs, { force: true });
    } else {
      // MODIFY or DELETE: the baseline holds the file — restore its exact bytes.
      await writeBlobToDisk(gitRoot, baselineTree, change.path, abs);
    }
  }
}

/**
 * Ensure the APPROVED files hold their captured "after" bytes, as uncommitted
 * working-tree changes (no commit). In capture mode the agent's edits are left
 * applied through the review window, so on resume this is normally an idempotent
 * re-assert of bytes already on disk; sourcing from the pinned "after" tree also
 * makes it self-healing if the tree was reset (Temporal retry / sandbox
 * recycle). An approved CREATE/MODIFY writes the after bytes; an approved DELETE
 * removes the file. Rejected/undecided paths are not passed in (they go to
 * {@link restoreToBaseline}).
 */
export async function applyApprovedPaths(
  gitRoot: string,
  afterTree: string,
  approved: readonly CapturedFileChange[],
): Promise<void> {
  for (const change of approved) {
    const abs = join(gitRoot, change.path);
    if (change.changeType === FileChangeType.DELETE) {
      await rm(abs, { force: true });
    } else {
      // CREATE or MODIFY: write the agent's approved bytes from the after tree.
      await writeBlobToDisk(gitRoot, afterTree, change.path, abs);
    }
  }
}

/**
 * Recompute the captured change set on a RESUME, from the pinned baseline and
 * capture refs — the authoritative source that survived the approval wait,
 * independent of any persisted card fidelity. Returns `undefined` when this was
 * not a capture turn (the capture ref is absent), so the caller can fall through
 * to the non-capture path.
 */
export async function recomputeChangeSet(
  gitRoot: string,
  executionId: string,
): Promise<CaptureResult | undefined> {
  const baselineTree = await resolveRefTree(gitRoot, baselineRef(executionId));
  const afterTree = await resolveRefTree(gitRoot, captureRef(executionId));
  if (!baselineTree || !afterTree) return undefined;

  const raw = await git(gitRoot, [
    "diff",
    "--no-renames",
    "--name-status",
    "-z",
    baselineTree,
    afterTree,
  ]);
  const changes: CapturedFileChange[] = [];
  for (const { status, path } of parseNameStatusZ(raw)) {
    const change = await buildCapturedChange(gitRoot, baselineTree, afterTree, status, path);
    if (change) changes.push(change);
  }
  return { baselineTree, afterTree, changes };
}

/** Resolve a ref to its tree sha, or `undefined` when the ref does not exist. */
async function resolveRefTree(gitRoot: string, ref: string): Promise<string | undefined> {
  try {
    return (await git(gitRoot, ["rev-parse", "--verify", "--quiet", `${ref}^{tree}`])).trim();
  } catch {
    return undefined;
  }
}

/** Release the per-execution baseline and capture refs (idempotent). */
export async function dropCaptureRefs(
  gitRoot: string,
  executionId: string,
): Promise<void> {
  for (const ref of [baselineRef(executionId), captureRef(executionId)]) {
    try {
      await git(gitRoot, ["update-ref", "-d", ref]);
    } catch {
      // Already gone — nothing to release.
    }
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface NameStatusEntry {
  status: string;
  path: string;
}

/**
 * Parse `git diff --name-status -z` output: a flat NUL-delimited stream of
 * `STATUS\0PATH\0` pairs. NUL-delimiting avoids every quoting/escaping concern
 * for paths with spaces, quotes, or unicode.
 */
function parseNameStatusZ(raw: string): NameStatusEntry[] {
  const parts = raw.split("\u0000");
  const entries: NameStatusEntry[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i];
    const path = parts[i + 1];
    if (!status || !path) continue;
    entries.push({ status: status[0], path });
  }
  return entries;
}

/** Read a blob's UTF-8 text from a tree, or `undefined` when absent. */
async function readBlobText(
  gitRoot: string,
  tree: string,
  path: string,
): Promise<string | undefined> {
  try {
    return await git(gitRoot, ["cat-file", "-p", `${tree}:${path}`]);
  } catch {
    return undefined;
  }
}

/** Write a blob's exact bytes from a tree to `abs` (creating parent dirs). */
async function writeBlobToDisk(
  gitRoot: string,
  tree: string,
  path: string,
  abs: string,
): Promise<void> {
  const buf = await gitBuffer(gitRoot, ["cat-file", "-p", `${tree}:${path}`]);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, buf);
}

/**
 * Build a {@link CapturedFileChange} from a diff entry. WHOLE_FILE capture: the
 * before/after bodies come from the two trees (byte-exact via git), so the card
 * shows the file's true net change regardless of how many edit tool calls
 * produced it. A binary side is still carried (the proto flags it); large bodies
 * are offloaded later at the persist chokepoint.
 */
async function buildCapturedChange(
  gitRoot: string,
  baselineTree: string,
  afterTree: string,
  status: string,
  path: string,
): Promise<CapturedFileChange | undefined> {
  const absolutePath = join(gitRoot, path);

  if (status === "A") {
    const after = await readBlobText(gitRoot, afterTree, path);
    if (after === undefined) return undefined;
    return {
      path,
      changeType: FileChangeType.CREATE,
      fileChange: buildFileChange({
        path,
        absolutePath,
        changeType: FileChangeType.CREATE,
        captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
        after,
      }),
    };
  }

  if (status === "D") {
    const before = await readBlobText(gitRoot, baselineTree, path);
    if (before === undefined) return undefined;
    return {
      path,
      changeType: FileChangeType.DELETE,
      fileChange: buildFileChange({
        path,
        absolutePath,
        changeType: FileChangeType.DELETE,
        captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
        before,
      }),
    };
  }

  // Modified (M) — and any other status (T type-change, etc.) treated as MODIFY.
  const before = await readBlobText(gitRoot, baselineTree, path);
  const after = await readBlobText(gitRoot, afterTree, path);
  if (before === undefined && after === undefined) return undefined;
  return {
    path,
    changeType: FileChangeType.MODIFY,
    fileChange: buildFileChange({
      path,
      absolutePath,
      changeType: FileChangeType.MODIFY,
      captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
      before: before ?? "",
      after: after ?? "",
    }),
  };
}

/** Re-exported for tests asserting binary handling parity with the builder. */
export { looksBinary };
