// Unit tests for the CapturedFileChange -> FileChange display projection.

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  CapturedFileChangeSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { FileContentSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  FileChangeCaptureLevel,
  FileChangeKind,
  FileChangeType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { toDisplayFileChange } from "../to-display-file-change";

function inline(text: string) {
  return create(FileContentSchema, { body: { case: "inline", value: text } });
}

describe("toDisplayFileChange", () => {
  it("maps a MODIFY with both sides to a WHOLE_FILE before/after change", () => {
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
    expect(fc.changeType).toBe(FileChangeType.MODIFY);
    expect(fc.captureLevel).toBe(FileChangeCaptureLevel.WHOLE_FILE);
    expect(fc.before?.body.case).toBe("inline");
    expect(fc.after?.body.case).toBe("inline");
    expect(fc.renameFrom).toBe("");
  });

  it("maps ADD -> CREATE and uses pathAfter", () => {
    const fc = toDisplayFileChange(
      create(CapturedFileChangeSchema, {
        id: "fc1",
        pathAfter: "src/new.ts",
        kind: FileChangeKind.ADD,
        after: inline("hello"),
      }),
    );
    expect(fc.changeType).toBe(FileChangeType.CREATE);
    expect(fc.path).toBe("src/new.ts");
  });

  it("maps DELETE -> DELETE and uses pathBefore when pathAfter is empty", () => {
    const fc = toDisplayFileChange(
      create(CapturedFileChangeSchema, {
        id: "fc1",
        pathBefore: "src/gone.ts",
        kind: FileChangeKind.DELETE,
        before: inline("bye"),
      }),
    );
    expect(fc.changeType).toBe(FileChangeType.DELETE);
    expect(fc.path).toBe("src/gone.ts");
  });

  it("maps RENAME -> RENAME and carries renameFrom = pathBefore", () => {
    const fc = toDisplayFileChange(
      create(CapturedFileChangeSchema, {
        id: "fc1",
        pathBefore: "src/old-name.ts",
        pathAfter: "src/new-name.ts",
        kind: FileChangeKind.RENAME,
      }),
    );
    expect(fc.changeType).toBe(FileChangeType.RENAME);
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
