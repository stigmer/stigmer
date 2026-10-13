/**
 * Proves approvalPolicySourceOf (../approval-provenance.ts): each
 * provenance word an ask can carry names its ApprovalPolicySource, and ""
 * or a word this client does not know names none.
 */
import { describe, it, expect } from "vitest";
import { ApprovalPolicySource } from "@stigmer/sdk";
import { approvalPolicySourceOf } from "../approval-provenance";

describe("approvalPolicySourceOf", () => {
  it.each([
    ["builtin_category", ApprovalPolicySource.BUILTIN_CATEGORY],
    ["annotation_destructive_tighten", ApprovalPolicySource.ANNOTATION_DESTRUCTIVE_TIGHTEN],
    ["hook", ApprovalPolicySource.HOOK],
    ["approval_lease", ApprovalPolicySource.APPROVAL_LEASE],
    ["auto_approve_all", ApprovalPolicySource.AUTO_APPROVE_ALL],
    ["unattended_skip", ApprovalPolicySource.UNATTENDED_SKIP],
  ])("reads %s", (word, source) => {
    expect(approvalPolicySourceOf(word)).toBe(source);
  });

  it("reads no rule as UNSPECIFIED", () => {
    expect(approvalPolicySourceOf("")).toBe(ApprovalPolicySource.UNSPECIFIED);
    expect(approvalPolicySourceOf("someday_rule")).toBe(ApprovalPolicySource.UNSPECIFIED);
  });
});
