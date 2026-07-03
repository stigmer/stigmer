import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  FileChangeSchema,
  type FileChange,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { FileChangeType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";

// ---------------------------------------------------------------------------
// useOpenFileChange correlates the open file with the ONE session change that
// touched it (diff-as-default source, DD-06) — the contract that used to live on
// the inspector's Viewer tab and now feeds the workspace surface. The fold
// (useSessionFileChanges) is mocked; the join (findChangeForSelection) is real.
// ---------------------------------------------------------------------------

let mockFileChanges: FileChange[] = [];
vi.mock("../useSessionFileChanges", () => ({
  useSessionFileChanges: (executions: readonly unknown[]) => ({
    // Honor the EMPTY_EXECUTIONS gate: no executions in → no changes out.
    fileChanges: executions.length > 0 ? mockFileChanges : [],
    hasFileChanges: executions.length > 0 && mockFileChanges.length > 0,
    fileChangeCount: executions.length > 0 ? mockFileChanges.length : 0,
  }),
}));

import { useOpenFileChange } from "../useOpenFileChange";

const gitEntry = {
  id: "e1",
  name: "acme/app",
  type: "git" as const,
  gitUrl: "https://github.com/acme/app.git",
  gitBranch: "main",
};
const entries = [gitEntry] as never;
const allExecutions = [{} as AgentExecution];
const root = "/home/daytona/workspace";

function modifyChange(path: string): FileChange {
  return create(FileChangeSchema, { path, changeType: FileChangeType.MODIFY });
}

beforeEach(() => {
  mockFileChanges = [];
});
afterEach(() => vi.clearAllMocks());

describe("useOpenFileChange", () => {
  it("returns the matching change for the open file", () => {
    mockFileChanges = [modifyChange("src/a.ts")];
    const { result } = renderHook(() =>
      useOpenFileChange({ entryId: "e1", path: "src/a.ts" }, allExecutions, entries, root),
    );
    expect(result.current).toBe(mockFileChanges[0]);
  });

  it("returns null when the open file was not changed this session", () => {
    mockFileChanges = [modifyChange("src/a.ts")];
    const { result } = renderHook(() =>
      useOpenFileChange({ entryId: "e1", path: "src/other.ts" }, allExecutions, entries, root),
    );
    expect(result.current).toBeNull();
  });

  it("returns null when no file is open (fold is skipped)", () => {
    mockFileChanges = [modifyChange("src/a.ts")];
    const { result } = renderHook(() =>
      useOpenFileChange(null, allExecutions, entries, root),
    );
    expect(result.current).toBeNull();
  });

  it("returns null when the session has no changes", () => {
    mockFileChanges = [];
    const { result } = renderHook(() =>
      useOpenFileChange({ entryId: "e1", path: "src/a.ts" }, allExecutions, entries, root),
    );
    expect(result.current).toBeNull();
  });
});
