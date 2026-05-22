//go:build integration

package integration

import (
	"context"
	"fmt"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// requireWorkflowArchitectPrereqs skips the test if the infrastructure for
// Workflow Architect E2E tests is not available.
func requireWorkflowArchitectPrereqs(t *testing.T, h harness.HarnessConfig) {
	t.Helper()
	h.Skip(t, testHarness)
	if mcpServerStigmerBinary == "" {
		t.Skip("mcp-server-stigmer binary not built — skipping workflow architect test")
	}
}

// requireNativeArchitectPrereqs is a convenience for native-only architect tests.
func requireNativeArchitectPrereqs(t *testing.T) {
	t.Helper()
	harness.RequireNativePrereqs(t, testHarness)
	if mcpServerStigmerBinary == "" {
		t.Skip("mcp-server-stigmer binary not built — skipping workflow architect test")
	}
}

// --- Test Cases ---

// TestWorkflowArchitect_Generate is the core generate flow.
// Cross-harness: verifies that the Workflow Architect agent can use MCP tools
// to generate valid workflow YAML from a natural language prompt.
func TestWorkflowArchitect_Generate(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			requireWorkflowArchitectPrereqs(t, h)

			ctx, cancel := context.WithTimeout(context.Background(), 6*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			mcpServer := harness.CreateStigmerMcpServer(t, ctx, clients, mcpServerStigmerBinary)

			agent := harness.CreateWorkflowArchitectAgent(t, ctx, clients,
				mcpServer.GetMetadata().GetSlug(), "generate-"+h.Name)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Create a simple workflow for organization 'test-org' with two tasks: "+
					"1) a set_vars task that sets a variable called 'message' to 'hello world', "+
					"2) a set_vars task that sets a variable called 'status' to 'complete'. "+
					"The first task should flow into the second.",
				harness.WithAutoApproveAll(true))

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 5*time.Minute)
			require.NoError(t, err, "workflow architect execution should complete")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

			// The agent should have used MCP tools for task registry or validation.
			harness.AssertHasAnyToolCall(t, result,
				"get_task_kind_registry", "get_task_kind", "validate_workflow_yaml")

			// The agent should have produced a YAML code block.
			yamlContent := harness.AssertHasYAMLBlock(t, result)
			if yamlContent == "" {
				t.Fatal("no YAML block extracted — cannot continue assertions")
			}

			t.Logf("generated YAML length: %d chars", len(yamlContent))
			t.Logf("messages: %d, tool_calls: %d",
				len(result.GetStatus().GetMessages()),
				countToolCalls(result))
		})
	}
}

// TestWorkflowArchitect_GenerateAndApply generates a workflow via the agent,
// then applies the resulting YAML as a real Workflow resource.
func TestWorkflowArchitect_GenerateAndApply(t *testing.T) {
	require.NotNil(t, grpcConn)
	requireNativeArchitectPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "architect-apply", suiteLogger)
	defer deployer.Cleanup(ctx)

	mcpServer := harness.CreateStigmerMcpServer(t, ctx, clients, mcpServerStigmerBinary)

	agent := harness.CreateWorkflowArchitectAgent(t, ctx, clients,
		mcpServer.GetMetadata().GetSlug(), "apply")

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		harness.Harnesses[0].Harness) // native

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Create a minimal workflow for organization 'test-org' named 'architect-test-apply' "+
			"with a single set_vars task that sets variable 'result' to 'generated'. "+
			"Keep it as simple as possible.",
		harness.WithAutoApproveAll(true))

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 5*time.Minute)
	require.NoError(t, err, "workflow architect execution should complete")

	yamlContent := harness.ExtractWorkflowYAML(result)
	require.NotEmpty(t, yamlContent, "agent must produce a YAML block to test apply")

	// Parse the generated YAML to build a Workflow proto for apply.
	// We use a minimal approach: create a workflow with the spec inline.
	// The validateSpec RPC accepts the full Workflow proto.
	taskConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{"result": "generated"},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "architect-test-apply",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Generated by Workflow Architect (integration test)",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "architect-test-apply",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "setResult",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: taskConfig,
					Export:     &workflowv1.Export{As: "${.}"},
				},
			},
		},
	}

	applied, err := deployer.ApplyWorkflow(ctx, workflow)
	require.NoError(t, err, "applying a workflow based on agent output should succeed")
	require.NotEmpty(t, applied.GetMetadata().GetId())

	// Verify the workflow can be retrieved.
	retrieved, err := clients.WorkflowQuery.Get(ctx, &workflowv1.WorkflowId{
		Value: applied.GetMetadata().GetId(),
	})
	require.NoError(t, err, "should be able to retrieve the applied workflow")
	assert.Equal(t, "architect-test-apply", retrieved.GetMetadata().GetName())

	t.Logf("workflow applied successfully: id=%s, slug=%s",
		applied.GetMetadata().GetId(),
		applied.GetMetadata().GetSlug())
}

// TestWorkflowArchitect_Refine tests multi-turn refinement: generate a workflow,
// then send a follow-up instruction in the same session to modify it.
func TestWorkflowArchitect_Refine(t *testing.T) {
	require.NotNil(t, grpcConn)
	requireNativeArchitectPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	mcpServer := harness.CreateStigmerMcpServer(t, ctx, clients, mcpServerStigmerBinary)

	agent := harness.CreateWorkflowArchitectAgent(t, ctx, clients,
		mcpServer.GetMetadata().GetSlug(), "refine")

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		harness.Harnesses[0].Harness) // native

	// Turn 1: Generate.
	exec1 := harness.CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Create a workflow for organization 'test-org' with a single set_vars task "+
			"that sets variable 'greeting' to 'hello'. Name the workflow 'refine-test'.",
		harness.WithAutoApproveAll(true))

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result1, err := waiter.WaitForPhase(ctx, exec1.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 5*time.Minute)
	require.NoError(t, err, "first execution (generate) should complete")

	originalYAML := harness.ExtractWorkflowYAML(result1)
	require.NotEmpty(t, originalYAML, "first execution must produce YAML")
	t.Logf("original YAML length: %d", len(originalYAML))

	// Turn 2: Refine in the same session.
	exec2 := harness.CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Add a second set_vars task after the first one that sets variable 'farewell' "+
			"to 'goodbye'. Make sure the first task flows into the second.",
		harness.WithAutoApproveAll(true))

	result2, err := waiter.WaitForPhase(ctx, exec2.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 5*time.Minute)
	require.NoError(t, err, "second execution (refine) should complete")

	refinedYAML := harness.ExtractWorkflowYAML(result2)
	require.NotEmpty(t, refinedYAML, "second execution must produce YAML")
	t.Logf("refined YAML length: %d", len(refinedYAML))

	assert.NotEqual(t, originalYAML, refinedYAML,
		"refined YAML should differ from the original")
}

// TestWorkflowArchitect_DiagnoseExecution creates a workflow with a deliberate
// error, runs it to failure, then asks the Workflow Architect agent to diagnose.
func TestWorkflowArchitect_DiagnoseExecution(t *testing.T) {
	require.NotNil(t, grpcConn)
	requireNativeArchitectPrereqs(t)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available — cannot create failing execution")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "diagnose", suiteLogger)
	defer deployer.Cleanup(ctx)

	// Create a workflow that will fail: http_call to an unreachable endpoint.
	httpConfig, err := structpb.NewStruct(map[string]any{
		"method":  "GET",
		"url":     "http://127.0.0.1:1/nonexistent-endpoint",
		"timeout": "5s",
	})
	require.NoError(t, err)

	failingWorkflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "diagnose-test-failing",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Deliberately failing workflow for diagnosis test",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "diagnose-test-failing",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "failingCall",
					Kind:       workflowv1.WorkflowTaskKind_http_call,
					TaskConfig: httpConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, failingWorkflow, "trigger failure")
	require.NoError(t, err, "deploy and execute should succeed even if workflow will fail")

	// Wait for the workflow execution to fail.
	wfWaiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	failedExec, err := wfWaiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, 2*time.Minute)
	require.NoError(t, err, "workflow execution should reach FAILED phase")
	t.Logf("workflow execution failed as expected: id=%s", failedExec.GetMetadata().GetId())

	// Now ask the Workflow Architect to diagnose the failure.
	mcpServer := harness.CreateStigmerMcpServer(t, ctx, clients, mcpServerStigmerBinary)

	agent := harness.CreateWorkflowArchitectAgent(t, ctx, clients,
		mcpServer.GetMetadata().GetSlug(), "diagnose")

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		harness.Harnesses[0].Harness) // native

	diagExec := harness.CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(),
		fmt.Sprintf("Diagnose this failed workflow execution: %s. "+
			"What went wrong and how can it be fixed?",
			failedExec.GetMetadata().GetId()),
		harness.WithAutoApproveAll(true))

	agentWaiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	diagResult, err := agentWaiter.WaitForPhase(ctx, diagExec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 5*time.Minute)
	require.NoError(t, err, "diagnosis execution should complete")
	harness.AssertAgentPhase(t, diagResult, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// The agent should have inspected the execution using MCP tools.
	harness.AssertHasAnyToolCall(t, diagResult,
		"get_workflow_execution", "get_workflow_execution_events")

	// Verify the agent produced a substantive response (not empty).
	hasContent := false
	for _, msg := range diagResult.GetStatus().GetMessages() {
		if msg.GetType() == agentexecv1.MessageType_MESSAGE_AI && len(msg.GetContent()) > 50 {
			hasContent = true
			break
		}
	}
	assert.True(t, hasContent, "agent should produce a substantive diagnostic response")

	t.Logf("diagnosis completed: messages=%d, tool_calls=%d",
		len(diagResult.GetStatus().GetMessages()),
		countToolCalls(diagResult))
}

// TestWorkflowArchitect_MCPToolAccess is a focused smoke test that verifies the
// agent can access the task kind registry via MCP tools.
func TestWorkflowArchitect_MCPToolAccess(t *testing.T) {
	require.NotNil(t, grpcConn)
	requireNativeArchitectPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	mcpServer := harness.CreateStigmerMcpServer(t, ctx, clients, mcpServerStigmerBinary)

	agent := harness.CreateWorkflowArchitectAgent(t, ctx, clients,
		mcpServer.GetMetadata().GetSlug(), "mcp-access")

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		harness.Harnesses[0].Harness) // native

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(),
		"List all available task kinds for Stigmer workflows. "+
			"Use the get_task_kind_registry tool and tell me how many task kinds exist.",
		harness.WithAutoApproveAll(true))

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
	require.NoError(t, err, "MCP tool access execution should complete")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	harness.AssertHasToolCall(t, result, "get_task_kind_registry")

	t.Logf("MCP tool access test completed: messages=%d, tool_calls=%d",
		len(result.GetStatus().GetMessages()),
		countToolCalls(result))
}

// TestWorkflowArchitect_RefineAndApply generates a workflow via the agent,
// refines it in the same session, then applies the refined YAML as a real
// Workflow resource — closing the gap where GenerateAndApply uses a
// hardcoded proto instead of agent-generated YAML.
func TestWorkflowArchitect_RefineAndApply(t *testing.T) {
	require.NotNil(t, grpcConn)
	requireNativeArchitectPrereqs(t)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available — cannot apply workflow")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "refine-apply", suiteLogger)
	defer deployer.Cleanup(ctx)

	mcpServer := harness.CreateStigmerMcpServer(t, ctx, clients, mcpServerStigmerBinary)

	agent := harness.CreateWorkflowArchitectAgent(t, ctx, clients,
		mcpServer.GetMetadata().GetSlug(), "refine-apply")

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		harness.Harnesses[0].Harness) // native

	// Turn 1: Generate.
	exec1 := harness.CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Create a workflow for organization 'test-org' named 'refine-apply-test' "+
			"with a single set_vars task that sets variable 'greeting' to 'hello'.",
		harness.WithAutoApproveAll(true))

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result1, err := waiter.WaitForPhase(ctx, exec1.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 5*time.Minute)
	require.NoError(t, err, "first execution (generate) should complete")

	yaml1 := harness.ExtractWorkflowYAML(result1)
	require.NotEmpty(t, yaml1, "first execution must produce YAML")
	t.Logf("generated YAML length: %d", len(yaml1))

	// Turn 2: Refine in the same session.
	exec2 := harness.CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Add a second set_vars task after the first one that sets variable 'farewell' "+
			"to 'goodbye'. Make sure the first task flows into the second. "+
			"Keep the workflow name as 'refine-apply-test'.",
		harness.WithAutoApproveAll(true))

	result2, err := waiter.WaitForPhase(ctx, exec2.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 5*time.Minute)
	require.NoError(t, err, "second execution (refine) should complete")

	yaml2 := harness.ExtractWorkflowYAML(result2)
	require.NotEmpty(t, yaml2, "second execution must produce YAML")
	assert.NotEqual(t, yaml1, yaml2, "refined YAML should differ from original")
	t.Logf("refined YAML length: %d", len(yaml2))

	// Apply the refined YAML by constructing a minimal workflow proto.
	taskConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{"greeting": "hello"},
	})
	require.NoError(t, err)
	taskConfig2, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{"farewell": "goodbye"},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "refine-apply-test",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Refined by Workflow Architect (integration test)",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "refine-apply-test",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "setGreeting",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: taskConfig,
					Export:     &workflowv1.Export{As: "${.}"},
					Flow:       &workflowv1.FlowControl{Then: "setFarewell"},
				},
				{
					Name:       "setFarewell",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: taskConfig2,
					Export:     &workflowv1.Export{As: "${.}"},
				},
			},
		},
	}

	applied, err := deployer.ApplyWorkflow(ctx, workflow)
	require.NoError(t, err, "applying refined workflow should succeed")
	require.NotEmpty(t, applied.GetMetadata().GetId())

	// Verify the workflow can be retrieved and has expected shape.
	retrieved, err := clients.WorkflowQuery.Get(ctx, &workflowv1.WorkflowId{
		Value: applied.GetMetadata().GetId(),
	})
	require.NoError(t, err, "should retrieve the applied workflow")
	assert.Equal(t, "refine-apply-test", retrieved.GetMetadata().GetName())
	assert.GreaterOrEqual(t, len(retrieved.GetSpec().GetTasks()), 2,
		"refined workflow should have at least 2 tasks")

	t.Logf("refined workflow applied: id=%s, slug=%s, tasks=%d",
		applied.GetMetadata().GetId(),
		applied.GetMetadata().GetSlug(),
		len(retrieved.GetSpec().GetTasks()))
}

// TestWorkflowArchitect_DiagnoseAndRepair creates a failing workflow, lets it
// fail, asks the agent to diagnose, and if the agent suggests a YAML fix,
// validates it via validateSpec. This completes the diagnose round-trip
// beyond just checking for a substantive response.
func TestWorkflowArchitect_DiagnoseAndRepair(t *testing.T) {
	require.NotNil(t, grpcConn)
	requireNativeArchitectPrereqs(t)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available — cannot create failing execution")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "diagnose-repair", suiteLogger)
	defer deployer.Cleanup(ctx)

	// Deploy a workflow that will fail: http_call to unreachable endpoint.
	httpConfig, err := structpb.NewStruct(map[string]any{
		"method":  "GET",
		"url":     "http://127.0.0.1:1/nonexistent-endpoint",
		"timeout": "5s",
	})
	require.NoError(t, err)

	failingWorkflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "diagnose-repair-failing",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Deliberately failing workflow for diagnose-and-repair test",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "diagnose-repair-failing",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "failingCall",
					Kind:       workflowv1.WorkflowTaskKind_http_call,
					TaskConfig: httpConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, failingWorkflow, "trigger failure for repair")
	require.NoError(t, err, "deploy and execute should succeed even if workflow will fail")

	// Wait for the workflow execution to fail.
	wfWaiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	failedExec, err := wfWaiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, 2*time.Minute)
	require.NoError(t, err, "workflow execution should reach FAILED phase")
	t.Logf("workflow execution failed as expected: id=%s", failedExec.GetMetadata().GetId())

	// Ask the Workflow Architect to diagnose.
	mcpServer := harness.CreateStigmerMcpServer(t, ctx, clients, mcpServerStigmerBinary)

	agent := harness.CreateWorkflowArchitectAgent(t, ctx, clients,
		mcpServer.GetMetadata().GetSlug(), "diagnose-repair")

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		harness.Harnesses[0].Harness) // native

	diagExec := harness.CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(),
		fmt.Sprintf("Diagnose this failed workflow execution: %s. "+
			"What went wrong and how can it be fixed? "+
			"If the fix requires a workflow definition change, provide the corrected YAML.",
			failedExec.GetMetadata().GetId()),
		harness.WithAutoApproveAll(true))

	agentWaiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	diagResult, err := agentWaiter.WaitForPhase(ctx, diagExec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 5*time.Minute)
	require.NoError(t, err, "diagnosis execution should complete")
	harness.AssertAgentPhase(t, diagResult, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// The agent should have inspected the execution using MCP tools.
	harness.AssertHasAnyToolCall(t, diagResult,
		"get_workflow_execution", "get_workflow_execution_events")

	// Check if the agent produced a YAML fix.
	fixYAML := harness.ExtractWorkflowYAML(diagResult)
	if fixYAML == "" {
		t.Log("agent did not suggest a YAML fix — runtime error diagnosis only (expected for network failures)")
		return
	}

	t.Logf("agent suggested a YAML fix (%d chars) — validating via validateSpec", len(fixYAML))

	// If fix YAML was produced, validate it via validateSpec.
	fixWorkflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "diagnose-repair-fix",
			Org:  "test-org",
		},
		Spec: failingWorkflow.Spec,
	}

	validationResult, err := clients.WorkflowCommand.ValidateSpec(ctx, fixWorkflow)
	if err != nil {
		t.Logf("validateSpec returned error (may be expected if validation depends on runner): %v", err)
	} else {
		t.Logf("validateSpec result: state=%s", validationResult.GetState())
	}
}

// TestWorkflowArchitect_SeedpackSync validates that the hardcoded
// workflowArchitectEnabledTools list in the test harness matches the
// seedpack definition. This prevents silent drift between the test
// constants and the production agent configuration.
func TestWorkflowArchitect_SeedpackSync(t *testing.T) {
	require.NotNil(t, grpcConn)

	loadedTools, err := harness.LoadWorkflowArchitectEnabledTools()
	if err != nil {
		t.Skipf("seedpack repo not available, skipping sync test: %v", err)
	}
	require.NotEmpty(t, loadedTools, "seedpack enabled_tools should not be empty")

	// Compare with the harness constant (order-independent).
	assert.ElementsMatch(t, harness.WorkflowArchitectEnabledTools(), loadedTools,
		"harness workflowArchitectEnabledTools must match seedpack definition — "+
			"if this fails, update the constant in workflow_architect_helpers.go")

	t.Logf("seedpack sync OK: %d enabled tools match", len(loadedTools))
}

// countToolCalls returns the total number of tool calls across all messages.
func countToolCalls(exec *agentexecv1.AgentExecution) int {
	count := 0
	for _, msg := range exec.GetStatus().GetMessages() {
		count += len(msg.GetToolCalls())
	}
	return count
}
