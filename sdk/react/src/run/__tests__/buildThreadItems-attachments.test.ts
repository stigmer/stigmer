/**
 * buildThreadItems file stamping (stigmer/stigmer#372). A turn's person's
 * message carries the files given with it from two sources: the turn's run
 * (`status.messageFiles`, the blocks the server recorded, each naming the
 * conversation's File; stamped with the run id, which makes the chips live)
 * and the submit context's pending attachments (the optimistic bubble,
 * before any run, kept on a failed send). An empty list is omitted, a
 * block with no File is skipped, and the chips keep their identity across
 * rebuilds so a streamed frame never re-renders an unchanged message.
 */
import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { ContentBlockSchema, type ContentBlock } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_content_pb";
import { buildThreadItems, type ThreadItem } from "../MessageThread";
import { messageFileViews } from "../MessageAttachments";
import { runOf, status, turnsOf, user } from "./__fixtures__/thread-events";

function fileBlock(type: "image" | "document", fileId: string, title = ""): ContentBlock {
  return create(ContentBlockSchema, { type, title, source: { type: "file", fileId } });
}

type MessageItem = Extract<ThreadItem, { kind: "message" }>;

function messageByKey(items: readonly ThreadItem[], key: string): MessageItem | undefined {
  return items.find((i): i is MessageItem => i.kind === "message" && i.key === key);
}

describe("buildThreadItems status.messageFiles stamping", () => {
  it("stamps the person's message with the turn's Files, in order, and the run id", () => {
    const run = runOf("exec-attach", {
      spec: { message: "Look at these files." },
      status: {
        messageFiles: [fileBlock("image", "file_notes"), fileBlock("document", "file_report", "report.txt")],
      },
    });
    const turns = turnsOf(user("exec-attach", "Look at these files."), status("exec-attach", "completed"));

    const items = buildThreadItems(turns, [run]);
    const prompt = messageByKey(items, "exec-attach-spec");

    expect(prompt?.executionId).toBe("exec-attach");
    expect(prompt?.attachments).toEqual([
      { fileId: "file_notes", filename: undefined, kind: "image" },
      { fileId: "file_report", filename: "report.txt", kind: "document" },
    ]);
    // A rebuild (the next streamed frame) hands the row the same array.
    expect(messageByKey(buildThreadItems(turns, [run]), "exec-attach-spec")?.attachments).toBe(prompt?.attachments);
  });

  it("stamps NO attachments when the run recorded no files", () => {
    const turns = turnsOf(user("exec-plain", "Just text."), status("exec-plain", "completed"));
    const prompt = messageByKey(
      buildThreadItems(turns, [runOf("exec-plain", { spec: { message: "Just text." } })]),
      "exec-plain-spec",
    );

    expect(prompt?.attachments).toBeUndefined();
    expect(prompt?.executionId).toBe("exec-plain");
  });
});

describe("messageFileViews", () => {
  it("skips a block whose source is not a File", () => {
    const inline = create(ContentBlockSchema, { type: "image", source: { type: "base64", data: "aGk=" } });
    expect(messageFileViews([inline, fileBlock("document", "file_1")])).toEqual([
      { fileId: "file_1", filename: undefined, kind: "document" },
    ]);
  });
});

describe("buildThreadItems pendingAttachments stamping", () => {
  const pendingAttachments = [
    { fileId: "file_sketch", filename: "sketch.png", kind: "image" as const },
  ];

  it("carries the submit context's attachments on the pending bubble, without a run id", () => {
    const pending = messageByKey(
      buildThreadItems([], [], { pendingUserMessage: "Here is a sketch.", pendingAttachments }),
      "pending-user-turn",
    );

    expect(pending?.isPending).toBe(true);
    expect(pending?.attachments).toBe(pendingAttachments);
    expect(pending?.executionId).toBeUndefined();
  });

  it("keeps the attachments on a FAILED pending bubble (evidence of what Retry re-sends)", () => {
    const pending = messageByKey(
      buildThreadItems([], [], { pendingUserMessage: "Here is a sketch.", pendingAttachments, pendingMessageFailed: true }),
      "pending-user-turn",
    );

    expect(pending?.isFailed).toBe(true);
    expect(pending?.isPending).toBe(false);
    expect(pending?.attachments).toBe(pendingAttachments);
  });

  it("stamps NO attachments on the pending bubble when the submit had none", () => {
    const pending = messageByKey(
      buildThreadItems([], [], { pendingUserMessage: "Plain follow-up.", pendingAttachments: [] }),
      "pending-user-turn",
    );

    expect(pending?.attachments).toBeUndefined();
  });
});
