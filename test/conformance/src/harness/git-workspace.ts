// A hermetic git work tree on disk for the file-review execution suites.
// Domain: conformance harness (execution engine).
//
// File review (apply-then-review HITL) is selected when a session's primary
// workspace is a real git work tree: the runner snapshots the tree at turn
// start, lets the agent's write_file/edit_file tools land, snapshots again at
// the turn boundary, and offers diff(baseline, candidate) for review. Attaching
// this directory to a session as a LocalPathSource workspace entry puts the
// runner — spawned by the same harness, on the same host — inside it, so the
// identical capture path a cloned repo would take runs with no network, no
// auth and no flake (the GitRepoSource path is HTTPS-only and needs a remote).
//
// Two seeds are load-bearing, and both come from the runner's own tests
// (shared/filereview's shadow-capture test) via the Go reference fixture
// (test/integration/harness/git_workspace.go, retired with entry 20260910.02):
//
// - `.stigmer/` is git-IGNORED, in both .gitignore and .git/info/exclude. The
//   runner persists per-session state under {workspace}/.stigmer/, and the
//   capture's `git add -A` honors both files; if that state were capturable it
//   would show up as an approval card and be clobbered by a reject.
// - `.env` is git-ignored too, which is what makes it a SECRET path for the
//   capture classifier (gitignored + secret-like name): the lever for every
//   "secret never persists" arm.
//
// The seed commit tracks .gitignore so the baseline is a clean tree and the
// agent's edits are the only diff. seedFile() adds tracked content for MODIFY
// arms; seedGitignorePattern() adds a NON-secret ignored path ("cache/") the
// CAS substrate captures for review. The identity is repo-local: the host's
// global git config is never read or written.
//
// The suite reads the tree back with readFile/exists/headSha to assert what the
// runner reconciled — its own fixture, not a runner internal.
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// The runner's per-workspace state dir and the canonical secret path, ignored
// from the first commit (see header).
const SEED_GITIGNORE = ".stigmer/\n.env\n";
// Mirrors the clone provisioner's GIT_EXCLUDE_ENTRIES (workspace/sources/git.ts)
// so a bare `.stigmer` symlink is excluded whatever .gitignore's trailing-slash
// semantics say.
const SEED_INFO_EXCLUDE = ".stigmer\nlost+found\n";

// Fails by name when git is not installed: a workspace the runner cannot
// snapshot would otherwise surface as a phase timeout in every file-review arm.
export async function requireGit(): Promise<void> {
  try {
    await execFileAsync("git", ["--version"]);
  } catch {
    throw new Error(
      "git is not on PATH; the file-review execution suites need it to seed a capture-mode workspace " +
        "(install git, or run the execution class without the file-review files)",
    );
  }
}

export class GitWorkspace {
  private constructor(readonly dir: string) {}

  // A fresh work tree with the two seeds committed. The caller owns cleanup().
  static async create(): Promise<GitWorkspace> {
    await requireGit();
    const dir = await mkdtemp(join(tmpdir(), "stigmer-conformance-workspace-"));
    const workspace = new GitWorkspace(dir);
    await workspace.git("init", "-q");
    await workspace.git("config", "user.email", "conformance@stigmer.local");
    await workspace.git("config", "user.name", "Stigmer Conformance");
    await writeFile(join(dir, ".gitignore"), SEED_GITIGNORE);
    await mkdir(join(dir, ".git", "info"), { recursive: true });
    await writeFile(join(dir, ".git", "info", "exclude"), SEED_INFO_EXCLUDE, { flag: "a" });
    await workspace.git("add", ".gitignore");
    await workspace.git("commit", "-q", "-m", "seed workspace");
    return workspace;
  }

  // Writes relPath and commits it, so the file is tracked and part of the
  // pre-turn baseline (a later edit captures as MODIFY against real "before"
  // bytes). Buffer content seeds a binary file.
  async seedFile(relPath: string, content: string | Buffer): Promise<void> {
    const abs = join(this.dir, relPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
    await this.git("add", "--", relPath);
    await this.git("commit", "-q", "-m", `seed ${relPath}`);
  }

  // Appends a pattern to the tracked .gitignore and commits it, so a matching
  // path is git-ignored from the baseline onward — a non-secret ignored path
  // the CAS substrate captures (the GIT_IGNORED_CAPTURED arms).
  async seedGitignorePattern(pattern: string): Promise<void> {
    await writeFile(join(this.dir, ".gitignore"), `${pattern}\n`, { flag: "a" });
    await this.git("add", ".gitignore");
    await this.git("commit", "-q", "-m", `gitignore ${pattern}`);
  }

  async readFile(relPath: string): Promise<string> {
    return readFile(join(this.dir, relPath), "utf8");
  }

  async readBytes(relPath: string): Promise<Buffer> {
    return readFile(join(this.dir, relPath));
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      await access(join(this.dir, relPath));
      return true;
    } catch {
      return false;
    }
  }

  // Deletes a working file (a no-op if absent), leaving .git and the artifact
  // store untouched — the model of a sandbox recycle where only the durable
  // stores survive and a reconcile must restore from them alone.
  async removeWorkingFile(relPath: string): Promise<void> {
    try {
      await unlink(join(this.dir, relPath));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  // The current HEAD. Capture mode never commits, so this is the seed commit
  // before and after every turn — the invariant the approve/reject arms assert.
  async headSha(): Promise<string> {
    return (await this.git("rev-parse", "HEAD")).trim();
  }

  async cleanup(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }

  private async git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", args, { cwd: this.dir });
    return stdout;
  }
}
