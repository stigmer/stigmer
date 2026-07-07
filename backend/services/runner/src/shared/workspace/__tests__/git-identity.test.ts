import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AGENT_GIT_AUTHOR_NAME,
  AGENT_GIT_AUTHOR_EMAIL,
  AGENT_GIT_IDENTITY_FLAGS,
  gitCommitAsAgent,
} from "../git-identity.js";

/**
 * Environment that approximates the cloud sandbox: no global/system gitconfig,
 * no GIT_AUTHOR / GIT_COMMITTER variables. In the real sandbox a bare
 * `git commit` here fails with "Author identity unknown" (hostname-based
 * auto-detection yields an invalid ident inside the pod); on a developer
 * machine git may still auto-detect from username + hostname, so these tests
 * assert the fix's guarantee — the pinned identity always wins — rather than
 * the environment-dependent failure mode.
 */
function identitylessEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GIT_AUTHOR_NAME;
  delete env.GIT_AUTHOR_EMAIL;
  delete env.GIT_COMMITTER_NAME;
  delete env.GIT_COMMITTER_EMAIL;
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_CONFIG_SYSTEM = "/dev/null";
  return env;
}

function sh(
  cwd: string,
  command: string,
  envOverrides: Record<string, string> = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "sh",
      ["-c", command],
      { cwd, env: { ...identitylessEnv(), ...envOverrides } },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`Command failed: ${command}\n${stderr || err.message}`));
        else resolve(stdout);
      },
    );
  });
}

describe("gitCommitAsAgent (real repo, no ambient identity)", () => {
  let repo: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), "git-identity-test-"));
    await sh(repo, "git init -q");
    writeFileSync(join(repo, "notes.md"), "# Project Notes\n");
    await sh(repo, "git add -A");
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  /**
   * `user.useConfigOnly=true` (injected via git's config env) forbids the
   * username+hostname auto-detection that a developer machine would otherwise
   * fall back to — deterministically reproducing the sandbox condition where
   * git has no usable identity.
   */
  const NO_AUTODETECT_ENV = {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "user.useConfigOnly",
    GIT_CONFIG_VALUE_0: "true",
  };

  it("reproduces the cloud failure: a bare commit has no identity", async () => {
    await expect(
      sh(repo, 'git commit -m "agent changes (1)"', NO_AUTODETECT_ENV),
    ).rejects.toThrow(/user\.email|user\.name|Author identity unknown|empty ident/);
  });

  it("the agent identity satisfies git even when auto-detection is forbidden", async () => {
    await sh(repo, gitCommitAsAgent("agent changes (1)"), NO_AUTODETECT_ENV);

    const author = await sh(repo, "git log -1 --format='%an <%ae>'");
    expect(author.trim()).toBe(
      `${AGENT_GIT_AUTHOR_NAME} <${AGENT_GIT_AUTHOR_EMAIL}>`,
    );
  });

  it("commits successfully with the agent identity", async () => {
    await sh(repo, gitCommitAsAgent("agent changes (1)"));

    const author = await sh(repo, "git log -1 --format='%an <%ae>'");
    expect(author.trim()).toBe(
      `${AGENT_GIT_AUTHOR_NAME} <${AGENT_GIT_AUTHOR_EMAIL}>`,
    );

    const committer = await sh(repo, "git log -1 --format='%cn <%ce>'");
    expect(committer.trim()).toBe(
      `${AGENT_GIT_AUTHOR_NAME} <${AGENT_GIT_AUTHOR_EMAIL}>`,
    );

    const message = await sh(repo, "git log -1 --format=%s");
    expect(message.trim()).toBe("agent changes (1)");
  });

  it("never mutates the repository's git config", async () => {
    await sh(repo, gitCommitAsAgent("agent changes (1)"));

    // `git config --local` exits non-zero when the key is unset.
    await expect(sh(repo, "git config --local user.name")).rejects.toThrow();
    await expect(sh(repo, "git config --local user.email")).rejects.toThrow();
  });
});

describe("AGENT_GIT_IDENTITY_FLAGS", () => {
  it("pins both name and email via per-command -c flags", () => {
    expect(AGENT_GIT_IDENTITY_FLAGS).toBe(
      `-c user.name='${AGENT_GIT_AUTHOR_NAME}' -c user.email='${AGENT_GIT_AUTHOR_EMAIL}'`,
    );
  });
});
