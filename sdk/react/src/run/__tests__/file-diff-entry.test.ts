/**
 * toFileDiffEntry projects a file change into the row a file list draws:
 * the change type in the list's words, and line counts from the change's
 * inline content, or the capture's own counts when a side is offloaded.
 */
import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { FileContentSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/message_pb";
import type { DisplayFileChange, DisplayFileChangeType } from "@stigmer/client";
import { toFileDiffEntry } from "../file-diff-entry";

function inlineSide(value: string) {
  return create(FileContentSchema, { body: { case: "inline", value } });
}

function display(init: Partial<DisplayFileChange> & { path: string }): DisplayFileChange {
  return {
    changeType: "modified",
    before: undefined,
    after: undefined,
    linesAdded: 0,
    linesRemoved: 0,
    renameFrom: "",
    ...init,
  };
}

describe("toFileDiffEntry", () => {
  it("maps change types to the file-list vocabulary", () => {
    const of = (changeType: DisplayFileChangeType) =>
      toFileDiffEntry(display({ path: "p", changeType }));
    expect(of("added").changeType).toBe("added");
    expect(of("deleted").changeType).toBe("removed");
    expect(of("modified").changeType).toBe("modified");
    expect(of("renamed").changeType).toBe("modified");
  });

  it("derives counts from inline whole-file content", () => {
    const entry = toFileDiffEntry(
      display({
        path: "src/a.ts",
        before: inlineSide("line1\nline2\n"),
        after: inlineSide("line1\nline2 changed\nline3\n"),
      }),
    );
    expect(entry.additions).toBe(2);
    expect(entry.deletions).toBe(1);
  });

  it("falls back to capture-time counts when a side is offloaded", () => {
    const entry = toFileDiffEntry(
      display({
        path: "src/big.ts",
        before: create(FileContentSchema, {
          body: {
            case: "ref",
            value: { storageKey: "artifacts/run_1/before", contentHash: "h1" },
          },
        }),
        after: inlineSide("new"),
        linesAdded: 10,
        linesRemoved: 4,
      }),
    );
    expect(entry.additions).toBe(10);
    expect(entry.deletions).toBe(4);
  });
});
