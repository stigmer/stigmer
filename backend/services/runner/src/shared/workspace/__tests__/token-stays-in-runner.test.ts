/**
 * Pins #2095 where it lives: no operation the agent host performs ever
 * carries a repository's token. Every operation on the agent's paths goes
 * through `shared/agent-fs.ts`, which a separating runner routes to the
 * host, a process of the agent's own user; whatever reaches it (a process's
 * arguments and environment, a file's bytes) the agent's other processes can
 * read while it runs. So a recording `AgentFs`, delegating to the local
 * one, watches a whole real-git cycle against a local origin: a clone with
 * a named commit no branch holds, the adoption of a session branch that
 * lives only on the remote, and the push of the agent's work. The token
 * and its basic-auth form must appear in none of it. That the runner's own
 * processes are unreadable to the agent is pinned in a container
 * (`src/__tests__/agent-separation.container.test.ts`); together the two
 * are the argument.
 *
 * The github.com URL resolves to a local bare repository through
 * `url.<base>.insteadOf` in a private global configuration, and `HOME` is
 * the test's own, so the runner's state lands in the test's directory and
 * nothing reaches the network.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { WorkspaceWriteBackPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/writeback_pb";
import { GitWriteBackMode } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { GitRepositoryResourceSchema, SessionResourceSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import { type AgentFs, installAgentFs, localAgentFs } from "../../agent-fs.js";
import { TranscriptBuilder } from "../../../harness/transcript/builder.js";
import { TurnRowsSchema } from "../../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { LocalWorkspaceBackend } from "../local-backend.js";
import { provisionGit } from "../sources/git.js";
import { WriteBackCoordinator } from "../writeback-coordinator.js";

const TOKEN = "ghp_boundary_0123456789abcdef";
const BASIC = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");
const REPO_URL = "https://github.com/acme/app.git";
const SESSION_BRANCH = "stigmer/ses_boundary";

// Real git spawns are slow under full-suite parallel load.
const GIT_TEST_TIMEOUT_MS = 120_000;

/** What the host was asked to do: each process's argv and added environment, each file's bytes. */
interface HostRecord {
  readonly what: string;
  readonly text: string;
}

/** The local operations, with every process and every byte written recorded. */
function recordingAgentFs(record: HostRecord[]): AgentFs {
  return {
    ...localAgentFs,
    execFile: (file, args, options) => {
      record.push({ what: `execFile ${file} ${args.join(" ")}`, text: [file, ...args, ...Object.entries(options?.env ?? {}).map(([k, v]) => `${k}=${v}`)].join("\n") });
      return localAgentFs.execFile(file, args, options);
    },
    writeFile: (path, data, options) => {
      record.push({ what: `writeFile ${path}`, text: Buffer.from(data).toString("latin1") });
      return localAgentFs.writeFile(path, data, options);
    },
    appendFile: (path, data) => {
      record.push({ what: `appendFile ${path}`, text: Buffer.from(data).toString("latin1") });
      return localAgentFs.appendFile(path, data);
    },
  };
}

describe("a repository's token and the agent host", () => {
  let root: string;
  let origin: string;
  let restore: () => void;
  const record: HostRecord[] = [];

  function git(cwd: string, args: string[]): string {
    return execFileSync("git", ["-c", "user.name=seed", "-c", "user.email=seed@example.com", ...args], { cwd, encoding: "utf-8", stdio: "pipe" });
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "token-boundary-"));
    origin = join(root, "origin.git");
    const seed = join(root, "seed");
    execFileSync("git", ["init", "--bare", "-b", "main", origin], { stdio: "pipe" });
    execFileSync("git", ["clone", origin, seed], { stdio: "pipe" });
    writeFileSync(join(seed, "README.md"), "# seed\n");
    git(seed, ["add", "-A"]);
    git(seed, ["commit", "-m", "seed"]);
    git(seed, ["push", "-u", "origin", "main"]);
    // A commit only a pull request's ref holds: the clone fetches it by id.
    git(seed, ["checkout", "-b", "pr"]);
    writeFileSync(join(seed, "pr.md"), "from a pull request\n");
    git(seed, ["add", "-A"]);
    git(seed, ["commit", "-m", "pr"]);
    git(seed, ["push", "origin", "pr:refs/pull/1/head"]);
    // The session branch an earlier turn pushed, which the fresh clone lacks.
    git(seed, ["checkout", "-b", "session", "main"]);
    writeFileSync(join(seed, "earlier.md"), "an earlier turn\n");
    git(seed, ["add", "-A"]);
    git(seed, ["commit", "-m", "earlier turn"]);
    git(seed, ["push", "origin", `session:refs/heads/${SESSION_BRANCH}`]);

    const globalConfig = join(root, "gitconfig");
    writeFileSync(globalConfig, `[url "file://${origin}"]\n\tinsteadOf = ${REPO_URL}\n[protocol "file"]\n\tallow = always\n`);
    vi.stubEnv("GIT_CONFIG_GLOBAL", globalConfig);
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    const home = join(root, "home");
    mkdirSync(home);
    vi.stubEnv("HOME", home);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    vi.spyOn(console, "log").mockImplementation(() => {});
    record.length = 0;
    restore = installAgentFs(recordingAgentFs(record));
  });

  afterEach(() => {
    restore();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it("is in no process the host starts and no byte it writes, across a clone, a branch adoption and a push", async () => {
    const workspace = join(root, "ws");
    mkdirSync(workspace);
    const backend = new LocalWorkspaceBackend(workspace);
    const pr = git(origin, ["rev-parse", "refs/pull/1/head"]).trim();

    const provisioned = await provisionGit({ url: REPO_URL, branch: "main", commit: pr, backend, token: TOKEN, isLocalMode: false, writeBack: true });
    expect(git(workspace, ["rev-parse", "HEAD"]).trim(), "the clone sits at the named commit").toBe(pr);

    writeFileSync(join(workspace, "change.txt"), "agent work\n");
    const status = create(RunStatusSchema, {});
    const entry = create(SessionResourceSchema, {
      name: "app",
      resource: { case: "gitRepository", value: create(GitRepositoryResourceSchema, { url: REPO_URL, writeBackMode: GitWriteBackMode.GIT_WRITE_BACK_BRANCH_AND_PR }) },
    });
    await new WriteBackCoordinator({
      writeBacks: new TranscriptBuilder("exec-boundary", create(TurnRowsSchema), status),
      executionId: "exec-boundary",
      sessionId: "ses_boundary",
      repositories: [{ name: "app", url: REPO_URL, token: TOKEN }],
      provisionResults: [{ ...provisioned, entryName: "app" }],
      resources: [entry],
      workspaceBackend: backend,
    }).finalize();

    expect(status.workspaceWriteBacks[0]?.error).toBe("");
    expect(status.workspaceWriteBacks[0]?.phase).not.toBe(WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_FAILED);
    const tip = git(origin, ["rev-parse", SESSION_BRANCH]).trim();
    expect(git(origin, ["show", `${tip}:change.txt`]), "the agent's work reached the session branch").toBe("agent work\n");
    expect(git(origin, ["show", `${tip}:earlier.md`]), "on top of the earlier turn's commit").toBe("an earlier turn\n");
    expect(status.workspaceWriteBacks[0]?.commitSha).toBe(tip);

    expect(record.length, "the host did the clone's and the write-back's work").toBeGreaterThan(10);
    const carrying = record.filter(({ text }) => text.includes(TOKEN) || text.includes(BASIC)).map(({ what }) => what);
    expect(carrying, "host operations that carried the token").toEqual([]);
  }, GIT_TEST_TIMEOUT_MS);
});
