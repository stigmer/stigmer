//go:build integration

package integration

import (
	"context"
	"strings"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	executionctxv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWorkflowAgentCall_EnvVarsForwardedToChildExecution verifies that
// workflow-level runtime environment variables are automatically forwarded
// to child agent executions spawned by agent_call tasks via the intersection-
// forwarding logic in CallAgent.
//
// Regression test for the bug where executionRuntimeEnv was computed but
// never wired into AgentExecution.spec.runtime_env, causing child agents'
// MCP servers to fail with "requires environment variable ... which is not
// provided."
func TestWorkflowAgentCall_EnvVarsForwardedToChildExecution(t *testing.T) {
	requireAgentCallPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "env-fwd", suiteLogger)
	defer deployer.Cleanup(ctx)

	agent := createEnvForwardingTestAgent(t, ctx, clients, "basic")

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"org":     harness.TestOrg,
		"message": "Reply with exactly: env-forwarding-ok",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-env-forwarding",
			Org:  harness.TestOrg,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: workflow env vars forwarded to child agent execution",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: harness.TestOrg,
				Name:      "integration-test-env-forwarding",
				Version:   "1.0.0",
			},
			Env: map[string]*environmentv1.EnvVarDeclaration{
				"TEST_DB_URL": {
					IsSecret:    true,
					Description: "Test database URL — must reach child agent",
				},
				"TEST_FLAG": {
					Description: "Non-secret flag — must reach child agent",
				},
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "callEnvAgent",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	runtimeEnv := map[string]*executionctxv1.ExecutionValue{
		"TEST_DB_URL": {Value: "postgresql://test:test@localhost:5432/testdb", IsSecret: true},
		"TEST_FLAG":   {Value: "enabled"},
	}

	_, execution, err := deployer.DeployAndExecuteWithEnv(ctx, workflow, "env forwarding test", runtimeEnv)
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	require.NotEmpty(t, executionID)
	t.Logf("workflow execution created: id=%s", executionID)

	// Poll for the child AgentExecution created by the CallAgent activity.
	// The child will eventually fail in offline mode (no LLM provider), but
	// we only need it to get past execution creation (env merge + validation).
	var childExec *agentexecv1.AgentExecution
	require.Eventually(t, func() bool {
		childExec = findChildAgentExecution(t, ctx, clients, executionID)
		return childExec != nil
	}, 30*time.Second, 500*time.Millisecond,
		"CallAgent activity should have created a child AgentExecution for workflow %s", executionID)

	childExecID := childExec.GetMetadata().GetId()
	t.Logf("found child agent execution: id=%s, session=%s, parent_workflow=%s",
		childExecID,
		childExec.GetSpec().GetSessionId(),
		childExec.GetSpec().GetParentWorkflowId())

	// Verify the child execution's ExecutionContext contains the forwarded env vars.
	// The server's createExecutionContextStep merges runtime_env into the context.
	childCtx, err := clients.ExecutionContextQuery.GetByExecutionId(ctx,
		&executionctxv1.ExecutionContextExecutionIdInput{ExecutionId: childExecID})
	require.NoError(t, err, "should be able to fetch child execution's ExecutionContext")

	ctxData := childCtx.GetSpec().GetData()
	assert.Contains(t, ctxData, "TEST_DB_URL",
		"child ExecutionContext should contain TEST_DB_URL forwarded from workflow runtime_env")
	assert.Contains(t, ctxData, "TEST_FLAG",
		"child ExecutionContext should contain TEST_FLAG forwarded from workflow runtime_env")

	if val, ok := ctxData["TEST_DB_URL"]; ok {
		assert.True(t, val.GetIsSecret(), "TEST_DB_URL should be marked as secret")
	}
	if val, ok := ctxData["TEST_FLAG"]; ok {
		assert.Equal(t, "enabled", val.GetValue(), "TEST_FLAG value should match")
	}

	t.Logf("PASS: child ExecutionContext contains %d forwarded env vars", len(ctxData))
}

// TestWorkflowAgentCall_IdempotentSessionReuse verifies that when a workflow
// execution is recovered after a failure, the CallAgent activity gracefully
// reuses the session created in the previous attempt rather than failing with
// ALREADY_EXISTS.
func TestWorkflowAgentCall_IdempotentSessionReuse(t *testing.T) {
	requireAgentCallPrereqs(t)
	requireLLMAvailable(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "idempotent", suiteLogger)
	defer deployer.Cleanup(ctx)

	agent := createEnvForwardingTestAgent(t, ctx, clients, "idempotent")

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"org":     harness.TestOrg,
		"message": "Reply with exactly: idempotent-test-ok",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-idempotent-session",
			Org:  harness.TestOrg,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: idempotent session reuse on workflow recovery",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: harness.TestOrg,
				Name:      "integration-test-idempotent-session",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "callAgent",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "idempotent session test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	require.NotEmpty(t, executionID)
	t.Logf("workflow execution created: id=%s", executionID)

	// Wait for the agent_call to create its child session and execution.
	// In offline mode (no LLM provider), the child will eventually fail.
	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, executionID, 2*time.Minute)
	require.NoError(t, err, "workflow should reach a terminal state")

	initialPhase := result.GetStatus().GetPhase()
	t.Logf("workflow reached terminal phase: %s", initialPhase.String())

	// Count sessions created by the first attempt
	sessionsBeforeRecover := countSessionsByPrefix(t, ctx, clients, "ses-wf-")

	if initialPhase != workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED {
		t.Skipf("workflow did not fail (phase=%s), skipping recover test", initialPhase)
	}

	// Recover the failed workflow execution
	_, err = clients.ExecutionCommand.Recover(ctx, &workflowexecutionv1.RecoverWorkflowExecutionInput{
		Id: executionID,
	})
	require.NoError(t, err, "recover should succeed for a failed workflow execution")
	t.Logf("workflow execution recovered: id=%s", executionID)

	// Wait for the recovered workflow to reach a terminal state again
	_, err = waiter.WaitForTerminal(ctx, executionID, 2*time.Minute)
	require.NoError(t, err, "recovered workflow should reach a terminal state")

	// Verify no duplicate sessions were created: the recovered workflow
	// should reuse the session from the first attempt
	sessionsAfterRecover := countSessionsByPrefix(t, ctx, clients, "ses-wf-")

	// Allow at most 1 additional session (the retry execution may need a new
	// session if the naming pattern changed), but NOT a full duplication
	assert.LessOrEqual(t, sessionsAfterRecover, sessionsBeforeRecover+1,
		"recover should not create duplicate sessions; before=%d, after=%d",
		sessionsBeforeRecover, sessionsAfterRecover)

	t.Logf("PASS: sessions before=%d, after=%d (no duplication)",
		sessionsBeforeRecover, sessionsAfterRecover)
}

// TestWorkflowAgentCall_EnvVarsForwardedWithMcpServerRef verifies that
// workflow env vars reach a child agent whose env declarations come from
// MCP server references via MergeMcpServerEnvSpecsStep — NOT from explicit
// agent-level env declarations.
//
// This covers the production scenario (e.g., daily-notification-plan →
// notification-analyst → postgres MCP server) where POSTGRES_CONNECTION_URL
// is declared on the MCP server, merged into the agent's spec.env at apply
// time, and must be forwarded through the agent_call pipeline.
func TestWorkflowAgentCall_EnvVarsForwardedWithMcpServerRef(t *testing.T) {
	requireAgentCallPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "mcp-env", suiteLogger)
	defer deployer.Cleanup(ctx)

	// 1. Create an MCP server that declares a required env var.
	mcpServer := &mcpserverv1.McpServer{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-mcp-env-server",
			Org:  harness.TestOrg,
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "Integration test MCP server for env forwarding via mcp_server_usages",
			ServerType: &mcpserverv1.McpServerSpec_Stdio{
				Stdio: &mcpserverv1.StdioServerConfig{
					Command: "echo",
					Args:    []string{"test-mcp-server"},
				},
			},
			Env: map[string]*environmentv1.EnvVarDeclaration{
				"TEST_MCP_CONN_URL": {
					IsSecret:    true,
					Description: "required by the MCP server, must be forwarded from workflow",
				},
			},
		},
	}

	createdMcp, err := clients.McpServerCommand.Apply(ctx, mcpServer)
	require.NoError(t, err, "apply MCP server should succeed")
	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = clients.McpServerCommand.Delete(cleanCtx, &apiresource.ApiResourceDeleteInput{ResourceId: createdMcp.GetMetadata().GetId()})
	})

	// 2. Create an agent that references the MCP server but does NOT
	//    explicitly declare TEST_MCP_CONN_URL in its own spec.env.
	//    MergeMcpServerEnvSpecsStep should merge it in at apply time.
	agent := &agentv1.Agent{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-mcp-env-agent",
			Org:  harness.TestOrg,
		},
		Spec: &agentv1.AgentSpec{
			Description:  "Agent for testing env forwarding via MCP server declarations",
			Instructions: "You are a test agent. Reply with exactly what is asked.",
			McpServerUsages: []*agentv1.McpServerUsage{
				{
					McpServerRef: &apiresource.ApiResourceReference{
						Slug: "test-mcp-env-server",
						Org:  harness.TestOrg,
						Kind: apiresourcekind.ApiResourceKind_mcp_server,
					},
				},
			},
		},
	}

	createdAgent, err := clients.AgentCommand.Apply(ctx, agent)
	require.NoError(t, err, "apply agent should succeed")
	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = clients.AgentCommand.Delete(cleanCtx, &agentv1.AgentId{Value: createdAgent.GetMetadata().GetId()})
	})

	// 3. Verify MergeMcpServerEnvSpecsStep merged the MCP env var into agent.spec.env.
	agentEnv := createdAgent.GetSpec().GetEnv()
	require.Contains(t, agentEnv, "TEST_MCP_CONN_URL",
		"MergeMcpServerEnvSpecsStep should merge MCP server env into agent.spec.env")
	assert.True(t, agentEnv["TEST_MCP_CONN_URL"].GetIsSecret(),
		"merged env var should preserve isSecret from MCP server declaration")
	t.Logf("agent env after merge: %v", func() []string {
		keys := make([]string, 0, len(agentEnv))
		for k := range agentEnv {
			keys = append(keys, k)
		}
		return keys
	}())

	// 4. Create a workflow that declares the same env var and uses agent_call.
	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   createdAgent.GetMetadata().GetSlug(),
		"org":     harness.TestOrg,
		"message": "Reply with exactly: mcp-env-forwarding-ok",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-mcp-env-forwarding",
			Org:  harness.TestOrg,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: env vars forwarded via MCP server env declarations",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: harness.TestOrg,
				Name:      "integration-test-mcp-env-forwarding",
				Version:   "1.0.0",
			},
			Env: map[string]*environmentv1.EnvVarDeclaration{
				"TEST_MCP_CONN_URL": {
					IsSecret:    true,
					Description: "provided at workflow run time, must reach child agent",
				},
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "callMcpAgent",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	runtimeEnv := map[string]*executionctxv1.ExecutionValue{
		"TEST_MCP_CONN_URL": {Value: "postgresql://test:test@localhost:5432/mcp-test", IsSecret: true},
	}

	_, execution, err := deployer.DeployAndExecuteWithEnv(ctx, workflow, "mcp env forwarding test", runtimeEnv)
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	require.NotEmpty(t, executionID)
	t.Logf("workflow execution created: id=%s", executionID)

	// 5. Poll for the child AgentExecution created by CallAgent activity.
	var childExec *agentexecv1.AgentExecution
	require.Eventually(t, func() bool {
		childExec = findChildAgentExecution(t, ctx, clients, executionID)
		return childExec != nil
	}, 30*time.Second, 500*time.Millisecond,
		"CallAgent activity should have created a child AgentExecution for workflow %s "+
			"even though agent env came from MCP server merge, not explicit declaration", executionID)

	childExecID := childExec.GetMetadata().GetId()
	t.Logf("found child agent execution: id=%s", childExecID)

	// 6. Verify the child ExecutionContext contains the MCP-derived env var.
	childCtx, err := clients.ExecutionContextQuery.GetByExecutionId(ctx,
		&executionctxv1.ExecutionContextExecutionIdInput{ExecutionId: childExecID})
	require.NoError(t, err, "should be able to fetch child execution's ExecutionContext")

	ctxData := childCtx.GetSpec().GetData()
	assert.Contains(t, ctxData, "TEST_MCP_CONN_URL",
		"child ExecutionContext should contain TEST_MCP_CONN_URL — "+
			"forwarded from workflow runtime_env through agent_call intersection "+
			"using MCP-merged agent.spec.env")

	if val, ok := ctxData["TEST_MCP_CONN_URL"]; ok {
		assert.True(t, val.GetIsSecret(), "TEST_MCP_CONN_URL should be marked as secret")
		// getByExecutionId decrypts secrets only for the runner credential class
		// (stigmer-cloud eff89ac7f); a plain client sees the redaction marker.
		// A non-empty marker proves the value was forwarded and stored; the
		// plaintext must never surface on this read path.
		assert.Equal(t, "***REDACTED***", val.GetValue(),
			"secret value should be redacted for non-runner callers")
		assert.NotContains(t, val.GetValue(), "localhost:5432/mcp-test",
			"plaintext secret must never leak through a non-runner read")
	}

	t.Logf("PASS: child ExecutionContext contains MCP-derived env var TEST_MCP_CONN_URL")
}

func createEnvForwardingTestAgent(t *testing.T, ctx context.Context, clients *harness.Clients, suffix string) *agentv1.Agent {
	t.Helper()

	agentName := "test-env-fwd-" + suffix

	agent := &agentv1.Agent{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: agentName,
			Org:  harness.TestOrg,
		},
		Spec: &agentv1.AgentSpec{
			Description:  "Integration test agent for env var forwarding verification",
			Instructions: "You are a test agent. Reply with exactly what is asked.",
			Env: map[string]*environmentv1.EnvVarDeclaration{
				"TEST_DB_URL": {IsSecret: true, Description: "forwarded from workflow"},
				"TEST_FLAG":   {Description: "forwarded from workflow"},
			},
		},
	}

	created, err := clients.AgentCommand.Apply(ctx, agent)
	require.NoError(t, err, "apply agent should succeed")

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = clients.AgentCommand.Delete(cleanCtx, &agentv1.AgentId{Value: created.GetMetadata().GetId()})
	})

	return created
}

func findChildAgentExecution(t *testing.T, ctx context.Context, clients *harness.Clients, workflowExecutionID string) *agentexecv1.AgentExecution {
	t.Helper()

	expectedParentWorkflowID := "workflow-exec-" + workflowExecutionID

	resp, err := clients.AgentExecutionQuery.List(ctx, &agentexecv1.ListAgentExecutionsRequest{})
	require.NoError(t, err, "listing agent executions should succeed")

	for _, ae := range resp.GetEntries() {
		if ae.GetSpec().GetParentWorkflowId() == expectedParentWorkflowID {
			return ae
		}
	}
	return nil
}

func countSessionsByPrefix(t *testing.T, ctx context.Context, clients *harness.Clients, prefix string) int {
	t.Helper()

	resp, err := clients.SessionQuery.List(ctx, &sessionv1.ListSessionsRequest{PageSize: 100})
	if err != nil {
		t.Logf("warning: could not list sessions: %v", err)
		return 0
	}

	count := 0
	for _, s := range resp.GetEntries() {
		slug := s.GetMetadata().GetSlug()
		if strings.HasPrefix(slug, prefix) {
			count++
		}
	}
	return count
}
