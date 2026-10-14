// Unit tests for the CapturedFileChange -> DisplayFileChange projection.

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  CapturedFileChangeSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import { FileContentSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import { FileChangeKind } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { toDisplayFileChange } from "../to-display-file-change";

function inline(text: string) {
  return create(FileContentSchema, { body: { case: "inline", value: text } });
}

describe("toDisplayFileChange", () => {
  it("maps a MODIFY with both sides to a before/after change", () => {
    const fc = toDisplayFileChange(
      create(CapturedFileChangeSchema, {
        id: "fc1",
        pathBefore: "src/a.ts",
        pathAfter: "src/a.ts",
        kind: FileChangeKind.MODIFY,
        before: inline("old"),
        after: inline("new"),
      }),
    );
    expect(fc.path).toBe("src/a.ts");
    expect(fc.changeType).toBe("modified");
    expect(fc.before?.body.case).toBe("inline");
    expect(fc.after?.body.case).toBe("inline");
    expect(fc.renameFrom).toBe("");
  });

  it("maps ADD -> added and uses pathAfter", () => {
    const fc = toDisplayFileChange(
      create(CapturedFileChangeSchema, {
        id: "fc1",
        pathAfter: "src/new.ts",
        kind: FileChangeKind.ADD,
        after: inline("hello"),
      }),
    );
    expect(fc.changeType).toBe("added");
    expect(fc.path).toBe("src/new.ts");
  });

  it("maps DELETE -> deleted and uses pathBefore when pathAfter is empty", () => {
    const fc = toDisplayFileChange(
      create(CapturedFileChangeSchema, {
        id: "fc1",
        pathBefore: "src/gone.ts",
        kind: FileChangeKind.DELETE,
        before: inline("bye"),
      }),
    );
    expect(fc.changeType).toBe("deleted");
    expect(fc.path).toBe("src/gone.ts");
  });

  it("maps RENAME -> renamed and carries renameFrom = pathBefore", () => {
    const fc = toDisplayFileChange(
      create(CapturedFileChangeSchema, {
        id: "fc1",
        pathBefore: "src/old-name.ts",
        pathAfter: "src/new-name.ts",
        kind: FileChangeKind.RENAME,
      }),
    );
    expect(fc.changeType).toBe("renamed");
    expect(fc.path).toBe("src/new-name.ts");
    expect(fc.renameFrom).toBe("src/old-name.ts");
  });

  it("carries a binary side through so the renderer can detect it", () => {
    const fc = toDisplayFileChange(
      create(CapturedFileChangeSchema, {
        id: "fc1",
        pathAfter: "img.png",
        kind: FileChangeKind.ADD,
        after: create(FileContentSchema, { isBinary: true }),
      }),
    );
    expect(fc.after?.isBinary).toBe(true);
  });

  it("carries the capture-time line counts so renderers can show +N −M without the bodies", () => {
    const fc = toDisplayFileChange(
      create(CapturedFileChangeSchema, {
        id: "fc1",
        pathBefore: "src/a.ts",
        pathAfter: "src/a.ts",
        kind: FileChangeKind.MODIFY,
        linesAdded: 37,
        linesRemoved: 2,
      }),
    );
    expect(fc.linesAdded).toBe(37);
    expect(fc.linesRemoved).toBe(2);
  });
});
