/**
 * Pins the agent's half of the handoff (clone-handoff.ts) where real git
 * cannot reach it: a git directory the clone answers with that is not an
 * absolute path is refused before any file crosses, and only object names
 * count as what the clone has. The flows themselves run against real git in
 * runner-git.test.ts and token-stays-in-runner.test.ts.
 */
import { describe, expect, it } from "vitest";
import { fakeRunnerRepository } from "../../../__test-utils__/fake-runner-repository.js";
import { cloneHaves, fetchFromRunner, pushThroughRunner } from "../clone-handoff.js";

describe("the clone's half of a handoff", () => {
  it("refuses a git directory that is not an absolute path, sending nothing", async () => {
    const repository = fakeRunnerRepository();
    await expect(
      fetchFromRunner(repository, async () => ".git\n", { revisions: ["--branches"], haves: [], refspecs: [] }),
    ).rejects.toThrow("not an absolute path");
    expect(repository.sendBundle).not.toHaveBeenCalled();
  });

  it("counts only object names as what the clone has", async () => {
    const sha = "a".repeat(40);
    expect(await cloneHaves(async () => `${sha}\nnot-a-sha\n\n${"b".repeat(64)}\n`)).toEqual([sha, "b".repeat(64)]);
  });

  it("finishes a handoff whose file the clone could not remove", async () => {
    const exec = async (command: string): Promise<string> => {
      if (command.startsWith("rm ")) throw new Error("read-only file system");
      return command === "git rev-parse --absolute-git-dir" ? "/w/.git\n" : "";
    };
    expect(await fetchFromRunner(fakeRunnerRepository(), exec, { revisions: ["--branches"], haves: [], refspecs: [] })).toBe(true);
    expect(await pushThroughRunner(fakeRunnerRepository({ pushBundle: async () => "c".repeat(40) }), exec, async () => {}, "stigmer/s")).toBe("c".repeat(40));
  });
});
