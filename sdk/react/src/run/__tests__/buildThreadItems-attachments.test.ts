import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  RunSchema,
  RunStatusSchema,
  type Run,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  RunSpecSchema,
  AttachmentSchema,
  type Attachment,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { buildThreadItems, type ThreadItem } from "../MessageThread";

// ---------------------------------------------------------------------------
// buildThreadItems attachment stamping (stigmer/stigmer#372)
//
// The human turn's submitted files come from two sources: the run
// record's spec.attachments (durable, presign-capable) and the submit
// context's pendingAttachments (optimistic bubble, no run yet). These
// tests pin both stamps, the empty-list omission, and the reference
// stability the memoized bubble depends on.
// ---------------------------------------------------------------------------

function makeAttachment(filename: string, storageKey: string): Attachment {
  return create(AttachmentSchema, {
    filename,
    storageKey,
    contentType: filename.endsWith(".png") ? "image/png" : "text/plain",
  });
}

function makeExecution(opts: {
  id: string;
  specMessage: string;
  attachments?: Attachment[];
}): Run {
  const exec = create(RunSchema);
  exec.metadata = create(ApiResourceMetadataSchema, { id: opts.id });
  const spec = create(RunSpecSchema);
  spec.message = opts.specMessage;
  if (opts.attachments) spec.attachments = opts.attachments;
  exec.spec = spec;
  const status = create(RunStatusSchema);
  status.phase = RunPhase.RUN_COMPLETED;
  exec.status = status;
  return exec;
}

function promptItem(items: readonly ThreadItem[], execId: string) {
  return items.find(
    (i): i is Extract<ThreadItem, { kind: "message" }> =>
      i.kind === "message" && i.key === `${execId}-spec`,
  );
}

function pendingItem(items: readonly ThreadItem[]) {
  return items.find(
    (i): i is Extract<ThreadItem, { kind: "message" }> =>
      i.kind === "message" && i.key === "pending-user-turn",
  );
}

describe("buildThreadItems spec.attachments stamping", () => {
  it("stamps the synthetic human turn with the spec's attachments and the execution id", () => {
    const attachments = [
      makeAttachment("notes.png", "attachments/01AAA/notes.png"),
      makeAttachment("report.txt", "attachments/01BBB/report.txt"),
    ];
    const exec = makeExecution({
      id: "exec-attach",
      specMessage: "Look at these files.",
      attachments,
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    const prompt = promptItem(items, "exec-attach");

    expect(prompt).toBeDefined();
    expect(prompt!.executionId).toBe("exec-attach");
    // Stamped BY REFERENCE: structural sharing keeps spec.attachments stable
    // across streaming frames, so the memoized bubble must receive the same
    // array object, not a copy.
    expect(prompt!.attachments).toBe(exec.spec!.attachments);
    expect(prompt!.attachments).toHaveLength(2);
  });

  it("stamps NO attachments field when the spec has none (empty list omitted)", () => {
    const exec = makeExecution({
      id: "exec-plain",
      specMessage: "Just text.",
    });

    const items = buildThreadItems([exec], null, null, false, undefined);
    const prompt = promptItem(items, "exec-plain");

    expect(prompt).toBeDefined();
    expect(prompt!.attachments).toBeUndefined();
    // The run id still rides along — other affordances may need it.
    expect(prompt!.executionId).toBe("exec-plain");
  });
});

describe("buildThreadItems pendingAttachments stamping", () => {
  const pendingAttachments = [
    { filename: "sketch.png", contentType: "image/png", storageKey: "attachments/01CCC/sketch.png" },
  ];

  it("carries the submit context's attachments on the pending bubble, without an execution id", () => {
    const items = buildThreadItems(
      [],
      null,
      "Here is a sketch.",
      false,
      undefined,
      undefined,
      false,
      false,
      false,
      false,
      pendingAttachments,
    );
    const pending = pendingItem(items);

    expect(pending).toBeDefined();
    expect(pending!.isPending).toBe(true);
    expect(pending!.attachments).toBe(pendingAttachments);
    // No run record yet — presigning must not be attempted.
    expect(pending!.executionId).toBeUndefined();
  });

  it("keeps the attachments on a FAILED pending bubble (evidence of what Retry re-sends)", () => {
    const items = buildThreadItems(
      [],
      null,
      "Here is a sketch.",
      false,
      undefined,
      undefined,
      true, // pendingMessageFailed
      false,
      false,
      false,
      pendingAttachments,
    );
    const pending = pendingItem(items);

    expect(pending).toBeDefined();
    expect(pending!.isFailed).toBe(true);
    expect(pending!.attachments).toBe(pendingAttachments);
  });

  it("stamps NO attachments on the pending bubble when the submit had none", () => {
    const items = buildThreadItems(
      [],
      null,
      "Plain follow-up.",
      false,
      undefined,
      undefined,
      false,
      false,
      false,
      false,
      [],
    );
    const pending = pendingItem(items);

    expect(pending).toBeDefined();
    expect(pending!.attachments).toBeUndefined();
  });
});
