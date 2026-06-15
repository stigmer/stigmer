package agentexecution

import (
	"context"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
)

// runBuildStep wires an existing execution into the pipeline context and runs
// BuildNewStateWithStatusStep with the given incoming status, returning the
// merged execution.
func runBuildStep(
	t *testing.T,
	existing *agentexecutionv1.AgentExecution,
	incoming *agentexecutionv1.AgentExecutionStatus,
) *agentexecutionv1.AgentExecution {
	t.Helper()

	input := &agentexecutionv1.AgentExecutionUpdateStatusInput{
		ExecutionId: existing.Metadata.Id,
		Status:      incoming,
	}
	reqCtx := pipeline.NewRequestContext(context.Background(), input)
	reqCtx.Set("existingExecution", existing)

	if err := newBuildNewStateWithStatusStep().Execute(reqCtx); err != nil {
		t.Fatalf("BuildNewStateWithStatusStep.Execute returned error: %v", err)
	}

	merged, ok := reqCtx.Get("execution").(*agentexecutionv1.AgentExecution)
	if !ok {
		t.Fatalf("merged execution not found in context")
	}
	return merged
}

func messages(contents ...string) []*agentexecutionv1.AgentMessage {
	out := make([]*agentexecutionv1.AgentMessage, 0, len(contents))
	for _, c := range contents {
		out = append(out, &agentexecutionv1.AgentMessage{Content: c})
	}
	return out
}

func existingWith(phase agentexecutionv1.ExecutionPhase, msgs ...string) *agentexecutionv1.AgentExecution {
	return &agentexecutionv1.AgentExecution{
		Metadata: &apiresource.ApiResourceMetadata{Id: "exec-guard", Name: "exec-guard"},
		Spec:     &agentexecutionv1.AgentExecutionSpec{},
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase:    phase,
			Messages: messages(msgs...),
		},
	}
}

// A non-terminal execution must never have its transcript shrunk by a partial
// (regressed) status update — the durable-checkpoint resume failure mode.
func TestBuildNewState_RejectsShrinkingMessagesForNonTerminal(t *testing.T) {
	existing := existingWith(agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL, "m1", "m2", "m3")
	incoming := &agentexecutionv1.AgentExecutionStatus{
		Phase:    agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
		Messages: messages("only-one"),
	}

	merged := runBuildStep(t, existing, incoming)

	if got := len(merged.Status.Messages); got != 3 {
		t.Fatalf("expected existing 3 messages preserved, got %d", got)
	}
	if merged.Status.Messages[0].Content != "m1" {
		t.Fatalf("expected original transcript kept, got %q", merged.Status.Messages[0].Content)
	}
}

// A growing transcript (the normal streaming case) is accepted.
func TestBuildNewState_AcceptsGrowingMessages(t *testing.T) {
	existing := existingWith(agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, "m1", "m2")
	incoming := &agentexecutionv1.AgentExecutionStatus{
		Phase:    agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
		Messages: messages("m1", "m2", "m3"),
	}

	merged := runBuildStep(t, existing, incoming)

	if got := len(merged.Status.Messages); got != 3 {
		t.Fatalf("expected 3 messages after growth, got %d", got)
	}
}

// An equal-length replacement (in-place mutation of the same turns) is accepted.
func TestBuildNewState_AcceptsEqualLengthMessages(t *testing.T) {
	existing := existingWith(agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, "m1", "m2")
	incoming := &agentexecutionv1.AgentExecutionStatus{
		Phase:    agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
		Messages: messages("m1-updated", "m2-updated"),
	}

	merged := runBuildStep(t, existing, incoming)

	if got := len(merged.Status.Messages); got != 2 {
		t.Fatalf("expected 2 messages, got %d", got)
	}
	if merged.Status.Messages[0].Content != "m1-updated" {
		t.Fatalf("expected equal-length replacement applied, got %q", merged.Status.Messages[0].Content)
	}
}

// The guard is scoped to non-terminal executions: a terminal execution may be
// rewritten (e.g. an administrative correction) without the shrink guard.
func TestBuildNewState_AllowsShrinkForTerminal(t *testing.T) {
	existing := existingWith(agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "m1", "m2", "m3")
	incoming := &agentexecutionv1.AgentExecutionStatus{
		Phase:    agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		Messages: messages("single"),
	}

	merged := runBuildStep(t, existing, incoming)

	if got := len(merged.Status.Messages); got != 1 {
		t.Fatalf("expected terminal replacement applied (1 message), got %d", got)
	}
}
