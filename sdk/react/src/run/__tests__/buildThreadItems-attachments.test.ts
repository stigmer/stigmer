/**
 * buildThreadItems attachment stamping (stigmer/stigmer#372). A turn's
 * person's message carries the files submitted with it from two sources:
 * the turn's run (`spec.attachments`, durable and presign-capable, stamped
 * by reference with the run id) and the submit context's pending
 * attachments (the optimistic bubble, before any run, kept on a failed
 * send). An empty list is omitted.
 */
import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AttachmentSchema, type Attachment } from "@stigmer/apis/ai/stigmer/agentic/run/v1/spec_pb";
import { buildThreadItems, type ThreadItem } from "../MessageThread";
import { runOf, status, turnsOf, user } from "./__fixtures__/thread-events";

function attachment(filename: string, storageKey: string): Attachment {
  return create(AttachmentSchema, {
    filename,
    storageKey,
    contentType: filename.endsWith(".png") ? "image/png" : "text/plain",
  });
}

type MessageItem = Extract<ThreadItem, { kind: "message" }>;

function messageByKey(items: readonly ThreadItem[], key: string): MessageItem | undefined {
  return items.find((i): i is MessageItem => i.kind === "message" && i.key === key);
}

describe("buildThreadItems spec.attachments stamping", () => {
  it("stamps the person's message with the run's attachments, by reference, and the run id", () => {
    const run = runOf("exec-attach", {
      spec: {
        message: "Look at these files.",
        attachments: [
          attachment("notes.png", "attachments/01AAA/notes.png"),
          attachment("report.txt", "attachments/01BBB/report.txt"),
        ],
      },
    });
    const turns = turnsOf(user("exec-attach", "Look at these files."), status("exec-attach", "completed"));

    const prompt = messageByKey(buildThreadItems(turns, [run]), "exec-attach-spec");

    expect(prompt?.executionId).toBe("exec-attach");
    expect(prompt?.attachments).toBe(run.spec!.attachments);
    expect(prompt?.attachments).toHaveLength(2);
  });

  it("stamps NO attachments when the run has none", () => {
    const turns = turnsOf(user("exec-plain", "Just text."), status("exec-plain", "completed"));
    const prompt = messageByKey(
      buildThreadItems(turns, [runOf("exec-plain", { spec: { message: "Just text." } })]),
      "exec-plain-spec",
    );

    expect(prompt?.attachments).toBeUndefined();
    expect(prompt?.executionId).toBe("exec-plain");
  });
});

describe("buildThreadItems pendingAttachments stamping", () => {
  const pendingAttachments = [
    { filename: "sketch.png", contentType: "image/png", storageKey: "attachments/01CCC/sketch.png" },
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
