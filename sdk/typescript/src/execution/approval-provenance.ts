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

/**
 * Returns whether a policy source carries information worth surfacing inline at
 * the approval gate, versus the everyday default ("this tool category just
 * requires approval") that is noise next to the action it is already gating.
 *
 * The default gating reasons — {@link ApprovalPolicySource.CLASSIFIER_DEFAULT}
 * and {@link ApprovalPolicySource.BUILTIN_CATEGORY} — explain nothing the user
 * does not already infer from the tool itself, so they are suppressed from the
 * card (the full phrase stays available on hover where a surface chooses to show
 * a chip). The remaining sources each change the user's understanding of *why*
 * this particular call is held — an explicit override, a server tightening a
 * destructive tool, or (post-execution) a bypass/lease that cleared it — and so
 * are worth showing. {@link ApprovalPolicySource.UNSPECIFIED} is never
 * informative (legacy / ungated).
 *
 * This is the headless policy behind the gate's "smart-suppress" provenance
 * chip; rendering lives in the consuming surface.
 */
export function isInformativePolicySource(
  source: ApprovalPolicySource,
): boolean {
  switch (source) {
    case ApprovalPolicySource.PINNED_OVERRIDE:
    case ApprovalPolicySource.AGENT_OVERRIDE:
    case ApprovalPolicySource.ANNOTATION_DESTRUCTIVE_TIGHTEN:
    case ApprovalPolicySource.AUTO_APPROVE_ALL:
    case ApprovalPolicySource.APPROVAL_LEASE:
      return true;
    case ApprovalPolicySource.CLASSIFIER_DEFAULT:
    case ApprovalPolicySource.BUILTIN_CATEGORY:
    case ApprovalPolicySource.UNSPECIFIED:
    default:
      return false;
  }
}
