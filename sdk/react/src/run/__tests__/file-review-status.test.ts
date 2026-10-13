/**
 * Pins how a turn's file changes read in review (../file-review-status.ts):
 * each file's reviewability from its `reviewable` word, the whole set's bulk
 * affordance, a transcript row's file and badge state matched by path within
 * a turn's review sets, the captured bytes a write row's diff renders (only
 * a complete diff), and the change word as the shared badge's enum.
 */
import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  CapturedFileChangeSchema,
  FileChangeSetSchema,
  type CapturedFileChange,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import { FileChangeKind } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { FileReviewFile, FileReviewSet } from "@stigmer/sdk";
import {
  changeForRowPath,
  changeSetReviewability,
  fileChangeKindOf,
  fileForRowPath,
  fileReviewability,
  fileReviewRowChange,
  fileReviewRowState,
} from "../file-review-status";

function file(path: string, overrides: Partial<FileReviewFile> = {}): FileReviewFile {
  return {
    fileChangeId: `fc-${path}`,
    path,
    previousPath: "",
    change: "modified",
    digest: `d-${path}`,
    linesAdded: 1,
    linesRemoved: 0,
    reviewable: "complete",
    state: "undecided",
    decidedBy: "",
    ...overrides,
  };
}

function set(files: FileReviewFile[]): FileReviewSet {
  return {
    changeSetId: "cs1",
    runId: "run_1",
    aggregateDigest: "agg",
    files,
    decisions: [],
    reconciles: [],
    undecided: files.some((f) => f.state === "undecided"),
    processedAt: "",
  };
}

function captured(id: string, path: string, diffComplete = true): CapturedFileChange {
  return create(CapturedFileChangeSchema, {
    id,
    pathBefore: path,
    pathAfter: path,
    kind: FileChangeKind.MODIFY,
    diffComplete,
  });
}

describe("fileReviewability", () => {
  it("reads each reviewable word", () => {
    expect(fileReviewability({ reviewable: "complete" })).toEqual({ kind: "reviewable" });
    expect(fileReviewability({ reviewable: "binary" })).toEqual({ kind: "binary" });
    expect(fileReviewability({ reviewable: "secret" })).toEqual({ kind: "unavailable", reason: "secret" });
    expect(fileReviewability({ reviewable: "partial" })).toEqual({ kind: "unavailable", reason: "partial" });
  });

  it("treats an unknown word as an incomplete diff", () => {
    expect(fileReviewability({ reviewable: "" })).toEqual({ kind: "unavailable", reason: "partial" });
  });
});

describe("changeSetReviewability", () => {
  it("is complete when every file is reviewable", () => {
    expect(changeSetReviewability(set([file("a"), file("b")]))).toBe("complete");
  });

  it("is binary-only when binaries are the only blocker", () => {
    expect(changeSetReviewability(set([file("a"), file("b", { reviewable: "binary" })]))).toBe("binary-only");
  });

  it("is blocked by any unavailable file", () => {
    expect(
      changeSetReviewability(set([file("a", { reviewable: "binary" }), file("b", { reviewable: "secret" })])),
    ).toBe("blocked");
  });
});

describe("fileForRowPath", () => {
  const review = set([file("src/a.ts")]);

  it("matches an exact path and an absolute path by /-boundary suffix", () => {
    expect(fileForRowPath(review, "src/a.ts")?.fileChangeId).toBe("fc-src/a.ts");
    expect(fileForRowPath(review, "/home/user/ws/src/a.ts")?.fileChangeId).toBe("fc-src/a.ts");
    expect(fileForRowPath(review, "C:\\ws\\src\\a.ts")?.fileChangeId).toBe("fc-src/a.ts");
  });

  it("never matches a partial segment, an unknown or an empty path", () => {
    expect(fileForRowPath(review, "othersrc/a.ts")).toBeNull();
    expect(fileForRowPath(review, "src/b.ts")).toBeNull();
    expect(fileForRowPath(review, "")).toBeNull();
  });
});

describe("fileReviewRowState", () => {
  it("reads each file state as a badge", () => {
    const states: Array<[FileReviewFile["state"], string]> = [
      ["undecided", "pending"],
      ["kept", "kept"],
      ["undoing", "discarded"],
      ["undone", "discarded"],
      ["undo_failed", "failed"],
    ];
    for (const [state, badge] of states) {
      expect(fileReviewRowState([set([file("a.ts", { state })])], "a.ts")).toBe(badge);
    }
  });

  it("lets a later set of the turn win", () => {
    const first = set([file("a.ts", { state: "kept" })]);
    const second = set([file("a.ts", { state: "undone" })]);
    expect(fileReviewRowState([first, second], "a.ts")).toBe("discarded");
    expect(fileReviewRowState([second, set([file("b.ts")])], "a.ts")).toBe("discarded");
  });

  it("shows no badge with no path, no review, or a file the review does not hold", () => {
    expect(fileReviewRowState([set([file("a.ts")])], null)).toBeNull();
    expect(fileReviewRowState([], "a.ts")).toBeNull();
    expect(fileReviewRowState([set([file("a.ts")])], "gone.ts")).toBeNull();
  });
});

describe("changeForRowPath", () => {
  const capture = create(FileChangeSetSchema, { id: "cs1", changes: [captured("f1", "src/a.ts")] });

  it("matches an exact or absolute path", () => {
    expect(changeForRowPath(capture, "src/a.ts")?.id).toBe("f1");
    expect(changeForRowPath(capture, "/ws/src/a.ts")?.id).toBe("f1");
  });

  it("returns null for an unknown or empty path", () => {
    expect(changeForRowPath(capture, "src/b.ts")).toBeNull();
    expect(changeForRowPath(capture, "")).toBeNull();
  });
});

describe("fileReviewRowChange", () => {
  it("resolves a complete captured change by row path", () => {
    const capture = create(FileChangeSetSchema, { changes: [captured("f1", "a.ts")] });
    expect(fileReviewRowChange(capture, "a.ts")?.id).toBe("f1");
  });

  it("returns null with no capture or path, a path miss, or an incomplete diff", () => {
    const capture = create(FileChangeSetSchema, {
      changes: [captured("f1", "a.ts"), captured("f2", "secret.env", false)],
    });
    expect(fileReviewRowChange(undefined, "a.ts")).toBeNull();
    expect(fileReviewRowChange(capture, null)).toBeNull();
    expect(fileReviewRowChange(capture, "gone.ts")).toBeNull();
    expect(fileReviewRowChange(capture, "secret.env")).toBeNull();
  });
});

describe("fileChangeKindOf", () => {
  it("reads each change word, and anything else as unspecified", () => {
    expect(fileChangeKindOf("added")).toBe(FileChangeKind.ADD);
    expect(fileChangeKindOf("modified")).toBe(FileChangeKind.MODIFY);
    expect(fileChangeKindOf("deleted")).toBe(FileChangeKind.DELETE);
    expect(fileChangeKindOf("renamed")).toBe(FileChangeKind.RENAME);
    expect(fileChangeKindOf("copied")).toBe(FileChangeKind.UNSPECIFIED);
  });
});
