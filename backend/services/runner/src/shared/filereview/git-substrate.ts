/**
 * Git snapshot/restore substrate for the apply-then-review HITL "capture mode".
 *
 * THE MODEL
 * ---------
 * Edits are applied to the working tree and reviewed AFTER the fact; rejecting a
 * file snaps it back exactly. We use git as a NO-COMMIT snapshot/restore
 * substrate at the turn boundary:
 *
 *  1. snapshotBaseline() at turn start — record the exact pre-turn working tree
 *     and pin it behind a ref so it survives a multi-day approval wait.
 *  2. The agent edits files freely (the gate allows git-tracked write/edit/delete).
 *  3. captureChangeSet() at turn end — diff the post-turn tree against the
 *     baseline into a per-file change set, and pin the post-turn ("after") tree
 *     behind a ref. The working tree is LEFT in its "after" state: the user
 *     reviews the real, applied change and the workspace browser shows it.
 *  4. On resume, reconcile the working tree to the per-file decisions, sourced
 *     ENTIRELY from the two pinned refs (not the live tree, not the persisted
 *     bodies — the refs are the single source of truth):
 *       - approved           -> applyApprovedPaths() ensures the "after" bytes.
 *       - rejected/undecided -> restoreToBaseline() snaps the file back to its
 *         exact pre-turn bytes.
 *     This is symmetric and idempotent: it converges to the correct end state
 *     regardless of the tree's current contents, so a Temporal retry or a tree
 *     reset is harmless.
 *  5. dropCaptureRefs() releases the pinned objects.
 *
 * HARNESS-AGNOSTIC
 * ----------------
 * This is pure git plumbing keyed by `executionId`. It carries no Cursor- or
 * deep-agent-specific knowledge: the runner-owned files a harness writes into the
 * workspace (e.g. the Cursor gate's `.cursor/hooks.json`) are passed in as
 * `excludePaths` so they never pollute the captured diff, rather than being
 * hard-coded here. Both harnesses author IDENTICAL ledger entries through the
 * shared producer (events.ts) on top of this substrate. A future CAS substrate
 * (for ignored / non-git paths) sits beside this module.
 *
 * NOTHING IS PERMANENT UNTIL APPROVAL
 * -----------------------------------
 * Edits are visible during review, but nothing is committed and the next turn is
 * blocked until the user decides; a reject snaps the file back byte-for-byte from
 * the baseline ref. Shell/MCP and gitignored writes/deletes are NOT reversible by
 * this substrate, so they stay on the approve-before-run gate (see each harness's
 * gate: the Cursor hook and the deep-agent approval-gate middleware).
 *
 * WHY GIT, NO COMMITS
 * -------------------
 * Git is used ONLY as an exact, reversible capture/restore mechanism. We never
 * move HEAD, never touch a branch, never push. Approved work stays uncommitted;
 * a harness's own writeback path (if any) commits the reconciled tree afterwards.
 *
 * HARD INVARIANTS
 * ---------------
 * - NEVER `git clean -x`/`-a` or `git stash -a`: the git-excluded `.stigmer/`
 *   directory holds SDK resume state and MUST survive. `git clean -fd` (no `-x`)
 *   leaves ignored paths alone, so `.stigmer`/`lost+found` are safe.
 * - Runner-owned files written into the workspace are EXCLUDED (via `excludePaths`)
 *   from both the baseline and the after tree, so they never pollute the captured
 *   diff regardless of gate-teardown ordering.
 * - All staging uses a TEMP index (GIT_INDEX_FILE) so the repo's real index is
 *   never disturbed.
 */

import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { FileChangeType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { bytesLookBinary } from "../file-change.js";
import { sha256Bytes } from "./digest.js";
import type { CapturedContent } from "./events.js";

const execFileAsync = promisify(execFile);

/** Build `:(exclude)` pathspecs for the runner-owned files a harness passes in. */
function excludePathspecs(excludePaths: readonly string[]): string[] {
  return excludePaths.map((p) => `:(exclude)${p}`);
}

/**
 * Refs that pin the per-execution baseline and after trees against GC. Exported
 * so the file-review producer can stamp them onto the ledger's SnapshotRef
 * (GitTreeRef.ref) without re-deriving the format. Keyed by executionId only:
 * the unified gate guarantees at most one un-reconciled change set per execution
 * at a time, and the reconcile drops these refs before the next turn re-pins.
 */
export function baselineRef(executionId: string): string {
  return `refs/stigmer/baseline/${executionId}`;
}
export function captureRef(executionId: string): string {
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
 * restore/apply. `before`/`after` are the harness-agnostic {@link CapturedContent}
 * for each side (absent per changeType: no `before` for a CREATE, no `after` for
 * a DELETE) — text is carried inline, binary carries only its byte-true content
 * address (its bytes reconcile byte-exact from the git ref, never the wire).
 */
export interface GitSubstrateChange {
  /** Repo-relative path (the diff's path; the destination for a create/modify). */
  readonly path: string;
  readonly changeType: FileChangeType;
  /** Pre-edit content (absent for a CREATE). */
  readonly before?: CapturedContent;
  /** Post-edit content (absent for a DELETE). */
  readonly after?: CapturedContent;
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
  /** One entry per changed file (excluding the passed runner-owned paths). */
  readonly changes: readonly GitSubstrateChange[];
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

/**
 * Whether a repo-relative path is capturable by this substrate — i.e. it would
 * appear in the `git add -A` snapshot. A gitignored path is NOT capturable: the
 * snapshot cannot see it, so it can be neither reviewed nor reverted, and a
 * capture-mode gate must keep gating it. Mirrors the Cursor hook's
 * `__stigmer_is_gitignored` check: `git check-ignore -q` exits 0 when the path IS
 * ignored, non-zero otherwise; a non-git context / error is treated as
 * not-ignored (capturable), matching the hook's allow-on-error behavior.
 */
export async function isPathCapturable(gitRoot: string, path: string): Promise<boolean> {
  if (!path) return false;
  try {
    await git(gitRoot, ["check-ignore", "-q", "--", path]);
    return false; // exit 0 -> ignored -> not capturable
  } catch {
    return true; // exit 1 (not ignored) or error -> capturable
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
 * `.git/info/exclude`, EXCLUDING the passed runner-owned paths) into a TEMP index
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
  excludePaths: readonly string[],
): Promise<string> {
  const tmpIndex = join(gitDir, `stigmer-index-${label}-${executionId}`);
  try {
    await rm(tmpIndex, { force: true });
    const env = { GIT_INDEX_FILE: tmpIndex };
    await git(gitRoot, ["add", "-A", "--", ".", ...excludePathspecs(excludePaths)], env);
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
 * {@link restoreToBaseline} later in the SAME activity invocation). `excludePaths`
 * are the runner-owned files the harness writes into the workspace (omit for none).
 */
export async function snapshotBaseline(
  gitRoot: string,
  executionId: string,
  excludePaths: readonly string[] = [],
): Promise<string> {
  const gitDir = await resolveGitDir(gitRoot);
  const tree = await writeWorkingTree(gitRoot, gitDir, "baseline", executionId, excludePaths);
  await pinTree(gitRoot, baselineRef(executionId), tree, `stigmer baseline ${executionId}`);
  return tree;
}

/**
 * Capture the change set the turn produced: write the post-turn working tree,
 * pin it behind the capture ref (so it survives the approval wait), and diff it
 * against `baselineTree` into a per-file {@link GitSubstrateChange} list.
 *
 * Renames are intentionally NOT detected (`--no-renames`): a rename surfaces as
 * a delete + create, which restores and applies exactly and matches the per-file
 * review model.
 */
export async function captureChangeSet(
  gitRoot: string,
  executionId: string,
  baselineTree: string,
  excludePaths: readonly string[] = [],
): Promise<CaptureResult> {
  const gitDir = await resolveGitDir(gitRoot);
  const afterTree = await writeWorkingTree(gitRoot, gitDir, "capture", executionId, excludePaths);
  await pinTree(gitRoot, captureRef(executionId), afterTree, `stigmer capture ${executionId}`);

  const raw = await git(gitRoot, [
    "diff",
    "--no-renames",
    "--name-status",
    "-z",
    baselineTree,
    afterTree,
  ]);

  const changes: GitSubstrateChange[] = [];
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
  changes: readonly GitSubstrateChange[],
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
  approved: readonly GitSubstrateChange[],
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
 * independent of any persisted fidelity. Returns `undefined` when this was not a
 * capture turn (the capture ref is absent), so the caller can fall through to the
 * non-capture path.
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
  const changes: GitSubstrateChange[] = [];
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

/** The ref pinning the post-reconcile (approved) tree for the RECONCILED event. */
function approvedRef(executionId: string): string {
  return `refs/stigmer/approved/${executionId}`;
}

/**
 * Snapshot the post-reconcile working tree (after approved bytes were applied and
 * rejected files were reverted) and pin it behind the approved ref. Returns the
 * approved tree sha for the RECONCILED event's `approved_snapshot`, plus the ref
 * so the producer can stamp the SnapshotRef. Idempotent under a Temporal retry.
 */
export async function snapshotApproved(
  gitRoot: string,
  executionId: string,
  excludePaths: readonly string[] = [],
): Promise<{ treeOid: string; ref: string }> {
  const gitDir = await resolveGitDir(gitRoot);
  const tree = await writeWorkingTree(gitRoot, gitDir, "approved", executionId, excludePaths);
  const ref = approvedRef(executionId);
  await pinTree(gitRoot, ref, tree, `stigmer approved ${executionId}`);
  return { treeOid: tree, ref };
}

/** Release the per-execution baseline, capture, and approved refs (idempotent). */
export async function dropCaptureRefs(
  gitRoot: string,
  executionId: string,
): Promise<void> {
  for (const ref of [baselineRef(executionId), captureRef(executionId), approvedRef(executionId)]) {
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

/** Read a blob's exact BYTES from a tree, or `undefined` when absent. */
async function readBlobBytes(
  gitRoot: string,
  tree: string,
  path: string,
): Promise<Buffer | undefined> {
  try {
    return await gitBuffer(gitRoot, ["cat-file", "-p", `${tree}:${path}`]);
  } catch {
    return undefined;
  }
}

/**
 * Read one side of a change as {@link CapturedContent}, computing its identity
 * from the RAW bytes (never a lossy UTF-8 decode): a binary blob carries only its
 * byte-true content address (no body — it reconciles from the git ref), while a
 * text blob is carried inline. Returns `undefined` only when the blob is absent
 * from the tree (the side does not exist for this changeType).
 */
async function readSide(
  gitRoot: string,
  tree: string,
  path: string,
): Promise<CapturedContent | undefined> {
  const bytes = await readBlobBytes(gitRoot, tree, path);
  if (bytes === undefined) return undefined;
  // Identity is always computed over the RAW bytes at the source — never a lossy
  // UTF-8 re-encode — so the enforcement digest is byte-true for binary and text
  // alike. A binary blob carries no body (it reconciles from the git ref); a text
  // blob carries its inline body for the review diff.
  const sha256 = sha256Bytes(bytes);
  if (bytesLookBinary(bytes)) {
    return { kind: "binary", sha256 };
  }
  return { kind: "inline", text: bytes.toString("utf8"), sha256 };
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

/** An empty inline side — the default when a MODIFY blob is unexpectedly absent. */
const EMPTY_INLINE: CapturedContent = { kind: "inline", text: "" };

/**
 * Build a {@link GitSubstrateChange} from a diff entry. WHOLE_FILE capture: the
 * before/after content comes from the two trees, with identity computed over the
 * exact bytes git holds (see {@link readSide}) — so the review shows the file's
 * true net change and the enforcement digest is byte-true, binary or text alike.
 * A binary side is carried as a content address only (no body); large text bodies
 * are offloaded later at the persist chokepoint.
 */
async function buildCapturedChange(
  gitRoot: string,
  baselineTree: string,
  afterTree: string,
  status: string,
  path: string,
): Promise<GitSubstrateChange | undefined> {
  if (status === "A") {
    const after = await readSide(gitRoot, afterTree, path);
    if (after === undefined) return undefined;
    return { path, changeType: FileChangeType.CREATE, after };
  }

  if (status === "D") {
    const before = await readSide(gitRoot, baselineTree, path);
    if (before === undefined) return undefined;
    return { path, changeType: FileChangeType.DELETE, before };
  }

  // Modified (M) — and any other status (T type-change, etc.) treated as MODIFY.
  const before = await readSide(gitRoot, baselineTree, path);
  const after = await readSide(gitRoot, afterTree, path);
  if (before === undefined && after === undefined) return undefined;
  return {
    path,
    changeType: FileChangeType.MODIFY,
    before: before ?? EMPTY_INLINE,
    after: after ?? EMPTY_INLINE,
  };
}
