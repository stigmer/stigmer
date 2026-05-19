/**
 * Incremental git write-back coordinator for workspace entries.
 *
 * During agent execution, each file-modifying tool call triggers an
 * incremental commit-and-push cycle for the affected git workspace.
 * The first cycle creates the branch and PR; subsequent cycles add
 * commits to the same branch — the PR updates automatically on GitHub.
 *
 * DD-5: Incremental writeback, not batch.
 *
 * Lifecycle:
 *   1. Created after workspace provisioning in index.ts.
 *   2. `onFileModified(path)` called from streaming on each write/edit tool end.
 *   3. `finalize()` called from post-stream as a safety net.
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
import type { WorkspaceBackend, ProvisionResult } from "../../shared/workspace/types.js";
import { SourceType } from "../../shared/workspace/types.js";
import type { StatusBuilder } from "./status-builder.js";

const WRITE_BACK_ENABLED_MODES = new Set([
  GitWriteBackMode.GIT_WRITE_BACK_MODE_UNSPECIFIED,
  GitWriteBackMode.GIT_WRITE_BACK_BRANCH_AND_PR,
]);

interface EntryState {
  branchCreated: boolean;
  prCreated: boolean;
  prUrl: string;
  prNumber: number;
  commitCount: number;
  lastCommitSha: string;
  githubToken: string;
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
  private readonly statusBuilder: StatusBuilder;
  private readonly executionId: string;
  private readonly workspaceBackend: WorkspaceBackend;
  private readonly shortId: string;
  private readonly branchName: string;

  private readonly eligible = new Map<string, EligibleEntry>();
  private readonly state = new Map<string, EntryState>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(opts: {
    statusBuilder: StatusBuilder;
    executionId: string;
    provisionResults: readonly ProvisionResult[];
    workspaceEntries: readonly WorkspaceEntry[];
    workspaceBackend: WorkspaceBackend;
  }) {
    this.statusBuilder = opts.statusBuilder;
    this.executionId = opts.executionId;
    this.workspaceBackend = opts.workspaceBackend;
    this.shortId = opts.executionId.slice(0, 8);
    this.branchName = `stigmer/${this.shortId}`;

    this.initEligibleEntries(opts.provisionResults, opts.workspaceEntries);
  }

  get hasEligibleEntries(): boolean {
    return this.eligible.size > 0;
  }

  /**
   * Called after a file-modifying tool completes. Resolves the path to
   * a workspace entry and runs an incremental commit/push cycle.
   * Fire-and-forget: errors are logged, never thrown.
   */
  async onFileModified(path: string): Promise<void> {
    try {
      const entryName = this.resolveEntry(path);
      if (!entryName) return;

      await this.withLock(entryName, () =>
        this.incrementalWriteBack(entryName),
      );
    } catch (err) {
      console.warn(
        `[WriteBack] execution=${this.executionId} — ` +
        `onFileModified error for '${path}': ${err}`,
      );
    }
  }

  /**
   * Post-execution safety net. Checks every eligible workspace entry
   * for remaining uncommitted changes and commits/pushes them.
   */
  async finalize(): Promise<void> {
    for (const entryName of this.eligible.keys()) {
      try {
        await this.withLock(entryName, () =>
          this.incrementalWriteBack(entryName),
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
        branchCreated: false,
        prCreated: false,
        prUrl: "",
        prNumber: 0,
        commitCount: 0,
        lastCommitSha: "",
        githubToken: "",
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

  // ── Core Incremental Write-Back ─────────────────────────────────────

  private async incrementalWriteBack(entryName: string): Promise<void> {
    const entry = this.eligible.get(entryName)!;
    const entryState = this.state.get(entryName)!;
    const rootDir = entry.rootDir;

    const exec = async (cmd: string): Promise<string> => {
      return this.workspaceBackend.execute(`cd ${rootDir} && ${cmd}`);
    };

    let mutationStarted = false;
    try {
      const hasChanges = await this.hasChanges(exec);
      if (!hasChanges) return;

      mutationStarted = true;

      if (!entryState.branchCreated) {
        await this.createBranch(entryName, entryState, exec);
      }

      const commitMsg = `agent changes (${entryState.commitCount + 1})`;
      await this.commitAndPush(entryName, entryState, exec, commitMsg);

      if (!entryState.prCreated) {
        await this.createPr(entryName, entryState, entry, exec);
      }

      await this.updateStatus(entryName, entryState, entry, exec);

    } catch (err) {
      console.warn(
        `[WriteBack] execution=${this.executionId} entry=${entryName} — ` +
        `incremental error: ${err}`,
      );
      if (!mutationStarted) return;

      const wb = create(WorkspaceWriteBackSchema, {
        workspaceEntryName: entryName,
        baseBranch: entry.baseBranch,
        branchName: entryState.branchCreated ? this.branchName : "",
        phase: WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_FAILED,
        error: String(err),
      });
      if (entryState.prCreated) {
        wb.pullRequestUrl = entryState.prUrl;
        wb.pullRequestNumber = entryState.prNumber;
      }
      this.statusBuilder.addWriteBack(wb);
    }
  }

  // ── Git Operations ──────────────────────────────────────────────────

  private async hasChanges(exec: (cmd: string) => Promise<string>): Promise<boolean> {
    const diff = await exec("git diff --stat").catch(() => "");
    const staged = await exec("git diff --cached --stat").catch(() => "");
    if (diff.trim() || staged.trim()) return true;

    const untracked = await exec("git ls-files --others --exclude-standard").catch(() => "");
    return untracked.trim().length > 0;
  }

  private async createBranch(
    entryName: string,
    entryState: EntryState,
    exec: (cmd: string) => Promise<string>,
  ): Promise<void> {
    await exec(`git checkout -b ${this.branchName}`);
    entryState.branchCreated = true;
    console.log(
      `[WriteBack] execution=${this.executionId} entry=${entryName} — ` +
      `created branch ${this.branchName}`,
    );
  }

  private async commitAndPush(
    entryName: string,
    entryState: EntryState,
    exec: (cmd: string) => Promise<string>,
    commitMsg: string,
  ): Promise<void> {
    await exec("git add -A");
    await exec(`git commit -m "${commitMsg}"`);

    entryState.commitCount++;
    const shaOutput = await exec("git rev-parse HEAD");
    entryState.lastCommitSha = shaOutput.trim();

    if (entryState.commitCount === 1) {
      await exec(`git push -u origin ${this.branchName}`);
    } else {
      await exec("git push");
    }

    console.log(
      `[WriteBack] execution=${this.executionId} entry=${entryName} — ` +
      `commit #${entryState.commitCount} pushed (sha=${entryState.lastCommitSha.slice(0, 12)})`,
    );
  }

  private async createPr(
    entryName: string,
    entryState: EntryState,
    entry: EligibleEntry,
    _exec: (cmd: string) => Promise<string>,
  ): Promise<void> {
    const meta = entry.provisionResult.gitMetadata!;
    const { owner, repo } = parseGithubRepo(meta.repoUrl);

    if (!entryState.githubToken) {
      entryState.githubToken = extractGithubToken(meta.repoUrl);
      entryState.githubOwner = owner;
      entryState.githubRepo = repo;
    }

    const prTitle = `Agent changes (${this.shortId})`;
    const prBody =
      `Automated pull request from Stigmer agent execution.\n\n` +
      `**Execution:** \`${this.executionId}\`\n` +
      `**Workspace:** \`${entryName}\`\n`;

    const resp = await fetch(
      `https://api.github.com/repos/${entryState.githubOwner}/${entryState.githubRepo}/pulls`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${entryState.githubToken}`,
          "Accept": "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: prTitle,
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

  private async updateStatus(
    entryName: string,
    entryState: EntryState,
    entry: EligibleEntry,
    exec: (cmd: string) => Promise<string>,
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
    });

    this.statusBuilder.addWriteBack(wb);
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

/**
 * Extract a GitHub token from an HTTPS clone URL that has credentials embedded.
 * Format: https://{token}@github.com/...
 */
export function extractGithubToken(repoUrl: string): string {
  const match = repoUrl.match(/https?:\/\/([^@]+)@github\.com/);
  if (match) return match[1];

  const envToken = process.env.GITHUB_TOKEN;
  if (envToken) return envToken;

  throw new Error(
    "Cannot extract GitHub token from repo URL and GITHUB_TOKEN is not set",
  );
}
