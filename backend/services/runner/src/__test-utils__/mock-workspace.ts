/**
 * Shared mock factory for WorkspaceBackend used across test suites.
 *
 * Returns a typed mock that satisfies the WorkspaceBackend interface.
 * Individual tests can override specific methods via the overrides param
 * or by reassigning the mock after creation.
 */

import { vi } from "vitest";
import type { WorkspaceBackend } from "../shared/workspace/types.js";

type MockOverrides = {
  [K in keyof Omit<WorkspaceBackend, "rootDir">]?: WorkspaceBackend[K];
} & { rootDir?: string };

export function mockWorkspaceBackend(overrides: MockOverrides = {}): WorkspaceBackend {
  const { rootDir = "/tmp/test-workspace", ...methodOverrides } = overrides;

  return {
    rootDir,
    execute: vi.fn().mockResolvedValue(""),
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(false),
    ...methodOverrides,
  };
}
