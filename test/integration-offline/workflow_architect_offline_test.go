//go:build integration

package offline

import (
	"context"
	"strings"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func requireArchitectPrereqs(t *testing.T) {
	t.Helper()
	require.NotNil(t, testHarness.Service, "java service must be running")
	require.NotNil(t, grpcConn, "gRPC connection required")
	if mcpServerStigmerLaunch.Command == "" {
		t.Skip("mcp-server-stigmer launch not resolved — skipping workflow architect test")
	}
}

// sampleWorkflowYAML is the YAML the mock LLM "generates" for workflow tests.
// It's a valid Stigmer workflow that passes validation.
const sampleWorkflowYAML = `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: offline-generate-test
  org: test-org
spec:
  description: A simple two-task workflow for testing
  document:
    dsl: "1.0.0"
    namespace: test-org
    name: offline-generate-test
    version: "1.0.0"
  tasks:
    - name: setMessage
      kind: set_vars
      task_config:
        variables:
          message: "hello world"
      export:
        as: "${.}"
      flow:
        then: setStatus
    - name: setStatus
      kind: set_vars
      task_config:
        variables:
          status: "complete"
      export:
        as: "${.}"`

// refinedWorkflowYAML is the YAML the mock LLM produces on the refine turn.
const refinedWorkflowYAML = `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: offline-refine-test
  org: test-org
spec:
  description: A refined three-task workflow
  document:
    dsl: "1.0.0"
    namespace: test-org
    name: offline-refine-test
    version: "1.0.0"
  tasks:
    - name: setGreeting
      kind: set_vars
      task_config:
        variables:
          greeting: "hello"
      export:
        as: "${.}"
      flow:
        then: setFarewell
    - name: setFarewell
      kind: set_vars
      task_config:
        variables:
          farewell: "goodbye"
      export:
        as: "${.}"
      flow:
        then: setDone
    - name: setDone
      kind: set_vars
      task_config:
        variables:
          done: "true"
      export:
        as: "${.}"`

// TestOffline_WorkflowArchitect_Generate verifies the full generate flow:
// LLM calls get_task_kind_registry (real MCP tool), then produces YAML.
func TestOffline_WorkflowArchitect_Generate(t *testing.T) {
	requireArchitectPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	// Mock conversation:
	// Turn 1: LLM calls get_task_kind_registry to learn available task kinds
	// Turn 2: LLM produces YAML workflow after getting tool result
	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicToolUseResponse(
			"toolu_registry_01", "get_task_kind_registry", map[string]any{},
			500, 45,
		)),
		harness.BuildLLMEntry(1, harness.AnthropicTextResponse(
			"Based on the available task kinds, here is your workflow:\n\n```yaml\n"+sampleWorkflowYAML+"\n```\n\nThis workflow has two sequential set_vars tasks.",
			1200, 350,
		)),
	}

	mockLLM, mgr := startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	mcpServer := harness.CreateStigmerMcpServer(t, ctx, clients, mcpServerStigmerLaunch)

	agent := harness.CreateWorkflowArchitectAgent(t, ctx, clients,
		mcpServer.GetMetadata().GetSlug(), "offline-generate")

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err, "AddSession should succeed")

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID,
		"Create a simple workflow for organization 'test-org' with two tasks: "+
			"1) a set_vars task that sets a variable called 'message' to 'hello world', "+
			"2) a set_vars task that sets a variable called 'status' to 'complete'. "+
			"The first task should flow into the second.",
		harness.WithAutoApproveAll(true))

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 3*time.Minute)
	require.NoError(t, err, "workflow architect execution should complete")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	harness.AssertHasAnyToolCall(t, result,
		"get_task_kind_registry", "get_task_kind", "validate_workflow_yaml")

	yamlContent := harness.AssertHasYAMLBlock(t, result)
	require.NotEmpty(t, yamlContent, "agent must produce a YAML block")
	assert.Contains(t, yamlContent, "set_vars")

	assert.Equal(t, 0, mockLLM.Remaining(), "all mock LLM entries should be consumed")

	t.Logf("offline generate test passed: yaml_len=%d, messages=%d, tool_calls=%d",
		len(yamlContent), len(result.GetStatus().GetMessages()), countToolCalls(result))
}

// TestOffline_WorkflowArchitect_MCPToolAccess verifies that the agent can
// access the task kind registry via MCP tools.
func TestOffline_WorkflowArchitect_MCPToolAccess(t *testing.T) {
	requireArchitectPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicToolUseResponse(
			"toolu_registry_02", "get_task_kind_registry", map[string]any{},
			400, 35,
		)),
		harness.BuildLLMEntry(1, harness.AnthropicTextResponse(
			"I found the following task kinds in the registry:\n\n"+
				"1. **set_vars** - Sets variables in the workflow context\n"+
				"2. **http_call** - Makes HTTP requests\n"+
				"3. **llm_call** - Calls a language model\n"+
				"4. **eval** - Evaluates content with a judge\n"+
				"5. **agent_call** - Invokes another agent\n\n"+
				"There are 5 main task kinds available.",
			800, 120,
		)),
	}

	mockLLM, mgr := startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	mcpServer := harness.CreateStigmerMcpServer(t, ctx, clients, mcpServerStigmerLaunch)

	agent := harness.CreateWorkflowArchitectAgent(t, ctx, clients,
		mcpServer.GetMetadata().GetSlug(), "offline-mcp-access")

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err, "AddSession should succeed")

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID,
		"List all available task kinds for Stigmer workflows. "+
			"Use the get_task_kind_registry tool and tell me how many task kinds exist.",
		harness.WithAutoApproveAll(true))

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 3*time.Minute)
	require.NoError(t, err, "MCP tool access execution should complete")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	harness.AssertHasToolCall(t, result, "get_task_kind_registry")

	assert.Equal(t, 0, mockLLM.Remaining())

	t.Logf("offline MCP tool access test passed: messages=%d, tool_calls=%d",
		len(result.GetStatus().GetMessages()), countToolCalls(result))
}

// TestOffline_WorkflowArchitect_GenerateWithValidation verifies the generate
// flow where the LLM also calls validate_workflow_yaml before returning.
func TestOffline_WorkflowArchitect_GenerateWithValidation(t *testing.T) {
	requireArchitectPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	// Turn 1: LLM calls get_task_kind_registry
	// Turn 2: LLM produces YAML and calls validate_workflow_yaml
	// Turn 3: LLM responds with confirmed YAML after validation passes
	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicToolUseResponse(
			"toolu_reg_03", "get_task_kind_registry", map[string]any{},
			500, 40,
		)),
		harness.BuildLLMEntry(1, harness.AnthropicToolUseResponse(
			"toolu_val_01", "validate_workflow_yaml", map[string]any{
				"yaml_content": sampleWorkflowYAML,
			},
			1000, 80,
		)),
		harness.BuildLLMEntry(2, harness.AnthropicTextResponse(
			"The workflow passed validation. Here is your final workflow:\n\n```yaml\n"+sampleWorkflowYAML+"\n```\n\nBoth tasks are correctly configured.",
			1500, 300,
		)),
	}

	mockLLM, mgr := startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	mcpServer := harness.CreateStigmerMcpServer(t, ctx, clients, mcpServerStigmerLaunch)

	agent := harness.CreateWorkflowArchitectAgent(t, ctx, clients,
		mcpServer.GetMetadata().GetSlug(), "offline-gen-validate")

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err, "AddSession should succeed")

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID,
		"Create a simple workflow and validate it before returning.",
		harness.WithAutoApproveAll(true))

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 3*time.Minute)
	require.NoError(t, err, "execution should complete")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	harness.AssertHasAnyToolCall(t, result,
		"get_task_kind_registry", "validate_workflow_yaml")

	yamlContent := harness.AssertHasYAMLBlock(t, result)
	require.NotEmpty(t, yamlContent)

	t.Logf("offline generate+validate test passed: yaml_len=%d, tool_calls=%d, mock_remaining=%d",
		len(yamlContent), countToolCalls(result), mockLLM.Remaining())
}

// TestOffline_WorkflowArchitect_Refine tests multi-turn refinement using
// two executions in the same session. The mock provides different YAML
// for each turn.
func TestOffline_WorkflowArchitect_Refine(t *testing.T) {
	requireArchitectPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	// Responses for both turns in sequence. The runner manager handles
	// session-based routing, so both executions hit the same mock.
	entries := []harness.RecordedLLMEntry{
		// Turn 1: Generate initial workflow
		harness.BuildLLMEntry(0, harness.AnthropicToolUseResponse(
			"toolu_ref_reg", "get_task_kind_registry", map[string]any{},
			400, 35,
		)),
		harness.BuildLLMEntry(1, harness.AnthropicTextResponse(
			"Here is your initial workflow:\n\n```yaml\n"+sampleWorkflowYAML+"\n```",
			900, 250,
		)),
		// Turn 2: Refine with additional task
		harness.BuildLLMEntry(2, harness.AnthropicTextResponse(
			"I've added a third task. Here is the refined workflow:\n\n```yaml\n"+refinedWorkflowYAML+"\n```",
			1100, 350,
		)),
	}

	mockLLM, mgr := startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	mcpServer := harness.CreateStigmerMcpServer(t, ctx, clients, mcpServerStigmerLaunch)

	agent := harness.CreateWorkflowArchitectAgent(t, ctx, clients,
		mcpServer.GetMetadata().GetSlug(), "offline-refine")

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err, "AddSession should succeed")

	// Turn 1: Generate
	exec1 := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID,
		"Create a workflow with a set_vars task that sets variable 'greeting' to 'hello'.",
		harness.WithAutoApproveAll(true))

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result1, err := waiter.WaitForPhase(ctx, exec1.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 3*time.Minute)
	require.NoError(t, err, "first execution (generate) should complete")

	originalYAML := harness.ExtractWorkflowYAML(result1)
	require.NotEmpty(t, originalYAML, "first execution must produce YAML")

	// Turn 2: Refine in the same session
	exec2 := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID,
		"Add a second set_vars task for 'farewell' = 'goodbye' and a third for 'done' = 'true'.",
		harness.WithAutoApproveAll(true))

	result2, err := waiter.WaitForPhase(ctx, exec2.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 3*time.Minute)
	require.NoError(t, err, "second execution (refine) should complete")

	refinedYAML := harness.ExtractWorkflowYAML(result2)
	require.NotEmpty(t, refinedYAML, "second execution must produce YAML")

	assert.NotEqual(t, originalYAML, refinedYAML,
		"refined YAML should differ from the original")

	// Verify the refined YAML has more tasks
	assert.True(t, len(refinedYAML) > len(originalYAML),
		"refined YAML should be longer (more tasks)")
	assert.True(t, strings.Contains(refinedYAML, "farewell"),
		"refined YAML should contain the new 'farewell' variable")

	assert.Equal(t, 0, mockLLM.Remaining())

	t.Logf("offline refine test passed: original_yaml=%d, refined_yaml=%d",
		len(originalYAML), len(refinedYAML))
}
