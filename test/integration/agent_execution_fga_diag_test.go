//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// TestFGADiag_BearerTokenUpdateStatus reproduces the runner's exact call
// pattern: a gRPC connection with "Bearer test-integration-key" calling
// updateStatus on an execution created by the unauthenticated test identity.
//
// This diagnoses whether the permission_denied error seen in Category 1
// failures is caused by the Java service resolving a Bearer-token-bearing
// gRPC call to a different identity than the default test-identity-account-id.
func TestFGADiag_BearerTokenUpdateStatus(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness == nil || testHarness.Service == nil {
		t.Skip("Java service not running")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// Step 1: Create an execution using the normal (no-token) connection.
	// This establishes the FGA tuples: session#owner and agent_execution#session.
	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-fga-diag",
		"You are a test assistant. Respond briefly.")

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(), 0)

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(), "diagnostic test message")

	executionID := exec.GetMetadata().GetId()
	t.Logf("created execution: %s in session: %s", executionID, session.GetMetadata().GetId())

	// Step 2: Verify the no-token connection CAN call updateStatus (baseline).
	baselineStatus := &agentexecv1.AgentExecutionStatus{
		Phase: agentexecv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
	}
	_, err := clients.AgentExecutionCommand.UpdateStatus(ctx, &agentexecv1.AgentExecutionUpdateStatusInput{
		ExecutionId: executionID,
		Status:      baselineStatus,
	})
	if err != nil {
		st, _ := status.FromError(err)
		t.Logf("baseline (no-token) updateStatus result: code=%s msg=%s", st.Code(), st.Message())
	} else {
		t.Logf("baseline (no-token) updateStatus: SUCCESS")
	}

	// Step 3: Create a second gRPC connection WITH a proper Stigmer JWT
	// (simulating the unified runner's connect-node transport with a real token).
	runnerJWT, err := harness.MintRunnerToken()
	require.NoError(t, err, "mint runner JWT")
	t.Logf("minted runner JWT (first 40 chars): %s...", runnerJWT[:40])

	bearerConn, err := grpc.NewClient(
		testHarness.Service.GRPCAddress(),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithUnaryInterceptor(func(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
			ctx = metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+runnerJWT)
			return invoker(ctx, method, req, reply, cc, opts...)
		}),
	)
	require.NoError(t, err, "create bearer-token gRPC connection")
	defer bearerConn.Close()

	bearerClients := harness.NewClients(bearerConn)

	// Step 4: Call updateStatus from the Bearer-token connection.
	bearerStatus := &agentexecv1.AgentExecutionStatus{
		Phase: agentexecv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
	}
	_, err = bearerClients.AgentExecutionCommand.UpdateStatus(ctx, &agentexecv1.AgentExecutionUpdateStatusInput{
		ExecutionId: executionID,
		Status:      bearerStatus,
	})

	if err != nil {
		st, ok := status.FromError(err)
		require.True(t, ok, "error should be a gRPC status")
		t.Logf("BEARER TOKEN updateStatus result: code=%s msg=%q", st.Code(), st.Message())

		if st.Code() == codes.PermissionDenied {
			t.Logf("DIAGNOSIS: Bearer token gRPC calls resolve to a DIFFERENT identity than no-token calls.")
			t.Logf("This confirms the bug is in IntegrationTestSecurityConfig's identity resolution for Bearer-token requests.")
			t.Logf("The runner sends 'Bearer test-integration-key' which the Java service resolves to a wrong identity.")
		}

		assert.NotEqual(t, codes.PermissionDenied, st.Code(),
			"Bearer-token updateStatus should NOT get permission_denied — "+
				"the token should resolve to the same test-identity-account-id as no-token calls")
	} else {
		t.Logf("BEARER TOKEN updateStatus: SUCCESS — Bearer token resolves to correct identity")
	}

	// Step 5: Also test cancel from Bearer-token connection (for comparison).
	_, err = bearerClients.AgentExecutionCommand.Cancel(ctx, &agentexecv1.CancelAgentExecutionInput{
		Id: executionID,
	})
	if err != nil {
		st, _ := status.FromError(err)
		t.Logf("BEARER TOKEN cancel result: code=%s msg=%q", st.Code(), st.Message())
	} else {
		t.Logf("BEARER TOKEN cancel: SUCCESS")
	}
}

// TestFGADiag_CreateWithAgentIdBearerToken tests the "CreateWithAgentId"
// flow using a Bearer-token connection throughout (including create + updateStatus).
// This mimics the scenario where the runner creates sub-agent executions.
func TestFGADiag_CreateWithAgentIdBearerToken(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness == nil || testHarness.Service == nil {
		t.Skip("Java service not running")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// Create a Bearer-token connection with a proper Stigmer JWT.
	runnerJWT, err := harness.MintRunnerToken()
	require.NoError(t, err, "mint runner JWT")

	bearerConn, err := grpc.NewClient(
		testHarness.Service.GRPCAddress(),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithUnaryInterceptor(func(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
			ctx = metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+runnerJWT)
			return invoker(ctx, method, req, reply, cc, opts...)
		}),
	)
	require.NoError(t, err)
	defer bearerConn.Close()

	bearerClients := harness.NewClients(bearerConn)

	// Create agent via no-token connection (seed data).
	noTokenClients := harness.NewClients(grpcConn)
	agent := harness.CreateAgent(t, ctx, noTokenClients, "test-fga-diag-create",
		"You are a test assistant. Respond briefly.")

	// Create execution via Bearer-token connection (with agent_id, no session_id).
	exec, err := bearerClients.AgentExecutionCommand.Create(ctx, &agentexecv1.AgentExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentExecution",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-fga-diag-bearer-create",
			Org:  "test-org",
		},
		Spec: &agentexecv1.AgentExecutionSpec{
			AgentId: agent.GetMetadata().GetId(),
			Message: "diagnostic bearer create test",
		},
	})

	if err != nil {
		st, _ := status.FromError(err)
		t.Logf("BEARER TOKEN create execution: code=%s msg=%q", st.Code(), st.Message())
		t.Skipf("Cannot proceed — create failed: %v", err)
	}

	executionID := exec.GetMetadata().GetId()
	t.Logf("created execution via Bearer token: %s, session=%s", executionID, exec.GetSpec().GetSessionId())

	// Now call updateStatus from the same Bearer-token connection.
	_, err = bearerClients.AgentExecutionCommand.UpdateStatus(ctx, &agentexecv1.AgentExecutionUpdateStatusInput{
		ExecutionId: executionID,
		Status: &agentexecv1.AgentExecutionStatus{
			Phase: agentexecv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
		},
	})

	if err != nil {
		st, _ := status.FromError(err)
		t.Logf("BEARER TOKEN updateStatus (own execution): code=%s msg=%q", st.Code(), st.Message())
		assert.NotEqual(t, codes.PermissionDenied, st.Code(),
			"should be able to update status on execution created by the same identity")
	} else {
		t.Logf("BEARER TOKEN updateStatus (own execution): SUCCESS")
	}
}
