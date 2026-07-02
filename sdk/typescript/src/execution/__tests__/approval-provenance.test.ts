import { describe, it, expect } from "vitest";
import {
  ApprovalPolicySource,
  describeApprovalPolicySource,
  isInformativePolicySource,
} from "../approval-provenance";

describe("describeApprovalPolicySource", () => {
  it("maps each known source to a stable human phrase", () => {
    expect(describeApprovalPolicySource(ApprovalPolicySource.CLASSIFIER_DEFAULT)).toBe(
      "required by the tool's default policy",
    );
    expect(describeApprovalPolicySource(ApprovalPolicySource.BUILTIN_CATEGORY)).toBe(
      "required by built-in tool policy",
    );
    expect(describeApprovalPolicySource(ApprovalPolicySource.AGENT_OVERRIDE)).toBe(
      "required by agent override",
    );
    expect(
      describeApprovalPolicySource(ApprovalPolicySource.ANNOTATION_DESTRUCTIVE_TIGHTEN),
    ).toBe("required: marked destructive by the server");
  });

  it("returns null for UNSPECIFIED (legacy / ungated)", () => {
    expect(describeApprovalPolicySource(ApprovalPolicySource.UNSPECIFIED)).toBeNull();
  });
});

describe("isInformativePolicySource", () => {
  it("suppresses the everyday default gating reasons", () => {
    // These add nothing beyond "this tool needs approval" — noise at the gate.
    expect(isInformativePolicySource(ApprovalPolicySource.CLASSIFIER_DEFAULT)).toBe(false);
    expect(isInformativePolicySource(ApprovalPolicySource.BUILTIN_CATEGORY)).toBe(false);
    expect(isInformativePolicySource(ApprovalPolicySource.UNSPECIFIED)).toBe(false);
  });

  it("surfaces reasons that change the user's understanding of the gate", () => {
    expect(isInformativePolicySource(ApprovalPolicySource.PINNED_OVERRIDE)).toBe(true);
    expect(isInformativePolicySource(ApprovalPolicySource.AGENT_OVERRIDE)).toBe(true);
    expect(
      isInformativePolicySource(ApprovalPolicySource.ANNOTATION_DESTRUCTIVE_TIGHTEN),
    ).toBe(true);
    expect(isInformativePolicySource(ApprovalPolicySource.AUTO_APPROVE_ALL)).toBe(true);
    expect(isInformativePolicySource(ApprovalPolicySource.APPROVAL_LEASE)).toBe(true);
  });

  it("only surfaces a reason that also has a phrase to show", () => {
    // The card renders `isInformative(source) && describe(source) != null`; the
    // two must never disagree for a surfaced source.
    for (const source of [
      ApprovalPolicySource.PINNED_OVERRIDE,
      ApprovalPolicySource.AGENT_OVERRIDE,
      ApprovalPolicySource.ANNOTATION_DESTRUCTIVE_TIGHTEN,
      ApprovalPolicySource.AUTO_APPROVE_ALL,
      ApprovalPolicySource.APPROVAL_LEASE,
    ]) {
      expect(describeApprovalPolicySource(source)).not.toBeNull();
    }
  });
});
