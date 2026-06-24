// Framework-agnostic authorization-provenance labels for every Stigmer surface.
//
// describeApprovalPolicySource maps the wire ApprovalPolicySource — *which policy
// layer decided a tool call's approval requirement* — to a short human phrase.
// It is shared by @stigmer/react (the ApprovalCard "why-gated" line and the
// tool-call detail view) and @stigmer/ink (the terminal approval prompt); the Go
// CLI mirrors it. The phrasing is intrinsic to the source's semantics so the
// same label reads correctly whether the call is still waiting (a gating source
// → "required by …") or already cleared (a bypass source → "auto-approved …").

import { ApprovalPolicySource } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

export { ApprovalPolicySource };

/**
 * Returns a short human phrase describing a tool call's authorization
 * provenance, or `null` for {@link ApprovalPolicySource.UNSPECIFIED} — an
 * execution that predates this field, or a tool the gate never evaluated (e.g. a
 * read-only built-in) — so callers render nothing rather than a misleading
 * default.
 */
export function describeApprovalPolicySource(
  source: ApprovalPolicySource,
): string | null {
  switch (source) {
    case ApprovalPolicySource.CLASSIFIER_DEFAULT:
      return "required by the tool's default policy";
    case ApprovalPolicySource.PINNED_OVERRIDE:
      return "required by a pinned override";
    case ApprovalPolicySource.AGENT_OVERRIDE:
      return "required by agent override";
    case ApprovalPolicySource.BUILTIN_CATEGORY:
      return "required by built-in tool policy";
    case ApprovalPolicySource.ANNOTATION_DESTRUCTIVE_TIGHTEN:
      return "required: marked destructive by the server";
    case ApprovalPolicySource.AUTO_APPROVE_ALL:
      return "auto-approved by a run-wide bypass";
    case ApprovalPolicySource.APPROVAL_LEASE:
      return "auto-approved by a run lease";
    case ApprovalPolicySource.UNSPECIFIED:
    default:
      return null;
  }
}
