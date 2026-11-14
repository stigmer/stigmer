// Proves useFileReviewRowFile: the file of a row's turn's review its path
// refers to, newest review first, through the same path match the row's
// badge and diff use; null with no review for the turn, a path the review
// does not hold, or no path at all.

import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { FileReviewFile, FileReviewSet } from "@stigmer/client";
import { FileReviewContext } from "../FileReviewContext";
import { useFileReviewRowFile } from "../FileReviewContext";

function file(path: string, change: FileReviewFile["change"]): FileReviewFile {
  return { fileChangeId: `fc-${path}`, path, previousPath: "", change, digest: "d", linesAdded: 1, linesRemoved: 0, reviewable: "complete", state: "undecided", decidedBy: "" };
}

function set(id: string, files: FileReviewFile[]): FileReviewSet {
  return { changeSetId: id, runId: "run_1", aggregateDigest: "a", decisions: [], reconciles: [], undecided: true, processedAt: "", files };
}

function wrapper(sets: FileReviewSet[]) {
  return ({ children }: { children: ReactNode }) => (
    <FileReviewContext.Provider value={{ fileReviewByRunId: new Map([["run_1", sets]]), changeSetsById: new Map() }}>{children}</FileReviewContext.Provider>
  );
}

describe("useFileReviewRowFile", () => {
  it("finds the row's file in its turn's newest review that holds it", () => {
    const sets = [set("cs-1", [file("src/a.ts", "modified")]), set("cs-2", [file("src/a.ts", "added")])];
    const { result } = renderHook(() => useFileReviewRowFile("run_1", "/workspace/src/a.ts"), { wrapper: wrapper(sets) });
    expect(result.current?.change).toBe("added");
  });

  it("is null for a path the review does not hold, a turn with no review, or no path", () => {
    const sets = [set("cs-1", [file("src/a.ts", "added")])];
    expect(renderHook(() => useFileReviewRowFile("run_1", "src/b.ts"), { wrapper: wrapper(sets) }).result.current).toBeNull();
    expect(renderHook(() => useFileReviewRowFile("run_2", "src/a.ts"), { wrapper: wrapper(sets) }).result.current).toBeNull();
    expect(renderHook(() => useFileReviewRowFile("run_1", null), { wrapper: wrapper(sets) }).result.current).toBeNull();
  });
});
