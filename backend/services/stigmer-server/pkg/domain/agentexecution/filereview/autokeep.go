package filereview

import (
	"time"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// The approved-command auto-keep policy (DD-28).
//
// A turn whose ONLY mutation source was shell commands the human explicitly
// authorized (per-command approval, APPROVE_ALL category lease, or the
// pre-armed spec.auto_approve_all) must not re-gate its file effects at the
// turn-boundary review — the user consented to the command, and the command's
// file effects are the consented outcome. One consent, one gate.
//
// TRUST MODEL. The runner asserts the turn FACTS on the candidate event
// (TurnCommandProvenance: "this turn's mutations came only from these
// commands") — the same trust level as the captured bytes. The CONSENT is
// verified HERE against records only the server writes: every cited row's
// approval_action was authored by SubmitApproval (and is preserved against
// runner writes), and the auto_approve_all flag is checked against the spec.
// A runner can therefore never mint authorization it was never given; at worst
// a dishonest fact assertion keeps changes the user's approved command did not
// make — the same exposure the captured bytes themselves already carry.
//
// The decision is a REAL FILE_DECIDED event (origin POLICY_APPROVED_COMMAND,
// actor "policy", digest-bound to the reviewed aggregate) — not a projection
// shortcut — so the fold keeps one semantics, the audit trail shows who
// decided, and the runner reconciles it exactly like a human keep-all.

// autoKeepReason is the audit-trail text on a policy decision. The UI label
// derives from FileDecision.origin; this is for the record itself.
const autoKeepReason = "Kept automatically: every change in this turn was produced by a command the user approved"

// AutoKeepApprovedCommandSets evaluates every undecided AWAITING_REVIEW change
// set whose candidate carries TurnCommandProvenance and — when the consent
// verifies and the set is fully reviewable — authors the policy APPROVE.
// Returns how many sets were auto-kept.
//
// Idempotent: the deterministic decision/event id makes re-evaluation on every
// status write a no-op once decided, and a racing human decision wins by
// first-append. Fail-closed: any verification miss leaves the set awaiting
// manual review, exactly as if no provenance existed.
//
// Must run inside the store write lock (with AppendRunnerEvents, before the
// projection) so the authored decision lands in the same write as the candidate
// that qualified it — the workflow's gate check then never sees a transient
// AWAITING_REVIEW for an auto-kept set.
func AutoKeepApprovedCommandSets(
	status *agentexecutionv1.AgentExecutionStatus,
	executionID string,
	autoApproveAll bool,
) int {
	stream := status.GetFileReviewEventStream()
	if len(stream.GetEvents()) == 0 {
		return 0
	}
	changeSets := ProjectFileChangeSets(status.GetPhase(), stream)
	if len(changeSets) == 0 {
		return 0
	}

	kept := 0
	for _, ev := range stream.GetEvents() {
		if ev.GetEventType() != agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_CANDIDATE_CAPTURED {
			continue
		}
		provenance := ev.GetCandidateCaptured().GetCommandProvenance()
		if provenance == nil {
			continue
		}
		cs := FindChangeSet(changeSets, ev.GetChangeSetId())
		if cs == nil || cs.GetStatus() != agentexecutionv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW {
			continue
		}
		if len(cs.GetDecisions()) > 0 {
			// A (possibly partial) human decision exists — the human owns this set.
			continue
		}
		// The same fail-closed completeness gate a human APPROVE passes, with NO
		// binary acknowledgment: an unreviewable or binary-blocked set is never
		// auto-kept, it falls back to manual review.
		if reason := ApproveBlockedReason(cs, agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_CHANGE_SET, "", false); reason != "" {
			log.Info().
				Str("execution_id", executionID).
				Str("change_set_id", cs.GetId()).
				Str("blocked_reason", reason).
				Msg("Auto-keep skipped: set not fully reviewable — manual review")
			continue
		}
		if !verifyCommandConsent(status, provenance, autoApproveAll) {
			log.Warn().
				Str("execution_id", executionID).
				Str("change_set_id", cs.GetId()).
				Strs("consent_tool_call_ids", provenance.GetConsentToolCallIds()).
				Msg("Auto-keep skipped: claimed consent did not verify against server-authored approvals — manual review")
			continue
		}

		decision := buildPolicyAutoKeepDecision(cs)
		recordFileDecisionEventWithActor(status, executionID, decision, actorPolicy)
		kept++
		log.Info().
			Str("execution_id", executionID).
			Str("change_set_id", cs.GetId()).
			Strs("consent_tool_call_ids", provenance.GetConsentToolCallIds()).
			Bool("authorized_by_auto_approve_all", provenance.GetAuthorizedByAutoApproveAll()).
			Msg("Auto-kept change set: every change produced by an approved command (DD-28)")
	}
	return kept
}

// buildPolicyAutoKeepDecision is the policy twin of BuildFileDecision: a
// CHANGE_SET-scoped APPROVE bound to the aggregate digest the runner captured,
// origin POLICY_APPROVED_COMMAND, no reviewer (the actor is "policy"). Shares
// the deterministic id space, so a concurrent human decision on the same set
// collapses to whichever was appended first.
func buildPolicyAutoKeepDecision(cs *agentexecutionv1.FileChangeSet) *agentexecutionv1.FileDecision {
	decision := &agentexecutionv1.FileDecision{
		ChangeSetId:    cs.GetId(),
		Scope:          agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_CHANGE_SET,
		Action:         agentexecutionv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE,
		ExpectedDigest: cs.GetAggregateDigest(),
		DecidedAt:      time.Now().UTC().Format(time.RFC3339),
		Reason:         autoKeepReason,
		Origin:         agentexecutionv1.FileDecisionOrigin_FILE_DECISION_ORIGIN_POLICY_APPROVED_COMMAND,
	}
	decision.Id = cs.GetId() + ":" + decisionScopeID(decision)
	return decision
}

// verifyCommandConsent checks the runner's consent claims against the records
// only the server writes. Every cited tool call must exist and carry a
// SubmitApproval-authored APPROVE or APPROVE_ALL; the auto_approve_all claim
// must match the spec-owned flag. At least one consent source is required —
// an empty claim authorizes nothing.
func verifyCommandConsent(
	status *agentexecutionv1.AgentExecutionStatus,
	provenance *agentexecutionv1.TurnCommandProvenance,
	autoApproveAll bool,
) bool {
	if provenance.GetAuthorizedByAutoApproveAll() && !autoApproveAll {
		return false
	}
	ids := provenance.GetConsentToolCallIds()
	if len(ids) == 0 && !provenance.GetAuthorizedByAutoApproveAll() {
		return false
	}
	for _, id := range ids {
		tc := findToolCall(status, id)
		if tc == nil {
			return false
		}
		switch tc.GetApprovalAction() {
		case agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
			agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE_ALL:
			// Server-authored consent — verified.
		default:
			return false
		}
	}
	return true
}

// findToolCall locates a tool call by id across the transcript and sub-agent
// transcripts (a lease-granting APPROVE_ALL row may live in either).
func findToolCall(status *agentexecutionv1.AgentExecutionStatus, id string) *agentexecutionv1.ToolCall {
	for _, msg := range status.GetMessages() {
		for _, tc := range msg.GetToolCalls() {
			if tc.GetId() == id {
				return tc
			}
		}
	}
	for _, sa := range status.GetSubAgentExecutions() {
		for _, msg := range sa.GetMessages() {
			for _, tc := range msg.GetToolCalls() {
				if tc.GetId() == id {
					return tc
				}
			}
		}
	}
	return nil
}
