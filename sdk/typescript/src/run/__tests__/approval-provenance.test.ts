// Pins the provenance labels every surface shows for a tool call's approval
// source, which sources the approval card surfaces inline, and the "approve
// all" label for a call a hook asked about. The phrases are shared by the
// React card and the ink prompt, so a change here is a user-visible change on
// both.
import { describe, it, expect } from "vitest";
import {
  describeApprovalPolicySource,
  hookApproveAllLabel,
  isInformativePolicySource,
} from "../approval-provenance";

describe("describeApprovalPolicySource", () => {
  it("maps each known source to a stable human phrase", () => {
    expect(describeApprovalPolicySource("builtin_category")).toBe(
      "required by built-in tool policy",
    );
    expect(
      describeApprovalPolicySource("annotation_destructive_tighten"),
    ).toBe("required: marked destructive by the server");
    expect(describeApprovalPolicySource("auto_approve_all")).toBe(
      "auto-approved by a run-wide bypass",
    );
    expect(describeApprovalPolicySource("approval_lease")).toBe(
      "auto-approved by a run lease",
    );
    expect(describeApprovalPolicySource("unattended_skip")).toBe(
      "skipped: approval not available on this surface",
    );
  });

  it("names the hook that decided, or the agent's own hooks", () => {
    expect(describeApprovalPolicySource("hook", "safety")).toBe(
      "decided by the safety plugin's hook",
    );
    expect(describeApprovalPolicySource("hook")).toBe("decided by the agent's hook");
    expect(isInformativePolicySource("hook")).toBe(true);
  });

  it("returns null for an empty source (a call that needed no approval)", () => {
    expect(describeApprovalPolicySource("")).toBeNull();
  });

  it("returns null for an unknown word", () => {
    for (const unknown of ["user_override", "BUILTIN_CATEGORY", "later_rule"]) {
      expect(describeApprovalPolicySource(unknown)).toBeNull();
    }
  });
});

describe("isInformativePolicySource", () => {
  it("suppresses the everyday default gating reason", () => {
    // These add nothing beyond "this tool needs approval" — noise at the gate.
    expect(isInformativePolicySource("builtin_category")).toBe(false);
    expect(isInformativePolicySource("")).toBe(false);
  });

  it("surfaces reasons that change the user's understanding of the gate", () => {
    expect(
      isInformativePolicySource("annotation_destructive_tighten"),
    ).toBe(true);
    expect(isInformativePolicySource("auto_approve_all")).toBe(true);
    expect(isInformativePolicySource("approval_lease")).toBe(true);
    expect(isInformativePolicySource("unattended_skip")).toBe(true);
  });

  it("only surfaces a reason that also has a phrase to show", () => {
    // The card renders `isInformative(source) && describe(source) != null`; the
    // two must never disagree for a surfaced source.
    for (const source of [
      "annotation_destructive_tighten",
      "auto_approve_all",
      "approval_lease",
      "unattended_skip",
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
