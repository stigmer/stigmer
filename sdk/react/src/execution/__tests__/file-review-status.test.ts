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
import {
  FileChangeKind,
  FileReviewBlockReason,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
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
  blockedReason?: FileReviewBlockReason;
}) {
  const fc = create(CapturedFileChangeSchema, {
    id: "cs:0:p",
    pathBefore: "p",
    pathAfter: "p",
    kind: opts.kind ?? FileChangeKind.MODIFY,
    diffComplete: opts.diffComplete,
    blockedReason: opts.blockedReason ?? FileReviewBlockReason.UNSPECIFIED,
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
    ).toEqual({ kind: "reviewable" });
  });

  it("stays reviewable when complete even if a side is (incongruously) flagged binary — diff_complete wins", () => {
    // diff_complete is the authoritative signal; a complete change is reviewable.
    expect(
      fileReviewability(
        change({ diffComplete: true, before: inline("a", true), after: inline("b", true) }),
      ),
    ).toEqual({ kind: "reviewable" });
  });

  it("classifies an incomplete change with a binary before side as binary", () => {
    expect(
      fileReviewability(
        change({ diffComplete: false, before: inline("\u0000\u0001", true), after: inline("\u0000", true) }),
      ),
    ).toEqual({ kind: "binary" });
  });

  it("classifies an incomplete change with only an after binary side as binary", () => {
    expect(
      fileReviewability(change({ diffComplete: false, after: inline("\u0000", true) })),
    ).toEqual({ kind: "binary" });
  });

  it("classifies a binary side that was offloaded to a ref as binary (offload preserves is_binary)", () => {
    expect(
      fileReviewability(change({ diffComplete: false, after: ref(true) })),
    ).toEqual({ kind: "binary" });
  });

  it("prefers binary over a stray blocked_reason (is_binary is the authoritative binary signal)", () => {
    // Defensive: even if a reason were somehow set on a binary change, the wire
    // proves binary via is_binary, which the classifier resolves first.
    expect(
      fileReviewability(
        change({
          diffComplete: false,
          after: inline("\u0000", true),
          blockedReason: FileReviewBlockReason.SIZE_ELIDED,
        }),
      ),
    ).toEqual({ kind: "binary" });
  });

  it("classifies a secret-withheld change as unavailable with reason 'secret' (doc 15)", () => {
    // The secret gate authors the change content-less, diff_complete=false, and
    // records SECRET_WITHHELD so the UI can say *why*.
    expect(
      fileReviewability(
        change({ diffComplete: false, blockedReason: FileReviewBlockReason.SECRET_WITHHELD }),
      ),
    ).toEqual({ kind: "unavailable", reason: "secret" });
  });

  it("classifies a size-elided change as unavailable with reason 'size' — distinct from secret (doc 15)", () => {
    // The size backstop drops the inline bodies, sets diff_complete=false, and
    // records SIZE_ELIDED. Once byte-identical to the secret case; now honestly
    // distinguished by the recorded reason.
    expect(
      fileReviewability(
        change({ diffComplete: false, blockedReason: FileReviewBlockReason.SIZE_ELIDED }),
      ),
    ).toEqual({ kind: "unavailable", reason: "size" });
  });

  it("classifies a content-less change with no recorded reason as unavailable/'unknown'", () => {
    // Historical rows (pre doc 15) and any future/unmapped cause fall back to the
    // defensive generic bucket rather than fabricating a specific cause.
    expect(fileReviewability(change({ diffComplete: false }))).toEqual({
      kind: "unavailable",
      reason: "unknown",
    });
  });

  it("maps the generic UNREVIEWABLE reason to 'unknown'", () => {
    expect(
      fileReviewability(
        change({ diffComplete: false, blockedReason: FileReviewBlockReason.UNREVIEWABLE }),
      ),
    ).toEqual({ kind: "unavailable", reason: "unknown" });
  });

  it("does not misread a one-sided binary ADD as unavailable", () => {
    expect(
      fileReviewability(
        change({ kind: FileChangeKind.ADD, diffComplete: false, after: inline("\u0000", true) }),
      ),
    ).toEqual({ kind: "binary" });
  });

  it("does not misread a one-sided binary DELETE as unavailable", () => {
    expect(
      fileReviewability(
        change({ kind: FileChangeKind.DELETE, diffComplete: false, before: inline("\u0000", true) }),
      ),
    ).toEqual({ kind: "binary" });
  });
});
