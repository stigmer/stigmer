/**
 * Git write-back coordinator for workspace entries.
 *
 * Commits the workspace's changes to the session's write-back branch, pushes,
 * and keeps one pull request open per session. The branch and PR are
 * SESSION-scoped (`stigmer/<session-id>`): a session is one workstream, so
 * every approved turn appends commits to the same branch and the same PR —
 * mirroring how Cursor cloud agents and Codex present a session's deliverable.
 * Execution-scoped branches were a modeling bug: each turn branched off the
 * previous turn's branch, leaving a trail of superseded PRs.
 *
 * Because the branch outlives any single execution, every git/GitHub step is
 * idempotent across coordinator instances: the branch is checked out if it
 * already exists (locally, or on the remote after a sandbox re-provision), and
 * an already-open PR for the branch is adopted instead of re-created.
 *
 * When this runs depends on the harness's file-review mode:
 *  - Capture mode (apply-then-review — every git workspace): the streaming
 *    trigger is suppressed and `finalize()` runs exactly once on the APPROVED
 *    tree, after review decisions reconcile (see processCaptureWriteback in
 *    index.ts). Speculative mid-turn edits never reach GitHub.
 *  - Legacy non-capture turns: `onFileModified(path)` triggers an incremental
 *    commit/push per file-modifying tool call (DD-5), with `finalize()` as the
 *    post-stream safety net.
 *
 * Concurrency: one mutex per workspace entry serializes git operations.
 */

import { create } from "@bufbuild/protobuf";
import {
  WorkspaceWriteBackSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/writeback_pb";
import {
  WorkspaceWriteBackPhase,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/writeback_pb";
import { GitWriteBackMode } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import type { WorkspaceBackend, ProvisionResult } from "./types.js";
import { SourceType } from "./types.js";
import { gitCommitAsAgent } from "./git-identity.js";
import type { ExecutionStatusWriter } from "../execution-status-writer.js";

const WRITE_BACK_ENABLED_MODES = new Set([
  GitWriteBackMode.GIT_WRITE_BACK_MODE_UNSPECIFIED,
  GitWriteBackMode.GIT_WRITE_BACK_BRANCH_AND_PR,
]);

const GITHUB_API = "https://api.github.com";

interface EntryState {
  branchReady: boolean;
  prCreated: boolean;
  prUrl: string;
  prNumber: number;
  commitCount: number;
  lastCommitSha: string;
  githubOwner: string;
  githubRepo: string;
}

interface EligibleEntry {
  readonly provisionResult: ProvisionResult;
  readonly baseBranch: string;
  readonly rootDir: string;
  readonly entryName: string;
}

export class WriteBackCoordinator {
  private readonly statusWriter: ExecutionStatusWriter;
  private readonly executionId: string;
  private readonly workspaceBackend: WorkspaceBackend;
  private readonly branchName: string;
  /**
   * Token for the GitHub PR API, plumbed explicitly from the resolved
   * execution env (the same GITHUB_TOKEN that credentials the clone/push).
   * Empty when the session has none — commit/push may still succeed via the
   * repo-local credential store, so an empty token degrades to PUSHED with an
   * actionable error rather than blocking the write-back.
   */
  private readonly githubToken: string;

  private readonly eligible = new Map<string, EligibleEntry>();
  private readonly state = new Map<string, EntryState>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(opts: {
    statusWriter: ExecutionStatusWriter;
    executionId: string;
    /** The owning session's id — the branch/PR are session-scoped. */
    sessionId: string;
    githubToken: string;
    provisionResults: readonly ProvisionResult[];
    workspaceEntries: readonly WorkspaceEntry[];
    workspaceBackend: WorkspaceBackend;
  }) {
    this.statusWriter = opts.statusWriter;
    this.executionId = opts.executionId;
    this.workspaceBackend = opts.workspaceBackend;
    this.githubToken = opts.githubToken;
    // The FULL session id: a truncated ULID is timestamp-dominated, so two
    // sessions created near-simultaneously would collide on a short prefix.
    this.branchName = `stigmer/${opts.sessionId}`;

    this.initEligibleEntries(opts.provisionResults, opts.workspaceEntries);
  }

  get hasEligibleEntries(): boolean {
    return this.eligible.size > 0;
  }

  /**
   * Called after a file-modifying tool completes (legacy non-capture turns
   * only). Resolves the path to a workspace entry and runs an incremental
   * commit/push cycle. Fire-and-forget: errors are logged, never thrown.
   */
  async onFileModified(path: string): Promise<void> {
    try {
      const entryName = this.resolveEntry(path);
      if (!entryName) return;

      await this.withLock(entryName, () =>
        this.writeBackEntry(entryName),
      );
    } catch (err) {
      console.warn(
        `[WriteBack] execution=${this.executionId} — ` +
        `onFileModified error for '${path}': ${err}`,
      );
    }
  }

  /**
   * Commits and pushes every eligible workspace entry's remaining uncommitted
   * changes. In capture mode this is THE write-back — invoked once on the
   * approved tree after review reconcile; on legacy turns it is the
   * post-stream safety net.
   */
  async finalize(): Promise<void> {
    for (const entryName of this.eligible.keys()) {
      try {
        await this.withLock(entryName, () =>
          this.writeBackEntry(entryName),
        );
      } catch (err) {
        console.warn(
          `[WriteBack] execution=${this.executionId} entry=${entryName} — ` +
          `finalize error: ${err}`,
        );
      }
    }
  }

  // ── Initialization ──────────────────────────────────────────────────

  private initEligibleEntries(
    provisionResults: readonly ProvisionResult[],
    workspaceEntries: readonly WorkspaceEntry[],
  ): void {
    const modeMap = new Map<string, GitWriteBackMode>();
    for (const entry of workspaceEntries) {
      const source = entry.source;
      if (source?.source.case === "gitRepo") {
        modeMap.set(entry.name, source.source.value.writeBackMode);
      }
    }

    for (const pr of provisionResults) {
      if (pr.sourceType !== SourceType.GIT_REPO) continue;
      if (!pr.gitMetadata) continue;
      if (!pr.gitMetadata.gitCredentialsConfigured) continue;

      const mode = modeMap.get(pr.entryName) ?? GitWriteBackMode.GIT_WRITE_BACK_MODE_UNSPECIFIED;
      if (!WRITE_BACK_ENABLED_MODES.has(mode)) continue;

      this.eligible.set(pr.entryName, {
        provisionResult: pr,
        baseBranch: pr.gitMetadata.branch,
        rootDir: pr.rootDir,
        entryName: pr.entryName,
      });

      this.state.set(pr.entryName, {
        branchReady: false,
        prCreated: false,
        prUrl: "",
        prNumber: 0,
        commitCount: 0,
        lastCommitSha: "",
        githubOwner: "",
        githubRepo: "",
      });
    }

    if (this.eligible.size > 0) {
      console.log(
        `[WriteBack] execution=${this.executionId} — coordinator initialized with ` +
        `${this.eligible.size} eligible workspace(s): ${[...this.eligible.keys()].join(", ")}`,
      );
    }
  }

  // ── Path Resolution ─────────────────────────────────────────────────

  private resolveEntry(path: string): string | null {
    if (this.eligible.size === 0) return null;
    if (this.eligible.size === 1) return this.eligible.keys().next().value!;

    const normalized = path.replace(/^\/+/, "");
    for (const entryName of this.eligible.keys()) {
      if (normalized.startsWith(entryName + "/") || normalized === entryName) {
        return entryName;
      }
    }
    return null;
  }

  // ── Core Write-Back Cycle ───────────────────────────────────────────

  /**
   * One write-back cycle for an entry: branch → commit → push → PR → status.
   *
   * Failure semantics are split by what actually succeeded (the phases are
   * facts, not a single verdict):
   *  - branch/commit/push failure → FAILED (the work did not reach GitHub);
   *  - PR failure after a successful push → PUSHED with the PR error carried
   *    in `error` — the branch is live and usable, and saying "failed" for a
   *    pushed branch would be dishonest (the original cloud regression).
   */
  private async writeBackEntry(entryName: string): Promise<void> {
    const entry = this.eligible.get(entryName)!;
    const entryState = this.state.get(entryName)!;
    const rootDir = entry.rootDir;

    const exec = async (cmd: string): Promise<string> => {
      return this.workspaceBackend.execute(`cd ${rootDir} && ${cmd}`);
    };

    try {
      const hasChanges = await this.hasChanges(exec);
      if (!hasChanges) return;

      if (!entryState.branchReady) {
        await this.ensureBranch(entryName, entryState, exec);
      }
      await this.commitAndPush(entryName, entryState, exec);
    } catch (err) {
      console.warn(
        `[WriteBack] execution=${this.executionId} entry=${entryName} — ` +
        `commit/push error: ${err}`,
      );
      const wb = create(WorkspaceWriteBackSchema, {
        workspaceEntryName: entryName,
        baseBranch: entry.baseBranch,
        branchName: entryState.branchReady ? this.branchName : "",
        phase: WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_FAILED,
        error: String(err),
      });
      if (entryState.prCreated) {
        wb.pullRequestUrl = entryState.prUrl;
        wb.pullRequestNumber = entryState.prNumber;
      }
      this.statusWriter.addWriteBack(wb);
      return;
    }

    let prError = "";
    if (!entryState.prCreated) {
      try {
        await this.ensurePr(entryName, entryState, entry);
      } catch (err) {
        console.warn(
          `[WriteBack] execution=${this.executionId} entry=${entryName} — ` +
          `PR error (branch is pushed): ${err}`,
        );
        prError = String(err);
      }
    }

    await this.updateStatus(entryName, entryState, entry, exec, prError);
  }

  // ── Git Operations ──────────────────────────────────────────────────

  private async hasChanges(exec: (cmd: string) => Promise<string>): Promise<boolean> {
    const diff = await exec("git diff --stat").catch(() => "");
    const staged = await exec("git diff --cached --stat").catch(() => "");
    if (diff.trim() || staged.trim()) return true;

    const untracked = await exec("git ls-files --others --exclude-standard").catch(() => "");
    return untracked.trim().length > 0;
  }

  /**
   * Put the working tree on the session branch, wherever the branch already
   * lives. Three cases, in order:
   *  1. HEAD is already on it — a later turn in the same workspace (the common
   *     multi-turn path; the previous turn's cycle left HEAD there).
   *  2. It exists locally or on the remote — a re-provisioned workspace whose
   *     clone lost the local branch. Checked out (tracking the remote ref when
   *     that is the only copy). The checkout carries this turn's uncommitted
   *     changes along; if they collide with the branch's prior commits git
   *     refuses, and the error surfaces as an honest FAILED record — we never
   *     force (-B) over the session's pushed history.
   *  3. Neither — the session's first write-back creates it.
   */
  private async ensureBranch(
    entryName: string,
    entryState: EntryState,
    exec: (cmd: string) => Promise<string>,
  ): Promise<void> {
    const current = (await exec("git branch --show-current").catch(() => "")).trim();
    if (current === this.branchName) {
      entryState.branchReady = true;
      return;
    }

    const localRef = await exec(
      `git rev-parse --verify --quiet refs/heads/${this.branchName}`,
    ).then((out) => out.trim(), () => "");

    if (localRef) {
      await exec(`git checkout ${this.branchName}`);
    } else {
      const remoteRef = (
        await exec(`git ls-remote --heads origin ${this.branchName}`).catch(() => "")
      ).trim();
      if (remoteRef) {
        await exec(`git fetch origin ${this.branchName}`);
        await exec(`git checkout -b ${this.branchName} origin/${this.branchName}`);
      } else {
        await exec(`git checkout -b ${this.branchName}`);
      }
    }

    entryState.branchReady = true;
    console.log(
      `[WriteBack] execution=${this.executionId} entry=${entryName} — ` +
      `on branch ${this.branchName}`,
    );
  }

  private async commitAndPush(
    entryName: string,
    entryState: EntryState,
    exec: (cmd: string) => Promise<string>,
  ): Promise<void> {
    await exec("git add -A");
    // Committed as the agent identity: the cloud sandbox has no git identity
    // configured (a bare commit fails with "Author identity unknown"), and in
    // local mode the agent's work should not be attributed to the host user.
    // The execution id in the message links each commit back to its turn.
    await exec(gitCommitAsAgent(`agent changes (${this.executionId})`));

    entryState.commitCount++;
    const shaOutput = await exec("git rev-parse HEAD");
    entryState.lastCommitSha = shaOutput.trim();

    // Always -u: idempotent whether this push creates the remote branch or
    // appends to it, and it (re-)establishes tracking after a re-provision.
    await exec(`git push -u origin ${this.branchName}`);

    console.log(
      `[WriteBack] execution=${this.executionId} entry=${entryName} — ` +
      `commit pushed to ${this.branchName} (sha=${entryState.lastCommitSha.slice(0, 12)})`,
    );
  }

  // ── GitHub PR ───────────────────────────────────────────────────────

  /**
   * Ensure one open PR exists for the session branch: adopt an already-open
   * one (a prior turn — possibly a prior coordinator instance — created it),
   * else create it. Runs only after a successful push; a thrown error here is
   * reported as PUSHED + error, never FAILED.
   */
  private async ensurePr(
    entryName: string,
    entryState: EntryState,
    entry: EligibleEntry,
  ): Promise<void> {
    const meta = entry.provisionResult.gitMetadata!;
    if (!entryState.githubOwner) {
      const { owner, repo } = parseGithubRepo(meta.repoUrl);
      entryState.githubOwner = owner;
      entryState.githubRepo = repo;
    }

    if (!this.githubToken) {
      throw new Error(
        "No GitHub token available to open a pull request. The branch " +
        `'${this.branchName}' was pushed — open the PR manually, or configure ` +
        "GITHUB_TOKEN for the session so PRs are created automatically.",
      );
    }

    const existing = await this.findOpenPr(entryState);
    if (existing) {
      entryState.prCreated = true;
      entryState.prUrl = existing.url;
      entryState.prNumber = existing.number;
      console.log(
        `[WriteBack] execution=${this.executionId} entry=${entryName} — ` +
        `adopted open PR #${existing.number}: ${existing.url}`,
      );
      return;
    }

    const shortSessionId = this.branchName.replace(/^stigmer\//, "");
    const prBody =
      `Automated pull request from a Stigmer agent session.\n\n` +
      `**Session:** \`${shortSessionId}\`\n` +
      `**Workspace:** \`${entryName}\`\n\n` +
      `Each approved turn appends its commits to this pull request.\n`;

    const resp = await fetch(
      `${GITHUB_API}/repos/${entryState.githubOwner}/${entryState.githubRepo}/pulls`,
      {
        method: "POST",
        headers: this.githubHeaders(),
        body: JSON.stringify({
          title: `Stigmer agent changes (${shortSessionId})`,
          body: prBody,
          head: this.branchName,
          base: entry.baseBranch,
        }),
      },
    );

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`GitHub API error (HTTP ${resp.status}): ${body}`);
    }

    const data = await resp.json() as { html_url?: string; number?: number };
    entryState.prCreated = true;
    entryState.prUrl = data.html_url ?? "";
    entryState.prNumber = data.number ?? 0;

    console.log(
      `[WriteBack] execution=${this.executionId} entry=${entryName} — ` +
      `PR #${entryState.prNumber} created: ${entryState.prUrl}`,
    );
  }

  /** The open PR whose head is the session branch, if one exists. */
  private async findOpenPr(
    entryState: EntryState,
  ): Promise<{ url: string; number: number } | null> {
    const head = `${entryState.githubOwner}:${this.branchName}`;
    const resp = await fetch(
      `${GITHUB_API}/repos/${entryState.githubOwner}/${entryState.githubRepo}` +
      `/pulls?head=${encodeURIComponent(head)}&state=open`,
      { headers: this.githubHeaders() },
    );

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`GitHub API error listing PRs (HTTP ${resp.status}): ${body}`);
    }

    const data = await resp.json() as Array<{ html_url?: string; number?: number }>;
    const pr = data[0];
    if (!pr) return null;
    return { url: pr.html_url ?? "", number: pr.number ?? 0 };
  }

  private githubHeaders(): Record<string, string> {
    return {
      "Authorization": `Bearer ${this.githubToken}`,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json",
    };
  }

  // ── Status Reporting ────────────────────────────────────────────────

  private async updateStatus(
    entryName: string,
    entryState: EntryState,
    entry: EligibleEntry,
    exec: (cmd: string) => Promise<string>,
    prError: string,
  ): Promise<void> {
    const summaryOutput = await exec(
      `git diff --stat ${entry.baseBranch}...HEAD`,
    ).catch(() => "");

    const phase = entryState.prCreated
      ? WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PR_CREATED
      : WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PUSHED;

    const wb = create(WorkspaceWriteBackSchema, {
      workspaceEntryName: entryName,
      branchName: this.branchName,
      baseBranch: entry.baseBranch,
      commitSha: entryState.lastCommitSha,
      pullRequestUrl: entryState.prUrl,
      pullRequestNumber: entryState.prNumber,
      diffSummary: summaryOutput.trim(),
      phase,
      // Non-empty only for a PUSHED record whose PR step failed: the branch
      // is live, and the error tells the user why there is no PR link yet.
      error: prError,
    });

    this.statusWriter.addWriteBack(wb);
  }

  // ── Concurrency ─────────────────────────────────────────────────────

  private async withLock(
    entryName: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    const existing = this.locks.get(entryName) ?? Promise.resolve();
    const next = existing.then(fn, fn);
    this.locks.set(entryName, next);
    await next;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Extract GitHub owner and repo from a clone URL.
 * Supports HTTPS (with or without .git) and SSH formats.
 */
export function parseGithubRepo(repoUrl: string): { owner: string; repo: string } {
  const httpsMatch = repoUrl.match(
    /github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/,
  );
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }
  throw new Error(`Cannot parse GitHub owner/repo from URL: ${repoUrl}`);
}
