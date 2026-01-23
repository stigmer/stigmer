package examples_test

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"google.golang.org/protobuf/proto"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

// TestExample01_BasicAgent tests the basic agent example
func TestExample01_BasicAgent(t *testing.T) {
	runExampleTest(t, "01_basic_agent.go", func(t *testing.T, outputDir string) {
		// Verify agent files were created (agent-0.pb, agent-1.pb)
		agent0Path := filepath.Join(outputDir, "agent-0.pb")
		agent1Path := filepath.Join(outputDir, "agent-1.pb")
		assertFileExists(t, agent0Path)
		assertFileExists(t, agent1Path)

		// Read first agent
		var agent0 agentv1.Agent
		readProto(t, agent0Path, &agent0)

		if agent0.Metadata.Name != "code-reviewer" {
			t.Errorf("First agent name = %v, want code-reviewer", agent0.Metadata.Name)
		}
		if agent0.Spec.Instructions == "" {
			t.Error("First agent instructions should not be empty")
		}

		// Read second agent
		var agent1 agentv1.Agent
		readProto(t, agent1Path, &agent1)

		if agent1.Metadata.Name != "code-reviewer-pro" {
			t.Errorf("Second agent name = %v, want code-reviewer-pro", agent1.Metadata.Name)
		}
		if agent1.Spec.Description == "" {
			t.Error("Second agent should have description")
		}
		if agent1.Spec.IconUrl == "" {
			t.Error("Second agent should have icon URL")
		}
	})
}

// TestExample02_AgentWithSkills tests the agent with skills example
func TestExample02_AgentWithSkills(t *testing.T) {
	runExampleTest(t, "02_agent_with_skills.go", func(t *testing.T, outputDir string) {
		// Multiple agents created - check if at least one exists
		agentPath := filepath.Join(outputDir, "agent-0.pb")
		assertFileExists(t, agentPath)

		var agent agentv1.Agent
		readProto(t, agentPath, &agent)

		if len(agent.Spec.SkillRefs) == 0 {
			t.Error("Agent should have skills")
		}
		
		t.Logf("✅ Agent with skills created: %s", agent.Metadata.Name)
	})
}

// TestExample07_BasicWorkflow tests the basic workflow example
func TestExample07_BasicWorkflow(t *testing.T) {
	runExampleTest(t, "07_basic_workflow.go", func(t *testing.T, outputDir string) {
		// Verify workflow-0.pb was created
		workflowPath := filepath.Join(outputDir, "workflow-0.pb")
		assertFileExists(t, workflowPath)

		var wf workflowv1.Workflow
		readProto(t, workflowPath, &wf)

		if wf.Spec == nil || wf.Spec.Document == nil {
			t.Fatal("Workflow spec or document is nil")
		}

		if wf.Spec.Document.Namespace != "data-processing" {
			t.Errorf("Workflow namespace = %v, want data-processing", wf.Spec.Document.Namespace)
		}
		if wf.Spec.Document.Name != "basic-data-fetch" {
			t.Errorf("Workflow name = %v, want basic-data-fetch", wf.Spec.Document.Name)
		}

		// Verify workflow has tasks
		if len(wf.Spec.Tasks) == 0 {
			t.Error("Workflow should have tasks")
		}

		t.Logf("✅ Basic workflow created with %d tasks", len(wf.Spec.Tasks))
	})
}

// TestExample12_AgentWithTypedContext tests the agent with typed context example
func TestExample12_AgentWithTypedContext(t *testing.T) {
	runExampleTest(t, "12_agent_with_typed_context.go", func(t *testing.T, outputDir string) {
		agentPath := filepath.Join(outputDir, "agent-0.pb")
		assertFileExists(t, agentPath)

		var agent agentv1.Agent
		readProto(t, agentPath, &agent)

		if agent.Metadata.Name != "code-reviewer" {
			t.Errorf("Agent name = %v, want code-reviewer", agent.Metadata.Name)
		}

		// Verify agent has description (uses typed context variable)
		if agent.Spec.Description == "" {
			t.Error("Agent should have description from typed context")
		}

		// This example demonstrates typed context with agent
		if agent.Spec.Instructions == "" {
			t.Error("Agent should have instructions")
		}

		// Verify agent has skills
		if len(agent.Spec.SkillRefs) == 0 {
			t.Error("Agent should have skills")
		}

		// Verify agent has MCP servers
		if len(agent.Spec.McpServers) == 0 {
			t.Error("Agent should have MCP servers")
		}
	})
}

// TestExample13_WorkflowAndAgentSharedContext tests the workflow and agent with shared context example
func TestExample13_WorkflowAndAgentSharedContext(t *testing.T) {
	runExampleTest(t, "13_workflow_and_agent_shared_context.go", func(t *testing.T, outputDir string) {
		// This example creates BOTH workflow and agent
		workflowPath := filepath.Join(outputDir, "workflow-0.pb")
		agentPath := filepath.Join(outputDir, "agent-0.pb")

		// Verify both were created
		assertFileExists(t, workflowPath)
		assertFileExists(t, agentPath)

		// Validate workflow
		var wf workflowv1.Workflow
		readProto(t, workflowPath, &wf)

		if wf.Spec.Document.Name != "fetch-and-analyze" {
			t.Errorf("Workflow name = %v, want fetch-and-analyze", wf.Spec.Document.Name)
		}

		// Validate agent
		var agent agentv1.Agent
		readProto(t, agentPath, &agent)

		if agent.Metadata.Name != "data-analyzer" {
			t.Errorf("Agent name = %v, want data-analyzer", agent.Metadata.Name)
		}

		// Verify both use shared context
		if len(wf.Spec.Tasks) == 0 {
			t.Error("Workflow should have tasks using shared context variables")
		}

		if agent.Spec.Instructions == "" {
			t.Error("Agent should have instructions")
		}

		t.Log("✅ Workflow and agent created with shared context")
	})
}

// TestExample03_AgentWithMCPServers tests the agent with MCP servers example
func TestExample03_AgentWithMCPServers(t *testing.T) {
	runExampleTest(t, "03_agent_with_mcp_servers.go", func(t *testing.T, outputDir string) {
		agentPath := filepath.Join(outputDir, "agent-0.pb")
		assertFileExists(t, agentPath)

		var agent agentv1.Agent
		readProto(t, agentPath, &agent)

		if agent.Metadata.Name != "devops-agent" {
			t.Errorf("Agent name = %v, want devops-agent", agent.Metadata.Name)
		}

		// Verify MCP servers were configured
		if len(agent.Spec.McpServers) == 0 {
			t.Error("Agent should have MCP servers")
		}

		// Check for different MCP server types (stdio, http, docker)
		hasStdio := false
		hasHTTP := false
		hasDocker := false
		
		for _, server := range agent.Spec.McpServers {
			switch {
			case server.GetStdio() != nil:
				hasStdio = true
			case server.GetHttp() != nil:
				hasHTTP = true
			case server.GetDocker() != nil:
				hasDocker = true
			}
		}

		if !hasStdio {
			t.Error("Agent should have at least one stdio MCP server")
		}
		if !hasHTTP {
			t.Error("Agent should have at least one HTTP MCP server")
		}
		if !hasDocker {
			t.Error("Agent should have at least one Docker MCP server")
		}

		t.Logf("✅ Agent with %d MCP servers created (stdio: %v, http: %v, docker: %v)", 
			len(agent.Spec.McpServers), hasStdio, hasHTTP, hasDocker)
	})
}

// TestExample04_AgentWithSubAgents tests the agent with sub-agents example
func TestExample04_AgentWithSubAgents(t *testing.T) {
	runExampleTest(t, "04_agent_with_subagents.go", func(t *testing.T, outputDir string) {
		// This example creates multiple agents - check if at least one exists
		agentPath := filepath.Join(outputDir, "agent-0.pb")
		assertFileExists(t, agentPath)

		var agent agentv1.Agent
		readProto(t, agentPath, &agent)

		// Verify agent has sub-agents configured
		if len(agent.Spec.SubAgents) == 0 {
			t.Error("Agent should have sub-agents")
		}

		// Check for both inline and referenced sub-agents
		hasInline := false
		hasReferenced := false
		
		for _, subAgent := range agent.Spec.SubAgents {
			switch subAgent.AgentReference.(type) {
			case *agentv1.SubAgent_InlineSpec:
				hasInline = true
			case *agentv1.SubAgent_AgentInstanceRefs:
				hasReferenced = true
			}
		}

		t.Logf("✅ Agent with %d sub-agents created (inline: %v, referenced: %v)", 
			len(agent.Spec.SubAgents), hasInline, hasReferenced)
	})
}

// TestExample05_AgentWithEnvironmentVariables tests the agent with environment variables example
func TestExample05_AgentWithEnvironmentVariables(t *testing.T) {
	runExampleTest(t, "05_agent_with_environment_variables.go", func(t *testing.T, outputDir string) {
		agentPath := filepath.Join(outputDir, "agent-0.pb")
		assertFileExists(t, agentPath)

		var agent agentv1.Agent
		readProto(t, agentPath, &agent)

		if agent.Metadata.Name != "cloud-deployer" {
			t.Errorf("Agent name = %v, want cloud-deployer", agent.Metadata.Name)
		}

		// Verify environment variables were configured
		if agent.Spec.EnvSpec == nil {
			t.Fatal("Agent should have environment configuration")
		}

		envData := agent.Spec.EnvSpec.Data
		if len(envData) == 0 {
			t.Error("Agent should have environment variables")
		}

		// Check for different types of environment variables
		hasSecret := false
		hasValue := false

		for _, envValue := range envData {
			if envValue.IsSecret {
				hasSecret = true
			}
			if envValue.Value != "" {
				hasValue = true
			}
		}

		if !hasSecret {
			t.Error("Agent should have at least one secret environment variable")
		}

		t.Logf("✅ Agent with %d environment variables created (secrets: %v, has values: %v)", 
			len(envData), hasSecret, hasValue)
	})
}

// TestExample06_AgentWithInstructionsFromFiles tests the agent with instructions from files example
func TestExample06_AgentWithInstructionsFromFiles(t *testing.T) {
	runExampleTest(t, "06_agent_with_instructions_from_files.go", func(t *testing.T, outputDir string) {
		// This example creates multiple agents - check if at least one exists
		agentPath := filepath.Join(outputDir, "agent-0.pb")
		assertFileExists(t, agentPath)

		var agent agentv1.Agent
		readProto(t, agentPath, &agent)

		// Verify instructions were loaded from file
		if agent.Spec.Instructions == "" {
			t.Error("Agent should have instructions loaded from file")
		}

		// Instructions should be non-trivial (file content, not just empty string)
		if len(agent.Spec.Instructions) < 100 {
			t.Errorf("Agent instructions seem too short (%d chars), may not have loaded from file correctly", 
				len(agent.Spec.Instructions))
		}

		t.Logf("✅ Agent with instructions from file created (%d chars loaded)", 
			len(agent.Spec.Instructions))
	})
}

// TestExample08_WorkflowWithConditionals tests the workflow with conditionals example
func TestExample08_WorkflowWithConditionals(t *testing.T) {
	runExampleTest(t, "08_workflow_with_conditionals.go", func(t *testing.T, outputDir string) {
		workflowPath := filepath.Join(outputDir, "workflow-0.pb")
		assertFileExists(t, workflowPath)

		var wf workflowv1.Workflow
		readProto(t, workflowPath, &wf)

		if wf.Spec.Document.Name != "conditional-deployment" {
			t.Errorf("Workflow name = %v, want conditional-deployment", wf.Spec.Document.Name)
		}

		// Verify workflow has switch task
		hasSwitch := false
		for _, task := range wf.Spec.Tasks {
			if task.Kind == apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_SWITCH {
				hasSwitch = true
				break
			}
		}

		if !hasSwitch {
			t.Error("Workflow should have switch task for conditional logic")
		}

		t.Logf("✅ Workflow with conditionals created with %d tasks", len(wf.Spec.Tasks))
	})
}

// TestExample09_WorkflowWithLoops tests the workflow with loops example
func TestExample09_WorkflowWithLoops(t *testing.T) {
	runExampleTest(t, "09_workflow_with_loops.go", func(t *testing.T, outputDir string) {
		workflowPath := filepath.Join(outputDir, "workflow-0.pb")
		assertFileExists(t, workflowPath)

		var wf workflowv1.Workflow
		readProto(t, workflowPath, &wf)

		if wf.Spec.Document.Name != "batch-processor" {
			t.Errorf("Workflow name = %v, want batch-processor", wf.Spec.Document.Name)
		}

		// Verify workflow has for task
		hasFor := false
		for _, task := range wf.Spec.Tasks {
			if task.Kind == apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_FOR {
				hasFor = true
				break
			}
		}

		if !hasFor {
			t.Error("Workflow should have for task for loops")
		}

		t.Logf("✅ Workflow with loops created with %d tasks", len(wf.Spec.Tasks))
	})
}

// TestExample10_WorkflowWithErrorHandling tests the workflow with error handling example
func TestExample10_WorkflowWithErrorHandling(t *testing.T) {
	runExampleTest(t, "10_workflow_with_error_handling.go", func(t *testing.T, outputDir string) {
		workflowPath := filepath.Join(outputDir, "workflow-0.pb")
		assertFileExists(t, workflowPath)

		var wf workflowv1.Workflow
		readProto(t, workflowPath, &wf)

		if wf.Spec.Document.Name != "resilient-api-call" {
			t.Errorf("Workflow name = %v, want resilient-api-call", wf.Spec.Document.Name)
		}

		// Verify workflow has try task
		hasTry := false
		for _, task := range wf.Spec.Tasks {
			if task.Kind == apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_TRY {
				hasTry = true
				break
			}
		}

		if !hasTry {
			t.Error("Workflow should have try task for error handling")
		}

		t.Logf("✅ Workflow with error handling created with %d tasks", len(wf.Spec.Tasks))
	})
}

// TestExample11_WorkflowWithParallelExecution tests the workflow with parallel execution example
func TestExample11_WorkflowWithParallelExecution(t *testing.T) {
	runExampleTest(t, "11_workflow_with_parallel_execution.go", func(t *testing.T, outputDir string) {
		workflowPath := filepath.Join(outputDir, "workflow-0.pb")
		assertFileExists(t, workflowPath)

		var wf workflowv1.Workflow
		readProto(t, workflowPath, &wf)

		if wf.Spec.Document.Name != "parallel-data-fetch" {
			t.Errorf("Workflow name = %v, want parallel-data-fetch", wf.Spec.Document.Name)
		}

		// Verify workflow has fork task
		hasFork := false
		for _, task := range wf.Spec.Tasks {
			if task.Kind == apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_FORK {
				hasFork = true
				break
			}
		}

		if !hasFork {
			t.Error("Workflow should have fork task for parallel execution")
		}

		t.Logf("✅ Workflow with parallel execution created with %d tasks", len(wf.Spec.Tasks))
	})
}

// TestExample14_WorkflowWithRuntimeSecrets tests the workflow with runtime secrets example
func TestExample14_WorkflowWithRuntimeSecrets(t *testing.T) {
	runExampleTest(t, "14_workflow_with_runtime_secrets.go", func(t *testing.T, outputDir string) {
		workflowPath := filepath.Join(outputDir, "workflow-0.pb")
		assertFileExists(t, workflowPath)

		var wf workflowv1.Workflow
		readProto(t, workflowPath, &wf)

		if wf.Spec.Document.Name != "secure-api-workflow" {
			t.Errorf("Workflow name = %v, want secure-api-workflow", wf.Spec.Document.Name)
		}

		// Verify workflow has tasks
		if len(wf.Spec.Tasks) == 0 {
			t.Error("Workflow should have tasks using runtime secrets")
		}

		t.Logf("✅ Workflow with runtime secrets created with %d tasks", len(wf.Spec.Tasks))
	})
}

// TestExample15_WorkflowCallingSimpleAgent tests the workflow calling simple agent example
func TestExample15_WorkflowCallingSimpleAgent(t *testing.T) {
	runExampleTest(t, "15_workflow_calling_simple_agent.go", func(t *testing.T, outputDir string) {
		// This example creates BOTH workflow and agent
		workflowPath := filepath.Join(outputDir, "workflow-0.pb")
		agentPath := filepath.Join(outputDir, "agent-0.pb")

		// Verify both were created
		assertFileExists(t, workflowPath)
		assertFileExists(t, agentPath)

		// Validate workflow
		var wf workflowv1.Workflow
		readProto(t, workflowPath, &wf)

		if wf.Spec.Document.Name != "simple-review" {
			t.Errorf("Workflow name = %v, want simple-review", wf.Spec.Document.Name)
		}

		// Validate agent
		var agent agentv1.Agent
		readProto(t, agentPath, &agent)

		if agent.Metadata.Name != "code-reviewer" {
			t.Errorf("Agent name = %v, want code-reviewer", agent.Metadata.Name)
		}

		// Verify workflow has agent call task
		hasAgentCall := false
		for _, task := range wf.Spec.Tasks {
			if task.Kind == apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_AGENT_CALL {
				hasAgentCall = true
				break
			}
		}

		if !hasAgentCall {
			t.Error("Workflow should have agent call task")
		}

		t.Log("✅ Workflow calling agent created successfully")
	})
}

// TestExample16_WorkflowCallingAgentBySlug tests the workflow calling agent by slug example
func TestExample16_WorkflowCallingAgentBySlug(t *testing.T) {
	runExampleTest(t, "16_workflow_calling_agent_by_slug.go", func(t *testing.T, outputDir string) {
		workflowPath := filepath.Join(outputDir, "workflow-0.pb")
		assertFileExists(t, workflowPath)

		var wf workflowv1.Workflow
		readProto(t, workflowPath, &wf)

		if wf.Spec.Document.Name != "review-by-slug" {
			t.Errorf("Workflow name = %v, want review-by-slug", wf.Spec.Document.Name)
		}

		// Verify workflow has agent call tasks
		agentCallCount := 0
		for _, task := range wf.Spec.Tasks {
			if task.Kind == apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_AGENT_CALL {
				agentCallCount++
			}
		}

		if agentCallCount == 0 {
			t.Error("Workflow should have agent call tasks")
		}

		t.Logf("✅ Workflow with %d agent slug references created", agentCallCount)
	})
}

// TestExample17_WorkflowAgentWithRuntimeSecrets tests the workflow agent with runtime secrets example
func TestExample17_WorkflowAgentWithRuntimeSecrets(t *testing.T) {
	runExampleTest(t, "17_workflow_agent_with_runtime_secrets.go", func(t *testing.T, outputDir string) {
		// This example creates a workflow that calls agents via slug references
		workflowPath := filepath.Join(outputDir, "workflow-0.pb")

		// Verify workflow was created
		assertFileExists(t, workflowPath)

		// Validate workflow
		var wf workflowv1.Workflow
		readProto(t, workflowPath, &wf)

		if wf.Spec.Document.Name != "github-pr-review" {
			t.Errorf("Workflow name = %v, want github-pr-review", wf.Spec.Document.Name)
		}

		// Verify workflow has agent call task (calling agent by slug)
		hasAgentCall := false
		for _, task := range wf.Spec.Tasks {
			if task.Kind == apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_AGENT_CALL {
				hasAgentCall = true
				break
			}
		}

		if !hasAgentCall {
			t.Error("Workflow should have agent call task with runtime secrets")
		}

		t.Log("✅ Workflow with agent runtime secrets created successfully")
	})
}

// TestExample18_WorkflowMultiAgentOrchestration tests the multi-agent orchestration example
func TestExample18_WorkflowMultiAgentOrchestration(t *testing.T) {
	runExampleTest(t, "18_workflow_multi_agent_orchestration.go", func(t *testing.T, outputDir string) {
		// This example creates 1 workflow and 5 agents
		workflowPath := filepath.Join(outputDir, "workflow-0.pb")
		assertFileExists(t, workflowPath)

		var wf workflowv1.Workflow
		readProto(t, workflowPath, &wf)

		if wf.Spec.Document.Name != "intelligent-deployment-pipeline" {
			t.Errorf("Workflow name = %v, want intelligent-deployment-pipeline", wf.Spec.Document.Name)
		}

		// Count agent call tasks (should have multiple)
		agentCallCount := 0
		for _, task := range wf.Spec.Tasks {
			if task.Kind == apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_AGENT_CALL {
				agentCallCount++
			}
		}

		if agentCallCount < 5 {
			t.Errorf("Workflow should have at least 5 agent calls, got %d", agentCallCount)
		}

		// Verify multiple agents were created
		for i := 0; i < 5; i++ {
			agentPath := filepath.Join(outputDir, fmt.Sprintf("agent-%d.pb", i))
			assertFileExists(t, agentPath)
		}

		t.Logf("✅ Multi-agent orchestration workflow created with %d agent calls", agentCallCount)
	})
}

// TestExample19_WorkflowAgentExecutionConfig tests the workflow agent execution config example
func TestExample19_WorkflowAgentExecutionConfig(t *testing.T) {
	runExampleTest(t, "19_workflow_agent_execution_config.go", func(t *testing.T, outputDir string) {
		// This example creates a workflow that calls agents with different execution configs
		workflowPath := filepath.Join(outputDir, "workflow-0.pb")

		// Verify workflow was created
		assertFileExists(t, workflowPath)

		// Validate workflow
		var wf workflowv1.Workflow
		readProto(t, workflowPath, &wf)

		if wf.Spec.Document.Name != "agent-config-demo" {
			t.Errorf("Workflow name = %v, want agent-config-demo", wf.Spec.Document.Name)
		}

		// Verify workflow has agent call tasks with execution config
		hasAgentCall := false
		for _, task := range wf.Spec.Tasks {
			if task.Kind == apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_AGENT_CALL {
				hasAgentCall = true
				break
			}
		}

		if !hasAgentCall {
			t.Error("Workflow should have agent call tasks with execution config")
		}

		t.Logf("✅ Workflow with %d agent execution configs created successfully", len(wf.Spec.Tasks))
	})
}

// Helper function to run an example and verify output
func runExampleTest(t *testing.T, exampleFile string, verify func(*testing.T, string)) {
	t.Helper()

	// Create temporary output directory
	outputDir := t.TempDir()

	// Get the path to the example file
	examplePath := filepath.Join(".", exampleFile)

	// Check if example file exists
	if _, err := os.Stat(examplePath); os.IsNotExist(err) {
		t.Fatalf("Example file not found: %s", examplePath)
	}

	// Run the example with STIGMER_OUT_DIR set
	cmd := exec.Command("go", "run", examplePath)
	cmd.Env = append(os.Environ(), "STIGMER_OUT_DIR="+outputDir)

	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("Failed to run example %s: %v\nOutput: %s", exampleFile, err, string(output))
	}

	t.Logf("Example %s output:\n%s", exampleFile, string(output))

	// Run verification function
	verify(t, outputDir)
}

// Helper function to assert a file exists
func assertFileExists(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); os.IsNotExist(err) {
		t.Fatalf("Expected file does not exist: %s", path)
	}
}

// Helper function to read and unmarshal a protobuf message
func readProto(t *testing.T, path string, message proto.Message) {
	t.Helper()

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("Failed to read proto file %s: %v", path, err)
	}

	if err := proto.Unmarshal(data, message); err != nil {
		t.Fatalf("Failed to unmarshal proto %s: %v", path, err)
	}
}
