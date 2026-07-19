import { describe, it, expect } from "vitest";
import { create, fromJson, type JsonObject } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import {
  ApprovalRequestedPayloadSchema,
  ApprovalResolvedPayloadSchema,
  type ApprovalRequestedPayload,
  type ApprovalResolvedPayload,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import {
  deriveTaskApprovalRequest,
  deriveTaskApprovalDecision,
  deriveTaskReviewer,
} from "../task-detail/task-approval";

// ---------------------------------------------------------------------------
// The human_input gate's card-side projections (T06): the review-material
// view a pending gate renders, and the decision record a resolved gate
// reports (task output = the canonical record; the approval_resolved event
// fills the gaps). Coverage ported from the retired inspector's
// derive-task-detail suite — the semantics survived the inspector.
// ---------------------------------------------------------------------------

function makeRequest(
  overrides: Partial<ApprovalRequestedPayload> = {},
): ApprovalRequestedPayload {
  return create(ApprovalRequestedPayloadSchema, {
    prompt: "Deploy to production?",
    approvers: [],
    timeoutSeconds: 0,
    ...overrides,
  } as never);
}

function makeResolution(
  overrides: Partial<ApprovalResolvedPayload> = {},
): ApprovalResolvedPayload {
  return create(ApprovalResolvedPayloadSchema, {
    action: 1,
    resolvedBy: "admin",
    comment: "from event",
    waitDurationMs: BigInt(30000),
    ...overrides,
  } as never);
}

describe("deriveTaskApprovalRequest", () => {
  it("projects prompt and outcomes to the plain review-gate shape", () => {
    const view = deriveTaskApprovalRequest(
      makeRequest({
        outcomes: [
          { name: "approve", label: "Approve" },
          { name: "reject", label: "Reject" },
        ] as never,
      }),
    );
    expect(view.prompt).toBe("Deploy to production?");
    expect(view.outcomes).toEqual([
      { name: "approve", label: "Approve" },
      { name: "reject", label: "Reject" },
    ]);
    expect(view.formSchema).toBeNull();
    expect(view.payload).toBeNull();
    expect(view.payloadArtifactId).toBeNull();
  });

  it("unwraps an inline review payload with its ui_hint", () => {
    const view = deriveTaskApprovalRequest(
      makeRequest({
        payload: fromJson(ValueSchema, { title: "Q3 plan", items: [1, 2] }),
        uiHint: "plan-review",
      }),
    );
    expect(view.payload).toEqual({ title: "Q3 plan", items: [1, 2] });
    expect(view.uiHint).toBe("plan-review");
    expect(view.payloadArtifactId).toBeNull();
  });

  it("carries the artifact reference instead of inline data for promoted payloads", () => {
    const view = deriveTaskApprovalRequest(
      makeRequest({ uiHint: "infra-proposal", payloadArtifactId: "art_review123" }),
    );
    expect(view.payload).toBeNull();
    expect(view.uiHint).toBe("infra-proposal");
    expect(view.payloadArtifactId).toBe("art_review123");
  });
});

describe("deriveTaskApprovalDecision", () => {
  it("returns null while no decision exists", () => {
    expect(deriveTaskApprovalDecision(null, undefined)).toBeNull();
    expect(
      deriveTaskApprovalDecision(null, { unrelated: "output" } as JsonObject),
    ).toBeNull();
  });

  it("builds a finalizing decision from the event alone (empty outcome)", () => {
    const decision = deriveTaskApprovalDecision(makeResolution(), undefined);
    expect(decision).not.toBeNull();
    // No task output yet: outcome is empty (consumers show a "finalizing"
    // affordance), reviewer/comment come from the event.
    expect(decision!.outcome).toBe("");
    expect(decision!.reviewer).toBe("admin");
    expect(decision!.comment).toBe("from event");
    expect(decision!.waitDurationMs).toBe(30000);
    expect(decision!.formData).toBeNull();
    expect(decision!.autoResolved).toBe(false);
  });

  it("sources the decision from the canonical task-output record", () => {
    const decision = deriveTaskApprovalDecision(null, {
      outcome: "approve",
      reviewer: "alice",
      responded_at: "2026-01-01T00:00:45Z",
      comment: "ship it",
      form_data: { feedback: "great plan" },
    } as JsonObject);
    expect(decision).not.toBeNull();
    expect(decision!.outcome).toBe("approve");
    expect(decision!.reviewer).toBe("alice");
    expect(decision!.respondedAt).toBe("2026-01-01T00:00:45Z");
    expect(decision!.comment).toBe("ship it");
    expect(decision!.formData).toEqual({ feedback: "great plan" });
  });

  it("prefers the task-output snapshot over the event for overlapping fields", () => {
    const decision = deriveTaskApprovalDecision(
      makeResolution({ resolvedBy: "bot", comment: "from event", waitDurationMs: BigInt(12000) }),
      {
        outcome: "approve",
        reviewer: "alice",
        comment: "from snapshot",
      } as JsonObject,
    );
    expect(decision!.outcome).toBe("approve");
    expect(decision!.reviewer).toBe("alice"); // snapshot wins
    expect(decision!.comment).toBe("from snapshot"); // snapshot wins
    expect(decision!.waitDurationMs).toBe(12000); // event fills the gap
  });

  it("reads auto_resolved and ignores internal keys in the task output", () => {
    const decision = deriveTaskApprovalDecision(null, {
      outcome: "approve",
      auto_resolved: true,
      __flow_directive__: "gatherMore",
    } as JsonObject);
    expect(decision!.outcome).toBe("approve");
    expect(decision!.autoResolved).toBe(true);
  });

  it("reads the reviewer_actor display snapshot from the task output", () => {
    const decision = deriveTaskApprovalDecision(null, {
      outcome: "approve",
      reviewer: "ida_01abc",
      reviewer_actor: {
        id: "ida_01abc",
        display_name: "Ada Lovelace",
        email: "ada@example.com",
        avatar: "https://example.com/ada.png",
      },
    } as JsonObject);
    expect(decision!.reviewerActor).toEqual({
      id: "ida_01abc",
      displayName: "Ada Lovelace",
      email: "ada@example.com",
      avatar: "https://example.com/ada.png",
    });
  });

  it("falls back to the event's resolvedByActor during the finalizing window", () => {
    const decision = deriveTaskApprovalDecision(
      makeResolution({
        resolvedBy: "ida_01abc",
        resolvedByActor: {
          id: "ida_01abc",
          displayName: "Ada Lovelace",
          email: "ada@example.com",
          avatar: "",
        } as never,
      }),
      undefined,
    );
    expect(decision!.reviewerActor).toEqual({
      id: "ida_01abc",
      displayName: "Ada Lovelace",
      email: "ada@example.com",
      avatar: "",
    });
  });

  it("leaves reviewerActor null for unenriched records", () => {
    const decision = deriveTaskApprovalDecision(null, {
      outcome: "approve",
      reviewer: "ida_01abc",
    } as JsonObject);
    expect(decision!.reviewerActor).toBeNull();
  });
});

describe("deriveTaskReviewer", () => {
  const base = {
    outcome: "approve",
    respondedAt: null,
    comment: "",
    formData: null,
    waitDurationMs: 0,
    autoResolved: false,
  };

  it("prefers the display name, carrying email and avatar for the chip", () => {
    const view = deriveTaskReviewer({
      ...base,
      reviewer: "ida_01abc",
      reviewerActor: {
        id: "ida_01abc",
        displayName: "Ada Lovelace",
        email: "ada@example.com",
        avatar: "https://example.com/ada.png",
      },
    });
    expect(view).toEqual({
      label: "Ada Lovelace",
      email: "ada@example.com",
      avatar: "https://example.com/ada.png",
      isRawId: false,
    });
  });

  it("falls back to email when no display name exists", () => {
    const view = deriveTaskReviewer({
      ...base,
      reviewer: "ida_01abc",
      reviewerActor: {
        id: "ida_01abc",
        displayName: "",
        email: "ada@example.com",
        avatar: "",
      },
    });
    expect(view!.label).toBe("ada@example.com");
    // Email equals the label — no redundant secondary display.
    expect(view!.email).toBe("");
    expect(view!.isRawId).toBe(false);
  });

  it("falls back to the raw id for legacy records, flagged for de-emphasis", () => {
    const view = deriveTaskReviewer({
      ...base,
      reviewer: "ida_01abc",
      reviewerActor: null,
    });
    expect(view).toEqual({
      label: "ida_01abc",
      email: "",
      avatar: "",
      isRawId: true,
    });
  });

  it("returns null for unattributed decisions so the 'by' segment is omitted", () => {
    const view = deriveTaskReviewer({
      ...base,
      reviewer: "",
      reviewerActor: null,
    });
    expect(view).toBeNull();
  });
});
