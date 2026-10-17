// Unit tests for the file-record read seam: a run's captured change sets
// come from `RunStatus.file_changes` as recorded, and one set is found by
// its id. Decisions are the session's events, so nothing here derives one.

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  CapturedFileChangeSchema,
  FileChangeSetSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import { RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { FileChangeKind } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { displayFileChangeSets, fileChangeSetOf } from "../file-review-fold";

function set(id: string) {
  return create(FileChangeSetSchema, {
    id,
    changes: [
      create(CapturedFileChangeSchema, {
        id: `${id}-f1`,
        pathAfter: `src/${id}.ts`,
        kind: FileChangeKind.MODIFY,
      }),
    ],
  });
}

describe("displayFileChangeSets", () => {
  it("returns [] for an undefined status", () => {
    expect(displayFileChangeSets(undefined)).toEqual([]);
  });

  it("returns [] for a run that captured nothing", () => {
    expect(displayFileChangeSets(create(RunStatusSchema, {}))).toEqual([]);
  });

  it("returns the file record as recorded, keeping its reference", () => {
    const status = create(RunStatusSchema, { fileChanges: [set("cs1"), set("cs2")] });
    const result = displayFileChangeSets(status);
    expect(result).toBe(status.fileChanges);
    expect(result.map((s) => s.id)).toEqual(["cs1", "cs2"]);
  });
});

describe("fileChangeSetOf", () => {
  it("finds a change set by its id", () => {
    const status = create(RunStatusSchema, { fileChanges: [set("cs1"), set("cs2")] });
    expect(fileChangeSetOf(status, "cs2")?.changes[0].pathAfter).toBe("src/cs2.ts");
  });

  it("returns undefined for an unknown id or a missing status", () => {
    const status = create(RunStatusSchema, { fileChanges: [set("cs1")] });
    expect(fileChangeSetOf(status, "cs9")).toBeUndefined();
    expect(fileChangeSetOf(undefined, "cs1")).toBeUndefined();
  });
});
