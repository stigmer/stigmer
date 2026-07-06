//go:build integration

package integration

import (
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Edit-and-resubmit (stigmer/stigmer#181): the successor execution carries
// spec.supersedes_execution_id, and chat clients hide the superseded turn.
// The field is caller-supplied and the create pipeline must persist it
// verbatim — this test guards the round-trip (create → get → listBySession)
// so a future pipeline step that strips spec fields cannot silently break
// the in-place replace behavior.
func TestAgentExecution_SupersedesExecutionId_RoundTrip(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := harness.TestContext(t, 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := harness.CreateAgent(t, ctx, clients, "test-supersede-roundtrip",
		"You are a helpful assistant. Respond briefly.")

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(), sessionv1.Harness_HARNESS_NATIVE)
	sessionID := session.GetMetadata().GetId()

	// The "stopped" turn. No need to wait for (or cancel) it — the supersede
	// link is a pure spec persistence concern, independent of the
	// predecessor's lifecycle.
	original := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID, "original message with a tpyo")
	originalID := original.GetMetadata().GetId()

	successor := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID, "original message with a typo",
		harness.WithSupersedesExecutionId(originalID))
	successorID := successor.GetMetadata().GetId()

	// The create response must already echo the link.
	assert.Equal(t, originalID, successor.GetSpec().GetSupersedesExecutionId(),
		"create response should carry supersedes_execution_id")

	// Get: the persisted record carries the link.
	got, err := clients.AgentExecutionQuery.Get(ctx,
		&agentexecv1.AgentExecutionId{Value: successorID})
	require.NoError(t, err, "get successor execution should succeed")
	assert.Equal(t, originalID, got.GetSpec().GetSupersedesExecutionId(),
		"persisted successor should carry supersedes_execution_id")

	// The original record is never mutated — the link lives on the
	// successor only (append-only execution log).
	gotOriginal, err := clients.AgentExecutionQuery.Get(ctx,
		&agentexecv1.AgentExecutionId{Value: originalID})
	require.NoError(t, err, "get original execution should succeed")
	assert.Empty(t, gotOriginal.GetSpec().GetSupersedesExecutionId(),
		"original execution must not carry a supersede link")

	// ListBySession: both records remain listed (hiding is a client-side,
	// chat-thread concern) and the link survives the list read path.
	list, err := clients.AgentExecutionQuery.ListBySession(ctx,
		&agentexecv1.ListAgentExecutionsBySessionRequest{
			SessionId: sessionID,
			PageSize:  100,
		})
	require.NoError(t, err, "listBySession should succeed")

	var listedOriginal, listedSuccessor *agentexecv1.AgentExecution
	for _, entry := range list.GetEntries() {
		switch entry.GetMetadata().GetId() {
		case originalID:
			listedOriginal = entry
		case successorID:
			listedSuccessor = entry
		}
	}
	require.NotNil(t, listedOriginal,
		"superseded execution must remain in the session's execution list")
	require.NotNil(t, listedSuccessor,
		"successor execution must appear in the session's execution list")
	assert.Equal(t, originalID, listedSuccessor.GetSpec().GetSupersedesExecutionId(),
		"supersedes_execution_id must survive the list read path")
}
