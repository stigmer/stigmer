/**
 * useSessionWriteBacks flattens a session's workspace write-backs across its
 * runs: one entry per workspace entry name, the latest run's write-back
 * winning, each tagged with the run that produced it, sorted by entry name
 * case-insensitively.
 */
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { RunSchema, type Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { WorkspaceWriteBackSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/writeback_pb";
import { useSessionWriteBacks } from "../useSessionWriteBacks";

function runWithWriteBacks(id: string, entryNames: string[]): Run {
  return create(RunSchema, {
    metadata: { id },
    status: {
      workspaceWriteBacks: entryNames.map((workspaceEntryName) =>
        create(WorkspaceWriteBackSchema, { workspaceEntryName }),
      ),
    },
  });
}

describe("useSessionWriteBacks", () => {
  it("reports none for a session without write-backs", () => {
    const { result } = renderHook(() => useSessionWriteBacks([create(RunSchema)]));
    expect(result.current).toEqual({ writeBacks: [], hasWriteBacks: false, writeBackCount: 0 });
  });

  it("keeps the latest run's write-back per entry, sorted by entry name", () => {
    const runs = [
      runWithWriteBacks("aex_1", ["web", "api"]),
      runWithWriteBacks("aex_2", ["Docs", "api"]),
    ];
    const { result } = renderHook(() => useSessionWriteBacks(runs));

    expect(result.current.writeBackCount).toBe(3);
    expect(result.current.hasWriteBacks).toBe(true);
    expect(
      result.current.writeBacks.map((e) => [e.writeBack.workspaceEntryName, e.runId]),
    ).toEqual([
      ["api", "aex_2"],
      ["Docs", "aex_2"],
      ["web", "aex_1"],
    ]);
  });

  it("tags a write-back from a run without an id with an empty run id", () => {
    const run = create(RunSchema, {
      status: { workspaceWriteBacks: [create(WorkspaceWriteBackSchema, { workspaceEntryName: "repo" })] },
    });
    const { result } = renderHook(() => useSessionWriteBacks([run]));
    expect(result.current.writeBacks[0]!.runId).toBe("");
  });
});
