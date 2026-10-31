/**
 * Pins how a repository's token is handed to the runner's own git
 * (git-credential.ts): the header git's per-command configuration carries
 * beside hooks and the fsmonitor switched off, appended after the
 * per-command configuration the runner already carries; the version floor;
 * and the masking of a failed command's text. That only the runner's git
 * ever receives it is pinned in runner-git.test.ts and
 * token-stays-in-runner.test.ts.
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { gitTokenEnv, maskToken, meetsGitCredentialFloor } from "../git-credential.js";

const TOKEN = "ghp_realtoken_0123456789";
const BASIC = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");

describe("the header and the floor", () => {
  it("carries the token as GitHub's basic header, scoped to https://github.com/, with hooks, the fsmonitor and submodule recursion off", () => {
    expect(gitTokenEnv(TOKEN, {})).toEqual({
      GIT_CONFIG_COUNT: "5",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: "/dev/null",
      GIT_CONFIG_KEY_1: "core.fsmonitor",
      GIT_CONFIG_VALUE_1: "false",
      GIT_CONFIG_KEY_2: "fetch.recurseSubmodules",
      GIT_CONFIG_VALUE_2: "false",
      GIT_CONFIG_KEY_3: "push.recurseSubmodules",
      GIT_CONFIG_VALUE_3: "no",
      GIT_CONFIG_KEY_4: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_4: `AUTHORIZATION: basic ${BASIC}`,
    });
  });

  it("appends after the per-command configuration the runner already carries, never over it", () => {
    const env = gitTokenEnv(TOKEN, { GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "safe.directory", GIT_CONFIG_VALUE_0: "*" });
    expect(env.GIT_CONFIG_COUNT).toBe("7");
    expect(env.GIT_CONFIG_KEY_0).toBeUndefined();
    expect(env.GIT_CONFIG_KEY_2).toBe("core.hooksPath");
    expect(env.GIT_CONFIG_KEY_6).toBe("http.https://github.com/.extraheader");
    expect(gitTokenEnv(TOKEN, { GIT_CONFIG_COUNT: "garbage" }).GIT_CONFIG_COUNT).toBe("5");
  });

  it("numbers from the environment the command runs with, and git reads the header there", () => {
    const runner = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "safe.directory", GIT_CONFIG_VALUE_0: "*" };
    const readHeader = (inherited: NodeJS.ProcessEnv) =>
      execFileSync("git", ["config", "--get", "http.https://github.com/.extraheader"], { env: { ...runner, ...gitTokenEnv(TOKEN, inherited) }, encoding: "utf8" }).trim();
    expect(readHeader(runner)).toBe(`AUTHORIZATION: basic ${BASIC}`);
    const readSafeDirectory = (inherited: NodeJS.ProcessEnv) =>
      execFileSync("git", ["config", "--get", "safe.directory"], { env: { ...runner, ...gitTokenEnv(TOKEN, inherited) }, encoding: "utf8", stdio: "pipe" }).trim();
    expect(readSafeDirectory(runner), "the runner's own entry is kept").toBe("*");
    // Numbered from an environment without it, the token's entries would overwrite it.
    expect(() => readSafeDirectory({})).toThrow();
  });

  it("takes this process's environment by default: the runner's own, whose git is the only one handed a token", () => {
    vi.stubEnv("GIT_CONFIG_COUNT", "1");
    try {
      expect(gitTokenEnv(TOKEN).GIT_CONFIG_COUNT).toBe("6");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("reads 2.31 and later as meeting the floor, and nothing older or unreadable", () => {
    expect(meetsGitCredentialFloor("2.31.0")).toBe(true);
    expect(meetsGitCredentialFloor("2.39.5")).toBe(true);
    expect(meetsGitCredentialFloor("3.0")).toBe(true);
    expect(meetsGitCredentialFloor("2.30.9")).toBe(false);
    expect(meetsGitCredentialFloor("1.99")).toBe(false);
    expect(meetsGitCredentialFloor("")).toBe(false);
  });

  it("masks the token and its basic form in a failed command's text", () => {
    expect(maskToken(`fatal: ${TOKEN} and ${BASIC}`, TOKEN)).toBe("fatal: *** and ***");
    expect(maskToken("untouched", "")).toBe("untouched");
  });
});
