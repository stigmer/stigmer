/**
 * The runner's own git repository for each clone a token is used for: the
 * one place a repository's token reaches git (#2095).
 *
 * Why it exists. The agent's clone is the agent's: on a separating runner
 * every git command there runs in the agent host, as the agent user
 * (`../agent-fs.ts`), and any process of that user can read another's
 * environment and memory while it runs. A token handed to such a command,
 * for however short a time, is the agent's to copy. So no command in the
 * agent's clone ever carries one. The runner talks to GitHub from a bare
 * repository of its own, and moves objects to and from the clone as git
 * bundles: files of plain git data, holding no credential, written and read
 * through the agent's operations. The agent's git fetches a bundle the
 * runner made, and makes the bundle the runner pushes from.
 *
 * Where it lives. `$HOME/.stigmer/git/<key>.git`, created by the runner with
 * its own rights, in the runner's own state directory, which the agent
 * cannot read on a separating runner (`../agent-handover.ts`). The key is
 * the first 16 hex digits of sha256 of the clone's path as the runner
 * computed it, never a realpath the agent's operations answer, so no link
 * the agent plants can steer one clone onto another's repository. The
 * repository records the URL it was made for; one whose recorded URL is not
 * the entry's is rebuilt, not reused. It is a cache: deleted, it is fetched
 * again from GitHub. Every operation on one repository holds its lock
 * (`acquireDirectoryLock`, `~/.stigmer/git-locks`): a clone runs before the
 * turn lock, and two runner processes can share one state directory.
 *
 * How git runs here. Root (on a separating runner) starts git by its
 * absolute path (`programOnPath`, `../agent-identity.ts`), never through a
 * shell, its arguments an array, with `GIT_DIR` naming the repository so no
 * discovery reaches another one. The token rides only the network commands
 * (fetch, ls-remote, push), through git's per-command configuration with
 * hooks off (`./git-credential.ts`), and any error text has it masked.
 *
 * What the agent can send. A bundle from the agent is the agent's data. The
 * runner reads only the head `refs/heads/<branch>` from it, after `bundle
 * verify` has checked its prerequisites are here, and admits its pack with
 * `index-pack --strict --fix-thin`: every object checked as fsck checks it
 * and every link present, before anything names it. (`git fetch` from a
 * bundle honours `transfer.fsckObjects` only on recent git; the runner
 * image's is older.) It then pushes exactly `<tip>:refs/heads/<branch>`,
 * never forced: what reaches GitHub is fixed by the runner's refspec, not by
 * the clone's configuration. The bundle's prerequisites are always here by
 * construction: the agent excludes only commits the runner named as its own
 * heads.
 *
 * Bundles cross in {@link FS_CHUNK_BYTES} pieces read from and written to a
 * file, so a large repository never sits whole in the runner's memory.
 */

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { FS_CHUNK_BYTES } from "../../agent-host/protocol.js";
import { agentFs } from "../agent-fs.js";
import { programOnPath } from "../agent-identity.js";
import { GitTooOldError, gitTokenEnv, maskToken, meetsGitCredentialFloor } from "./git-credential.js";
import { acquireDirectoryLock } from "./workspace-lock.js";

/** An object name as git prints one: SHA-1 or SHA-256. */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** The most output one git command may print before it is stopped; the largest is a ref listing. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** Where the repository keeps the clone's commits it fetched by id ({@link RunnerRepository.holdCommits}). */
const HELD_REFS = "refs/stigmer/held";

/** How far into a bundle its header may run before the file is refused as not one. */
const MAX_BUNDLE_HEADER_BYTES = 16 * 1024 * 1024;

/**
 * The largest bundle the runner takes from the agent: GitHub refuses a push
 * over 2 GB, so a larger one could only fill the runner's disk.
 */
export const MAX_AGENT_BUNDLE_BYTES = 2 * 1024 * 1024 * 1024;

/** The runner's repository for one clone, open under its lock. */
export interface RunnerRepository {
  /** Fetches `refspecs` from GitHub; `prune` drops the heads and tags GitHub no longer has. */
  fetch(refspecs: readonly string[], options?: { readonly prune?: boolean }): Promise<void>;
  /** The branch GitHub's `HEAD` names, or "" for a repository with none (an empty one). */
  defaultBranch(): Promise<string>;
  /** Whether GitHub holds `refs/heads/<branch>`. */
  hasRemoteBranch(branch: string): Promise<boolean>;
  /**
   * The object names of this repository's heads and tags, and of the clone's
   * commits it holds for the clone ({@link holdCommits}): what a bundle from
   * the agent may leave out.
   */
  heads(): Promise<string[]>;
  /**
   * Makes sure this repository holds `shas`, commits the clone already has
   * (its remote-tracking tips), fetching by object id those it lacks, so a
   * bundle either way can leave them out. A repository rebuilt since the
   * clone was made, or one whose GitHub branches have moved on, lacks them,
   * and without them every exclusion naming them would silently fall away.
   * A commit GitHub no longer serves is left out, at the cost of a larger
   * bundle, never a failed one.
   */
  holdCommits(shas: readonly string[]): Promise<void>;
  /** Whether this repository holds the commit `sha`. */
  hasCommit(sha: string): Promise<boolean>;
  /** The commit `ref` names here. */
  commitOf(ref: string): Promise<string>;
  /**
   * Writes a bundle of `revisions` without what `haves` reach to `agentPath`,
   * through the agent's operations; `false`, writing nothing, when there is
   * nothing to send. Names in `haves` this repository lacks are ignored.
   */
  sendBundle(revisions: readonly string[], haves: readonly string[], agentPath: string): Promise<boolean>;
  /** Reads the agent's bundle at `agentPath`, admits its `refs/heads/<branch>` and pushes it there; returns the pushed commit. */
  pushBundle(agentPath: string, branch: string): Promise<string>;
  /** Pushes `sha`, a commit this repository already holds, to `refs/heads/<branch>`; returns it. */
  pushCommit(sha: string, branch: string): Promise<string>;
}

/** The runner's state directory (HOME honoured, as `workspace-lock.ts` does). */
function stateDir(): string {
  return join(process.env.HOME || process.env.USERPROFILE || homedir(), ".stigmer");
}

/** Where the runner's repository for the clone at `clonePath` lives. */
export function runnerRepositoryPath(clonePath: string): string {
  const key = createHash("sha256").update(clonePath).digest("hex").slice(0, 16);
  return join(stateDir(), "git", `${key}.git`);
}

/**
 * Opens the runner's repository for the clone at `clonePath` (the path the
 * runner computed), made for `url`, under its lock, runs `use`, and closes
 * it. The repository is created, or rebuilt when it was made for another
 * URL. `token` is handed to its network commands alone.
 */
export async function withRunnerRepository<T>(
  clonePath: string,
  url: string,
  token: string,
  use: (repository: RunnerRepository) => Promise<T>,
): Promise<T> {
  const git = programOnPath("git");
  if (git === undefined) throw new Error("git is not on this runner's PATH; a repository's token is used only by the runner's own git.");
  await assertGitFloor(git);
  const dir = runnerRepositoryPath(clonePath);
  await mkdir(join(stateDir(), "git", "tmp"), { recursive: true, mode: 0o700 });
  const release = await acquireDirectoryLock(dir, { lockDir: join(stateDir(), "git-locks") });
  try {
    const repository = new Repository(git, dir, url, token);
    await repository.open();
    return await use(repository);
  } finally {
    await release();
  }
}

/** The git versions read, by program path; only a successful read is kept. */
const versions = new Map<string, string>();

/** Refuses a git older than the floor the token's per-command configuration needs ({@link GitTooOldError}). */
async function assertGitFloor(git: string): Promise<void> {
  let version = versions.get(git) ?? "";
  if (version === "") {
    const out = await runGit(git, ["--version"], { env: process.env }).then((r) => r.stdout, () => "");
    version = /(\d+\.\d+(?:\.\d+)?)/.exec(out)?.[1] ?? "";
    if (version !== "") versions.set(git, version);
  }
  if (!meetsGitCredentialFloor(version)) throw new GitTooOldError(version === "" ? "unreadable" : version);
}

class Repository implements RunnerRepository {
  constructor(
    private readonly git: string,
    private readonly dir: string,
    private readonly url: string,
    private readonly token: string,
  ) {}

  /** Creates the repository, or rebuilds one made for another URL (or left half-made). */
  async open(): Promise<void> {
    const recorded = await this.run(["config", "--get", "remote.origin.url"]).then((out) => out.trim(), () => "");
    if (recorded === this.url) return;
    await rm(this.dir, { recursive: true, force: true });
    await runGit(this.git, ["init", "--bare", "--quiet", this.dir], { env: withoutGitDir() }).catch((err: unknown) => {
      throw new Error(`git init failed: ${errorText(err)}`);
    });
    await this.run(["config", "remote.origin.url", this.url]);
  }

  async fetch(refspecs: readonly string[], options: { readonly prune?: boolean } = {}): Promise<void> {
    await this.run(["fetch", "--quiet", "--no-write-fetch-head", ...(options.prune === true ? ["--prune"] : []), "origin", ...refspecs], { network: true });
  }

  async defaultBranch(): Promise<string> {
    const out = await this.run(["ls-remote", "--symref", "origin", "HEAD"], { network: true });
    return /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(out)?.[1] ?? "";
  }

  async hasRemoteBranch(branch: string): Promise<boolean> {
    return (await this.run(["ls-remote", "--heads", "origin", `refs/heads/${branch}`], { network: true })).trim() !== "";
  }

  async heads(): Promise<string[]> {
    const out = await this.run(["for-each-ref", "--format=%(objectname)", "refs/heads", "refs/tags", HELD_REFS]);
    return [...new Set(out.split("\n").filter((line) => OBJECT_ID.test(line)))];
  }

  async holdCommits(shas: readonly string[]): Promise<void> {
    const wanted = [...new Set(shas.filter((sha) => OBJECT_ID.test(sha)))];
    const listing = await this.run(["cat-file", "--batch-check"], { input: wanted.map((sha) => `${sha}\n`).join("") });
    const missing = listing.split("\n").filter((line) => line.endsWith(" missing")).map((line) => line.split(" ")[0]!);
    for (const sha of missing) {
      // One by one: GitHub refuses a whole fetch over one commit it no longer serves.
      await this.run(["fetch", "--quiet", "--no-write-fetch-head", "origin", `+${sha}:${HELD_REFS}/${sha}`], { network: true }).catch((err: unknown) => {
        console.warn(`[runner-git] the clone's commit ${sha} is not on GitHub; a bundle will not leave it out: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  async hasCommit(sha: string): Promise<boolean> {
    if (!OBJECT_ID.test(sha)) return false;
    return this.run(["cat-file", "-e", `${sha}^{commit}`]).then(() => true, () => false);
  }

  async commitOf(ref: string): Promise<string> {
    return (await this.run(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).trim();
  }

  async sendBundle(revisions: readonly string[], haves: readonly string[], agentPath: string): Promise<boolean> {
    const exclusions = haves.filter((sha) => OBJECT_ID.test(sha)).map((sha) => `^${sha}\n`).join("");
    // Nothing to send makes `bundle create` refuse; ask first, in git's own terms.
    const first = await this.run(["rev-list", "-n", "1", "--ignore-missing", ...revisions, "--stdin"], { input: exclusions });
    if (first.trim() === "") return false;
    const bundle = this.tempFile();
    try {
      await this.run(["bundle", "create", "--quiet", bundle, "--ignore-missing", ...revisions, "--stdin"], { input: exclusions });
      await copyToAgent(bundle, agentPath);
    } finally {
      await rm(bundle, { force: true });
    }
    return true;
  }

  async pushBundle(agentPath: string, branch: string): Promise<string> {
    const bundle = this.tempFile();
    try {
      await copyFromAgent(agentPath, bundle);
      await this.run(["bundle", "verify", "--quiet", bundle]);
      const tip = bundleHead(await this.run(["bundle", "list-heads", bundle, `refs/heads/${branch}`]), branch);
      await this.admitPack(bundle);
      return await this.pushCommit(tip, branch);
    } finally {
      await rm(bundle, { force: true });
    }
  }

  async pushCommit(sha: string, branch: string): Promise<string> {
    if (!(await this.hasCommit(sha))) throw new Error(`The commit ${sha} is not in the runner's repository; nothing was pushed.`);
    await this.run(["push", "--quiet", "origin", `${sha}:refs/heads/${branch}`], { network: true });
    // The pushed tip is a head here too, so the next bundle from the agent leaves it out.
    await this.run(["update-ref", `refs/heads/${branch}`, sha]);
    return sha;
  }

  /** Indexes the pack inside `bundle` with every object and link checked, completing it from this repository. */
  private async admitPack(bundle: string): Promise<void> {
    const start = await bundlePackOffset(bundle);
    await this.run(["index-pack", "--strict", "--fix-thin", "--stdin"], { stdinFile: { path: bundle, start } });
  }

  private tempFile(): string {
    return join(stateDir(), "git", "tmp", `${randomBytes(8).toString("hex")}.bundle`);
  }

  /** One git command in this repository; its error text has the token masked. */
  private async run(
    args: readonly string[],
    options: { readonly network?: boolean; readonly input?: string; readonly stdinFile?: StdinFile } = {},
  ): Promise<string> {
    const env: NodeJS.ProcessEnv = {
      ...withoutGitDir(),
      GIT_DIR: this.dir,
      GIT_TERMINAL_PROMPT: "0",
      ...(options.network === true ? gitTokenEnv(this.token, process.env) : {}),
    };
    try {
      return (await runGit(this.git, args, { env, cwd: this.dir, input: options.input, stdinFile: options.stdinFile })).stdout;
    } catch (err) {
      // No `cause`: the original error's text is the unmasked one.
      throw new Error(maskToken(`git ${args[0]} failed: ${errorText(err)}`, this.token));
    }
  }
}

/** The commit `refs/heads/<branch>` names in `bundle list-heads` output; the bundle must carry exactly it. */
function bundleHead(listing: string, branch: string): string {
  const lines = listing.split("\n").filter((line) => line !== "");
  const match = lines.length === 1 ? /^(\S+) (\S+)$/.exec(lines[0]!) : null;
  if (match === null || match[2] !== `refs/heads/${branch}` || !OBJECT_ID.test(match[1]!)) {
    throw new Error(`The agent's bundle does not carry refs/heads/${branch}; nothing was pushed.`);
  }
  return match[1]!;
}

/** Where the pack begins in a bundle file: after the header's blank line, at "PACK". */
export async function bundlePackOffset(bundle: string): Promise<number> {
  const handle = await open(bundle, "r");
  try {
    const size = (await handle.stat()).size;
    const length = Math.min(size, MAX_BUNDLE_HEADER_BYTES);
    const head = Buffer.alloc(length);
    await handle.read(head, 0, length, 0);
    const signature = head.subarray(0, 16).toString("latin1");
    const end = head.indexOf("\n\n");
    if (!/^# v[23] git bundle\n/.test(signature) || end < 0 || head.subarray(end + 2, end + 6).toString("latin1") !== "PACK") {
      throw new Error("The agent's file is not a git bundle; nothing was pushed.");
    }
    return end + 2;
  } finally {
    await handle.close();
  }
}

/** Copies the runner's file at `from` to the agent's `to`, in pieces of `pieceBytes`, through the agent's operations. */
export async function copyToAgent(from: string, to: string, pieceBytes: number = FS_CHUNK_BYTES): Promise<void> {
  const handle = await open(from, "r");
  try {
    const piece = Buffer.alloc(Math.min(pieceBytes, Math.max(1, (await stat(from)).size)));
    let offset = 0;
    for (;;) {
      const { bytesRead } = await handle.read(piece, 0, piece.length, offset);
      const bytes = piece.subarray(0, bytesRead);
      if (offset === 0) await agentFs().writeFile(to, bytes, { mode: 0o600 });
      else if (bytesRead > 0) await agentFs().appendFile(to, bytes);
      offset += bytesRead;
      if (bytesRead < piece.length) return;
    }
  } finally {
    await handle.close();
  }
}

/**
 * Copies the agent's file at `from` into the runner's new file `to`, piece
 * by piece, through the agent's operations, refusing one past `limit` bytes.
 */
export async function copyFromAgent(from: string, to: string, limit: number = MAX_AGENT_BUNDLE_BYTES): Promise<void> {
  const handle = await open(to, "wx", 0o600);
  try {
    let offset = 0;
    for (;;) {
      const piece = await agentFs().readRange(from, offset, FS_CHUNK_BYTES);
      if (piece.length > 0) await handle.write(piece, 0, piece.length);
      offset += piece.length;
      if (offset > limit) {
        throw new Error("The agent's changes are larger than GitHub accepts in one push; nothing was pushed.");
      }
      if (piece.length < FS_CHUNK_BYTES) return;
    }
  } finally {
    await handle.close();
  }
}

/** This process's environment without the variables that would point git at another repository. */
function withoutGitDir(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE", "GIT_COMMON_DIR"]) {
    delete env[name];
  }
  return env;
}

interface StdinFile {
  readonly path: string;
  readonly start: number;
}

/** A git command that failed, with what it printed. */
class GitRunError extends Error {
  constructor(readonly stderr: string, message: string) {
    super(message);
    this.name = "GitRunError";
  }
}

function errorText(err: unknown): string {
  if (err instanceof GitRunError) return err.stderr.trim() || err.message;
  return err instanceof Error ? err.message : String(err);
}

/** Runs `git` with `args`, feeding it `input` or a file from an offset, and resolves with its output when it exits 0. */
function runGit(
  git: string,
  args: readonly string[],
  options: { readonly env: NodeJS.ProcessEnv; readonly cwd?: string; readonly input?: string; readonly stdinFile?: StdinFile },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(git, args, { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    let overflow = false;
    const collect = (into: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) {
        overflow = true;
        child.kill("SIGKILL");
        return;
      }
      into.push(chunk);
    };
    child.stdout.on("data", collect(out));
    child.stderr.on("data", collect(err));
    child.on("error", reject);
    child.stdin.on("error", () => {
      // A command that exits before reading all of its input; its exit status says why.
    });
    child.on("close", (code, signal) => {
      const stdout = Buffer.concat(out).toString("utf8");
      const stderr = Buffer.concat(err).toString("utf8");
      if (code === 0 && !overflow) resolvePromise({ stdout, stderr });
      else reject(new GitRunError(stderr, overflow ? "printed more than the runner reads" : `exited ${code ?? signal}`));
    });
    if (options.stdinFile !== undefined) {
      createReadStream(options.stdinFile.path, { start: options.stdinFile.start }).on("error", reject).pipe(child.stdin);
    } else {
      child.stdin.end(options.input ?? "");
    }
  });
}
