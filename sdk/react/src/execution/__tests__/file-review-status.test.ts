import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  FileContentSchema,
  ToolCallOutputRefSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { FileContent } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  CapturedFileChangeSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { FileChangeKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { fileReviewability } from "../file-review-status";

/** Inline text side (the git substrate's shape). */
function inline(value: string, isBinary = false): FileContent {
  return create(FileContentSchema, { body: { case: "inline", value }, isBinary });
}

/** Offloaded blob-ref side (large/CAS bodies), carrying its own is_binary. */
function ref(isBinary: boolean): FileContent {
  return create(FileContentSchema, {
    body: {
      case: "ref",
      value: create(ToolCallOutputRefSchema, {
        storageKey: "artifacts/x/filereview/c.after.txt",
        sizeBytes: 1_048_576n,
        contentHash: "sha256:deadbeef",
      }),
    },
    isBinary,
  });
}

function change(opts: {
  kind?: FileChangeKind;
  diffComplete: boolean;
  before?: FileContent;
  after?: FileContent;
}) {
  const fc = create(CapturedFileChangeSchema, {
    id: "cs:0:p",
    pathBefore: "p",
    pathAfter: "p",
    kind: opts.kind ?? FileChangeKind.MODIFY,
    diffComplete: opts.diffComplete,
  });
  if (opts.before) fc.before = opts.before;
  if (opts.after) fc.after = opts.after;
  return fc;
}

describe("fileReviewability", () => {
  it("classifies a complete text diff as reviewable", () => {
    expect(
      fileReviewability(
        change({ diffComplete: true, before: inline("old\n"), after: inline("new\n") }),
      ),
    ).toBe("reviewable");
  });

  it("stays reviewable when complete even if a side is (incongruously) flagged binary — diff_complete wins", () => {
    // diff_complete is the authoritative signal; a complete change is reviewable.
    expect(
      fileReviewability(
        change({ diffComplete: true, before: inline("a", true), after: inline("b", true) }),
      ),
    ).toBe("reviewable");
  });

  it("classifies an incomplete change with a binary before side as binary", () => {
    expect(
      fileReviewability(
        change({ diffComplete: false, before: inline("\u0000\u0001", true), after: inline("\u0000", true) }),
      ),
    ).toBe("binary");
  });

  it("classifies an incomplete change with only an after binary side as binary", () => {
    expect(
      fileReviewability(change({ diffComplete: false, after: inline("\u0000", true) })),
    ).toBe("binary");
  });

  it("classifies a binary side that was offloaded to a ref as binary (offload preserves is_binary)", () => {
    expect(
      fileReviewability(change({ diffComplete: false, after: ref(true) })),
    ).toBe("binary");
  });

  it("classifies a content-less secret-withheld change as unavailable", () => {
    // The secret gate authors the change with no before/after and diff_complete=false.
    expect(fileReviewability(change({ diffComplete: false }))).toBe("unavailable");
  });

  it("classifies a size-elided change (bodies dropped, marked incomplete) as unavailable — same bucket as secret-withheld", () => {
    // The size backstop drops the inline bodies and sets diff_complete=false; on
    // the wire this is byte-identical to the secret case, so the honest, cause-
    // agnostic classification is the same.
    expect(fileReviewability(change({ diffComplete: false }))).toBe("unavailable");
  });

  it("does not misread a one-sided binary ADD as unavailable", () => {
    expect(
      fileReviewability(
        change({ kind: FileChangeKind.ADD, diffComplete: false, after: inline("\u0000", true) }),
      ),
    ).toBe("binary");
  });

  it("does not misread a one-sided binary DELETE as unavailable", () => {
    expect(
      fileReviewability(
        change({ kind: FileChangeKind.DELETE, diffComplete: false, before: inline("\u0000", true) }),
      ),
    ).toBe("binary");
  });
});
