/**
 * A stand-in for the runner's own repository (`shared/workspace/runner-git.ts`)
 * for suites that mock the clone's commands: every method a `vi.fn` with a
 * quiet default (an empty remote, nothing to send but a bundle, a pushed
 * commit), overridable per test. Real-git behaviour is pinned in
 * `shared/workspace/__tests__/runner-git.test.ts`.
 */

import { vi, type Mock } from "vitest";
import type { RunnerRepository } from "../shared/workspace/runner-git.js";

/** The commit a fake push reports, distinct from any the clone mocks print. */
export const FAKE_PUSHED_SHA = "f00df00df00df00df00df00df00df00df00df00d";

export type FakeRunnerRepository = { [K in keyof RunnerRepository]: Mock<RunnerRepository[K]> };

export function fakeRunnerRepository(overrides: Partial<RunnerRepository> = {}): FakeRunnerRepository {
  return {
    fetch: vi.fn(overrides.fetch ?? (async () => {})),
    defaultBranch: vi.fn(overrides.defaultBranch ?? (async () => "main")),
    hasRemoteBranch: vi.fn(overrides.hasRemoteBranch ?? (async () => false)),
    heads: vi.fn(overrides.heads ?? (async () => ["1111111111111111111111111111111111111111"])),
    holdCommits: vi.fn(overrides.holdCommits ?? (async () => {})),
    hasCommit: vi.fn(overrides.hasCommit ?? (async () => false)),
    commitOf: vi.fn(overrides.commitOf ?? (async () => "2222222222222222222222222222222222222222")),
    sendBundle: vi.fn(overrides.sendBundle ?? (async () => true)),
    pushBundle: vi.fn(overrides.pushBundle ?? (async () => FAKE_PUSHED_SHA)),
    pushCommit: vi.fn(overrides.pushCommit ?? (async (sha: string) => sha)),
  };
}
