// Unit arms for how the harness finds the runner it spawns: this checkout's
// built entry by default, and another checkout's when its root is given (the
// live benchmark's `--stack`), each reused when its dist exists. The file
// system is stubbed for the other checkout; nothing here builds or starts a
// runner.
// Domain: test support (stack spawns).
import { afterEach, describe, expect, it, vi } from "vitest";

// Paths the stubbed file system answers for, over the real one.
const present = new Set<string>();

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: (path: string) => present.has(String(path)) || actual.existsSync(path) };
});

const { ensureRunnerBuilt, runnerDir, runnerEntryPath } = await import("../runner-build.ts");

afterEach(() => {
  present.clear();
});

describe("the runner entry", () => {
  it("is this checkout's compiled entry by default", async () => {
    present.add(runnerEntryPath());
    expect(runnerEntryPath()).toBe(`${runnerDir()}/dist/main.js`);
    expect(await ensureRunnerBuilt()).toBe(runnerEntryPath());
  });

  it("is another checkout's compiled entry, reused as built, when its root is given", async () => {
    const root = "/elsewhere/stigmer";
    present.add(runnerEntryPath(root));
    expect(runnerEntryPath(root)).toBe("/elsewhere/stigmer/backend/services/runner/dist/main.js");
    expect(await ensureRunnerBuilt(root)).toBe("/elsewhere/stigmer/backend/services/runner/dist/main.js");
  });
});
