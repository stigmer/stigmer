package approval

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// This is the OSS half of the cross-edition sequence corpus
// (apis/testdata/hitl/sequences). Where fixtures_test.go locks a single
// input -> pending_approvals projection, this replays the stateful,
// persisted-append path: each sequence is a series of write sites over a
// carried-forward approval_event_stream, and after EVERY step both projections
// must agree (the equality-at-every-write-site property the source-of-truth flip
// rides on) and the authored lifecycle must match. The Java mirror,
// SequenceFixtureTest, replays the same files, so a drift in either reconciler
// fails one of the two suites. See the corpus README for the format and the two
// write-site types.

// sequenceFile mirrors apis/testdata/hitl/sequences/schema.json. Proto bodies
// stay raw protojson and are decoded with the generated types so a malformed step
// fails loudly rather than being silently skipped.
type sequenceFile struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	ExecutionID string         `json:"execution_id"`
	Steps       []sequenceStep `json:"steps"`
}

type sequenceStep struct {
	Name      string             `json:"name"`
	Status    sequenceStatus     `json:"status"`
	Decisions []sequenceDecision `json:"decisions"`
	Expected  sequenceExpected   `json:"expected"`
}

type sequenceStatus struct {
	Phase              string            `json:"phase"`
	Messages           []json.RawMessage `json:"messages"`
	SubAgentExecutions []json.RawMessage `json:"sub_agent_executions"`
}

// sequenceDecision drives a SubmitApproval write site: the target call must be
// pre-decision gated in the step's status, and the driver applies exactly what
// the handler applies (action/decided_at/approved_by) before authoring the
// decision event.
type sequenceDecision struct {
	ToolCallID string `json:"tool_call_id"`
	Action     string `json:"action"`
	DecidedBy  string `json:"decided_by"`
	Comment    string `json:"comment"`
	DecidedAt  string `json:"decided_at"`
}

type sequenceExpected struct {
	PendingApprovals []json.RawMessage `json:"pending_approvals"`
	StreamEvents     []streamEventView `json:"stream_events"`
}

// streamEventView is the normalized projection of an approval event the corpus
// asserts cross-edition: the lifecycle transition (type), its correlation id, and
// the retraction reason — deliberately NOT the internal event_id/timestamp/actor
// (those are locked by the per-edition unit tests). It is comparable so the
// driver can diff actual vs expected as order-independent multisets.
type streamEventView struct {
	ApprovalRequestID string `json:"approval_request_id"`
	EventType         string `json:"event_type"`
	Reason            string `json:"reason"`
}

// TestSequenceCorpus replays every sequence in apis/testdata/hitl/sequences and,
// after each step, asserts (1) the seam result equals expected.pending_approvals,
// (2) for a live execution the two projections agree, and (3) the authored
// lifecycle equals expected.stream_events. It also asserts, once per sequence,
// that the production divergence counter never moved — the same backstop the flip
// is gated on, exercised end-to-end through the real seam.
func TestSequenceCorpus(t *testing.T) {
	dir := sequencesDir(t)
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("reading sequences dir %s: %v", dir, err)
	}

	loaded := 0
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" || entry.Name() == "schema.json" {
			continue
		}
		loaded++
		name := entry.Name()
		t.Run(name, func(t *testing.T) {
			runSequence(t, loadSequence(t, filepath.Join(dir, name)))
		})
	}

	// Guard the guard: a silently empty corpus would pass for the wrong reason.
	if loaded < 6 {
		t.Fatalf("loaded %d sequences, want >= 6 (corpus missing or not discovered)", loaded)
	}
}

func runSequence(t *testing.T, seq sequenceFile) {
	t.Helper()
	if len(seq.Steps) == 0 {
		t.Fatalf("sequence %q has no steps", seq.Name)
	}

	// The carried-forward stream is the only state threaded across steps — exactly
	// what production persists on AgentExecutionStatus.approval_event_stream.
	var stream *agentexecutionv1.ApprovalEventStream

	// The divergence counter is the production backstop the flip is gated on; it
	// must not move across a well-formed sequence (any divergence at the seam bumps
	// it). Measured once around the whole replay to stay robust to scheduling.
	divergenceBefore := PendingApprovalDivergenceCount()

	for _, step := range seq.Steps {
		messages := decodeMessages(t, step.Status.Messages)
		subAgents := decodeSubAgents(t, step.Status.SubAgentExecutions)
		phase := parsePhase(t, step.Status.Phase)

		status := &agentexecutionv1.AgentExecutionStatus{
			Phase:               phase,
			Messages:            messages,
			SubAgentExecutions:  subAgents,
			ApprovalEventStream: stream,
		}

		applyWriteSite(t, status, seq.ExecutionID, step)
		stream = status.GetApprovalEventStream()

		// (1) Value contract: the real seam, as production calls it.
		got := ProjectPendingApprovals(phase, messages, subAgents, stream)
		want := decodePendingApprovals(t, step.Expected.PendingApprovals)
		if diff := diffPendingApprovals(want, got); diff != "" {
			t.Errorf("step %q: seam pending_approvals != expected: %s", step.Name, diff)
		}

		// (2) Equality property: for a live execution the two projections must be
		// identical. A terminal execution is handled by the phase-aware seam in (1),
		// which collapses both to empty regardless of stale tool-call state.
		if !isTerminalExecution(phase) {
			fromScan := ComputePendingApprovals(messages, subAgents)
			fromEvents := ComputePendingApprovalsFromEvents(stream)
			if diff := diffPendingApprovals(fromScan, fromEvents); diff != "" {
				t.Errorf("step %q: equality-at-write-site violated (phase %s): %s", step.Name, phase, diff)
			}
		}

		// (3) Lifecycle: the authored stream's normalized event view.
		if diff := diffStreamEvents(step.Expected.StreamEvents, stream); diff != "" {
			t.Errorf("step %q: stream_events != expected: %s", step.Name, diff)
		}
	}

	if after := PendingApprovalDivergenceCount(); after != divergenceBefore {
		t.Errorf("divergence counter moved across sequence %q: before=%d after=%d (a step's projections diverged)",
			seq.Name, divergenceBefore, after)
	}
}

// applyWriteSite reproduces the production authoring for the step's write-site
// type. An UpdateStatus site (no decisions) runs EnsureApprovalRequests only. A
// SubmitApproval site authors EnsureApprovalRequests while the call is still
// gated, then applies each decision and records its event — the same order as the
// SubmitApproval handler, which is what prevents a false retraction of the call
// being decided.
func applyWriteSite(t *testing.T, status *agentexecutionv1.AgentExecutionStatus, executionID string, step sequenceStep) {
	t.Helper()

	// Guard: a decision target must be pre-decision gated in the snapshot, or the
	// corpus would be modeling a state the handler never produces.
	for _, d := range step.Decisions {
		tc := findToolCall(status, d.ToolCallID)
		if tc == nil {
			t.Fatalf("step %q: decision target %q not found in status", step.Name, d.ToolCallID)
		}
		if !isGatedToolCall(tc) || tc.GetApprovalAction() != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED {
			t.Fatalf("step %q: decision target %q must be pre-decision gated (WAITING_APPROVAL, UNSPECIFIED); got status=%s action=%s",
				step.Name, d.ToolCallID, tc.GetStatus(), tc.GetApprovalAction())
		}
	}

	EnsureApprovalRequests(status, executionID)

	for _, d := range step.Decisions {
		tc := findToolCall(status, d.ToolCallID)
		tc.ApprovalAction = parseAction(t, d.Action)
		tc.ApprovalDecidedAt = d.DecidedAt
		tc.ApprovedBy = d.DecidedBy
		RecordDecisionEvent(status, tc, d.DecidedBy, d.Comment)
	}
}

// findToolCall locates a tool call by id across the root transcript and every
// sub-agent transcript, returning the live pointer so callers mutate the status.
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

// diffStreamEvents compares the normalized event view of the authored stream
// against the expected set, order-independently (as a multiset), returning a
// short description of the first differences or "" when they match.
func diffStreamEvents(want []streamEventView, stream *agentexecutionv1.ApprovalEventStream) string {
	wantCounts := make(map[streamEventView]int, len(want))
	for _, e := range want {
		wantCounts[e]++
	}
	gotCounts := make(map[streamEventView]int)
	for _, ev := range stream.GetEvents() {
		gotCounts[normalizeStreamEvent(ev)]++
	}

	var diffs []string
	for e, n := range gotCounts {
		if wantCounts[e] != n {
			diffs = append(diffs, "unexpected:"+e.ApprovalRequestID+"/"+e.EventType)
		}
	}
	for e, n := range wantCounts {
		if gotCounts[e] != n {
			diffs = append(diffs, "missing:"+e.ApprovalRequestID+"/"+e.EventType)
		}
	}
	sort.Strings(diffs)
	return strings.Join(diffs, ",")
}

// normalizeStreamEvent projects an approval event to the cross-edition contract:
// transition type, correlation id, and (for a retraction) its reason — never the
// internal event_id/timestamp/actor.
func normalizeStreamEvent(ev *agentexecutionv1.ApprovalEvent) streamEventView {
	view := streamEventView{
		ApprovalRequestID: ev.GetApprovalRequestId(),
		EventType:         ev.GetEventType().String(),
	}
	if ev.GetEventType() == agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_RETRACTED {
		view.Reason = ev.GetRetracted().GetReason().String()
	}
	return view
}

func parsePhase(t *testing.T, s string) agentexecutionv1.ExecutionPhase {
	t.Helper()
	if s == "" {
		return agentexecutionv1.ExecutionPhase_EXECUTION_PHASE_UNSPECIFIED
	}
	v, ok := agentexecutionv1.ExecutionPhase_value[s]
	if !ok {
		t.Fatalf("unknown ExecutionPhase %q", s)
	}
	return agentexecutionv1.ExecutionPhase(v)
}

func parseAction(t *testing.T, s string) agentexecutionv1.ApprovalAction {
	t.Helper()
	v, ok := agentexecutionv1.ApprovalAction_value[s]
	if !ok {
		t.Fatalf("unknown ApprovalAction %q", s)
	}
	return agentexecutionv1.ApprovalAction(v)
}

func sequencesDir(t *testing.T) string {
	t.Helper()
	return filepath.Join(hitlCorpusDir(t), "sequences")
}

func loadSequence(t *testing.T, path string) sequenceFile {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading sequence %s: %v", path, err)
	}
	var seq sequenceFile
	if err := json.Unmarshal(raw, &seq); err != nil {
		t.Fatalf("decoding sequence %s: %v", path, err)
	}
	return seq
}
