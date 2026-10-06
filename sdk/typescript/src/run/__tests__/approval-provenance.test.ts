// Pins the provenance labels every surface shows for a tool call's approval
// source, which sources the approval card surfaces inline, and the "approve
// all" label for a call a hook asked about. The phrases are shared by the
// React card and the ink prompt, so a change here is a user-visible change on
// both.
import { describe, it, expect } from "vitest";
import {
  ApprovalPolicySource,
  describeApprovalPolicySource,
  hookApproveAllLabel,
  isInformativePolicySource,
} from "../approval-provenance";

describe("describeApprovalPolicySource", () => {
  it("maps each known source to a stable human phrase", () => {
    expect(describeApprovalPolicySource(ApprovalPolicySource.BUILTIN_CATEGORY)).toBe(
      "required by built-in tool policy",
    );
    expect(
      describeApprovalPolicySource(ApprovalPolicySource.ANNOTATION_DESTRUCTIVE_TIGHTEN),
    ).toBe("required: marked destructive by the server");
    expect(describeApprovalPolicySource(ApprovalPolicySource.AUTO_APPROVE_ALL)).toBe(
      "auto-approved by a run-wide bypass",
    );
    expect(describeApprovalPolicySource(ApprovalPolicySource.APPROVAL_LEASE)).toBe(
      "auto-approved by a run lease",
    );
    expect(describeApprovalPolicySource(ApprovalPolicySource.UNATTENDED_SKIP)).toBe(
      "skipped: approval not available on this surface",
    );
  });

  it("names the hook that decided, or the agent's own hooks", () => {
    expect(describeApprovalPolicySource(ApprovalPolicySource.HOOK, "safety")).toBe(
      "decided by the safety plugin's hook",
    );
    expect(describeApprovalPolicySource(ApprovalPolicySource.HOOK)).toBe("decided by the agent's hook");
    expect(isInformativePolicySource(ApprovalPolicySource.HOOK)).toBe(true);
  });

  it("returns null for UNSPECIFIED (legacy, or a call that needed no approval)", () => {
    expect(describeApprovalPolicySource(ApprovalPolicySource.UNSPECIFIED)).toBeNull();
  });

  it("returns null for a reserved or unknown wire value", () => {
    // Values 1 to 3 are reserved on the wire; an old stored run decodes
    // them as plain numbers, which must render as no provenance.
    for (const reserved of [1, 2, 3, 99]) {
      expect(describeApprovalPolicySource(reserved as ApprovalPolicySource)).toBeNull();
    }
  });
});

describe("isInformativePolicySource", () => {
  it("suppresses the everyday default gating reason", () => {
    // These add nothing beyond "this tool needs approval" — noise at the gate.
    expect(isInformativePolicySource(ApprovalPolicySource.BUILTIN_CATEGORY)).toBe(false);
    expect(isInformativePolicySource(ApprovalPolicySource.UNSPECIFIED)).toBe(false);
  });

  it("surfaces reasons that change the user's understanding of the gate", () => {
    expect(
      isInformativePolicySource(ApprovalPolicySource.ANNOTATION_DESTRUCTIVE_TIGHTEN),
    ).toBe(true);
    expect(isInformativePolicySource(ApprovalPolicySource.AUTO_APPROVE_ALL)).toBe(true);
    expect(isInformativePolicySource(ApprovalPolicySource.APPROVAL_LEASE)).toBe(true);
    expect(isInformativePolicySource(ApprovalPolicySource.UNATTENDED_SKIP)).toBe(true);
  });

  it("only surfaces a reason that also has a phrase to show", () => {
    // The card renders `isInformative(source) && describe(source) != null`; the
    // two must never disagree for a surfaced source.
    for (const source of [
      ApprovalPolicySource.ANNOTATION_DESTRUCTIVE_TIGHTEN,
      ApprovalPolicySource.AUTO_APPROVE_ALL,
      ApprovalPolicySource.APPROVAL_LEASE,
      ApprovalPolicySource.UNATTENDED_SKIP,
    ]) {
      expect(describeApprovalPolicySource(source)).not.toBeNull();
    }
  });
});

describe("hookApproveAllLabel", () => {
  it("names what the lease covers and whose asks it is", () => {
    expect(hookApproveAllLabel("shell commands", "safety")).toBe(
      "Approve all shell commands the safety plugin asks about",
    );
    expect(hookApproveAllLabel("file writes", "")).toBe("Approve all file writes the agent's hooks ask about");
  });
});
