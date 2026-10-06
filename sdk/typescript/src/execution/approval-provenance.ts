// Framework-agnostic authorization-provenance labels for every Stigmer surface.
//
// describeApprovalPolicySource maps the wire ApprovalPolicySource — *which policy
// layer decided a tool call's approval requirement* — to a short human phrase.
// It is shared by @stigmer/react (the ApprovalCard "why-gated" line and the
// tool-call detail view) and @stigmer/ink (the terminal approval prompt); the Go
// CLI mirrors it. The phrasing is intrinsic to the source's semantics so the
// same label reads correctly whether the call is still waiting (a gating source
// → "required by …") or already cleared (a bypass source → "auto-approved …").

import { ApprovalPolicySource } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";

export { ApprovalPolicySource };

/**
 * Returns a short human phrase describing a tool call's authorization
 * provenance, or `null` for {@link ApprovalPolicySource.UNSPECIFIED} — an
 * execution that predates this field, or a call that needed no approval (a
 * read-only built-in, or an MCP tool its server does not mark destructive) — so
 * callers render nothing rather than a misleading default.
 *
 * `hook` is the call's `approvalPolicyHook`: the plugin whose hook decided it,
 * empty when the agent's own hooks did. It is read only for
 * {@link ApprovalPolicySource.HOOK}.
 */
export function describeApprovalPolicySource(
  source: ApprovalPolicySource,
  hook = "",
): string | null {
  switch (source) {
    case ApprovalPolicySource.HOOK:
      return hook === "" ? "decided by the agent's hook" : `decided by the ${hook} plugin's hook`;
    case ApprovalPolicySource.BUILTIN_CATEGORY:
      return "required by built-in tool policy";
    case ApprovalPolicySource.ANNOTATION_DESTRUCTIVE_TIGHTEN:
      return "required: marked destructive by the server";
    case ApprovalPolicySource.AUTO_APPROVE_ALL:
      return "auto-approved by a run-wide bypass";
    case ApprovalPolicySource.APPROVAL_LEASE:
      return "auto-approved by a run lease";
    case ApprovalPolicySource.UNATTENDED_SKIP:
      return "skipped: approval not available on this surface";
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
 * The default gating reason for a built-in —
 * {@link ApprovalPolicySource.BUILTIN_CATEGORY} — explains nothing the user does
 * not already infer from the tool itself, so it is suppressed from the card (the
 * full phrase stays available on hover where a surface chooses to show a chip).
 * The remaining sources each change the user's understanding of *why* this
 * particular call is held — a server marking the tool destructive, or
 * (post-execution) a bypass/lease that cleared it — and so are worth showing.
 * {@link ApprovalPolicySource.UNSPECIFIED} is never informative (legacy /
 * ungated).
 *
 * This is the headless policy behind the gate's "smart-suppress" provenance
 * chip; rendering lives in the consuming surface.
 */
export function isInformativePolicySource(
  source: ApprovalPolicySource,
): boolean {
  switch (source) {
    case ApprovalPolicySource.ANNOTATION_DESTRUCTIVE_TIGHTEN:
    case ApprovalPolicySource.AUTO_APPROVE_ALL:
    case ApprovalPolicySource.APPROVAL_LEASE:
    // An unattended skip is a platform RESOLUTION, not an everyday gating
    // default: an org admin reviewing a channel conversation (a read-only
    // observer) needs to see why the tool did not run — and that no human
    // declined it.
    case ApprovalPolicySource.UNATTENDED_SKIP:
    // A hook is a policy someone installed on purpose: the person deciding
    // should see whose it is.
    case ApprovalPolicySource.HOOK:
      return true;
    case ApprovalPolicySource.BUILTIN_CATEGORY:
    case ApprovalPolicySource.UNSPECIFIED:
    default:
      return false;
  }
}

/**
 * The "approve all" label for a call a hook asked about. Approving all of it
 * leases exactly that hook's asks on that tool, so the label names both:
 * "Approve all shell commands the safety plugin asks about". `subject` is the
 * surface's name for the tool's calls ("shell commands", "file edits").
 */
export function hookApproveAllLabel(subject: string, hook: string): string {
  return hook === ""
    ? `Approve all ${subject} the agent's hooks ask about`
    : `Approve all ${subject} the ${hook} plugin asks about`;
}
