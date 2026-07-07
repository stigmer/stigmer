import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  WorkspaceWriteBackSchema,
  WorkspaceWriteBackPhase,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/writeback_pb";
import type { WorkspaceEntry } from "../../workspace/useWorkspaceEntries";
import { useWorkspaceReadRefs } from "../useWorkspaceReadRefs";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function gitEntry(overrides?: Partial<WorkspaceEntry>): WorkspaceEntry {
  return {
    id: "ws-1",
    name: "acme/api",
    type: "git",
    gitUrl: "https://github.com/acme/api",
    gitBranch: "main",
    ...overrides,
  };
}

function localEntry(): WorkspaceEntry {
  return {
    id: "ws-local",
    name: "dev/project",
    type: "local",
    localPath: "/Users/dev/project",
  };
}

function execWithWriteBacks(
  id: string,
  writeBacks: ReadonlyArray<{
    entryName: string;
    commitSha: string;
    phase?: WorkspaceWriteBackPhase;
  }>,
): AgentExecution {
  const exec = create(AgentExecutionSchema);
  exec.metadata = create(ApiResourceMetadataSchema, { id });
  exec.status = create(AgentExecutionStatusSchema);
  exec.status.workspaceWriteBacks = writeBacks.map((wb) =>
    create(WorkspaceWriteBackSchema, {
      workspaceEntryName: wb.entryName,
      commitSha: wb.commitSha,
      phase: wb.phase ?? WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PUSHED,
    }),
  );
  return exec;
}

// ---------------------------------------------------------------------------
// useWorkspaceReadRefs
// ---------------------------------------------------------------------------

describe("useWorkspaceReadRefs", () => {
  it("returns the same entries reference when there are no write-backs", () => {
    const entries = [gitEntry()];
    const { result } = renderHook(() => useWorkspaceReadRefs([], entries));
    expect(result.current).toBe(entries);
  });

  it("decorates a single git entry from a write-back with a matching name", () => {
    const entries = [gitEntry({ name: "acme/api" })];
    const executions = [
      execWithWriteBacks("e1", [{ entryName: "acme/api", commitSha: "sha-1" }]),
    ];

    const { result } = renderHook(() =>
      useWorkspaceReadRefs(executions, entries),
    );

    expect(result.current[0].readRef).toBe("sha-1");
  });

  it("applies an empty-name write-back to the lone git entry (single-entry convention)", () => {
    // Single-entry sessions provision with entryName "" — the runner's
    // WriteBackCoordinator writes back under that empty name.
    const entries = [gitEntry()];
    const executions = [
      execWithWriteBacks("e1", [{ entryName: "", commitSha: "sha-solo" }]),
    ];

    const { result } = renderHook(() =>
      useWorkspaceReadRefs(executions, entries),
    );

    expect(result.current[0].readRef).toBe("sha-solo");
  });

  it("claims a lone mismatched name for a lone git entry, but never for multiple entries", () => {
    const solo = renderHook(() =>
      useWorkspaceReadRefs(
        [execWithWriteBacks("e1", [{ entryName: "other-name", commitSha: "sha-x" }])],
        [gitEntry()],
      ),
    );
    expect(solo.result.current[0].readRef).toBe("sha-x");

    // With two git entries an unmatched name is ambiguous — decorate nothing.
    const multi = renderHook(() =>
      useWorkspaceReadRefs(
        [execWithWriteBacks("e1", [{ entryName: "other-name", commitSha: "sha-x" }])],
        [
          gitEntry({ id: "ws-1", name: "acme/api" }),
          gitEntry({ id: "ws-2", name: "acme/web" }),
        ],
      ),
    );
    expect(multi.result.current[0].readRef).toBeUndefined();
    expect(multi.result.current[1].readRef).toBeUndefined();
  });

  it("the latest non-empty SHA wins across executions in order", () => {
    const entries = [gitEntry({ name: "acme/api" })];
    const executions = [
      execWithWriteBacks("e1", [{ entryName: "acme/api", commitSha: "sha-old" }]),
      execWithWriteBacks("e2", [{ entryName: "acme/api", commitSha: "sha-new" }]),
    ];

    const { result } = renderHook(() =>
      useWorkspaceReadRefs(executions, entries),
    );

    expect(result.current[0].readRef).toBe("sha-new");
  });

  it("a FAILED write-back with no SHA never regresses an earlier successful ref", () => {
    const entries = [gitEntry({ name: "acme/api" })];
    const executions = [
      execWithWriteBacks("e1", [{ entryName: "acme/api", commitSha: "sha-good" }]),
      execWithWriteBacks("e2", [
        {
          entryName: "acme/api",
          commitSha: "",
          phase: WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_FAILED,
        },
      ]),
    ];

    const { result } = renderHook(() =>
      useWorkspaceReadRefs(executions, entries),
    );

    expect(result.current[0].readRef).toBe("sha-good");
  });

  it("returns entries unchanged when only FAILED no-SHA write-backs exist", () => {
    const entries = [gitEntry()];
    const executions = [
      execWithWriteBacks("e1", [
        {
          entryName: "",
          commitSha: "",
          phase: WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_FAILED,
        },
      ]),
    ];

    const { result } = renderHook(() =>
      useWorkspaceReadRefs(executions, entries),
    );

    expect(result.current).toBe(entries);
  });

  it("matches strictly by name in multi-entry sessions", () => {
    const entries = [
      gitEntry({ id: "ws-1", name: "frontend" }),
      gitEntry({ id: "ws-2", name: "backend" }),
    ];
    const executions = [
      execWithWriteBacks("e1", [
        { entryName: "frontend", commitSha: "sha-fe" },
        { entryName: "backend", commitSha: "sha-be" },
      ]),
    ];

    const { result } = renderHook(() =>
      useWorkspaceReadRefs(executions, entries),
    );

    expect(result.current[0].readRef).toBe("sha-fe");
    expect(result.current[1].readRef).toBe("sha-be");
  });

  it("never decorates local entries", () => {
    const entries = [localEntry()];
    const executions = [
      execWithWriteBacks("e1", [{ entryName: "", commitSha: "sha-1" }]),
    ];

    const { result } = renderHook(() =>
      useWorkspaceReadRefs(executions, entries),
    );

    expect(result.current[0].readRef).toBeUndefined();
    expect(result.current).toBe(entries);
  });

  it("returns a stable array across streaming frames that change no SHA (DD-010)", () => {
    const entries = [gitEntry({ name: "acme/api" })];
    const { result, rerender } = renderHook(
      (props: { executions: readonly AgentExecution[] }) =>
        useWorkspaceReadRefs(props.executions, entries),
      {
        initialProps: {
          executions: [
            execWithWriteBacks("e1", [{ entryName: "acme/api", commitSha: "sha-1" }]),
          ] as readonly AgentExecution[],
        },
      },
    );

    const first = result.current;
    expect(first[0].readRef).toBe("sha-1");

    // A new executions array (fresh identity, e.g. a streaming frame) with the
    // same SHA must return the identical decorated array.
    rerender({
      executions: [
        execWithWriteBacks("e1", [{ entryName: "acme/api", commitSha: "sha-1" }]),
      ],
    });
    expect(result.current).toBe(first);

    // Advancing the SHA produces a new decoration.
    rerender({
      executions: [
        execWithWriteBacks("e1", [{ entryName: "acme/api", commitSha: "sha-2" }]),
      ],
    });
    expect(result.current[0].readRef).toBe("sha-2");
  });
});
