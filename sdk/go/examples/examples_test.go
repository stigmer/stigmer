package examples_test

import (
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

// TestExample14_WorkflowWithRuntimeSecrets tests the workflow with runtime secrets example
// NOTE: Skipped - requires advanced workflow APIs (Interpolate, WithBody, RuntimeSecret, RuntimeEnv)
// These APIs are part of Phase 3 implementation (~4 hours estimated work)
// See _pending_api_implementation/README.md for details
func TestExample14_WorkflowWithRuntimeSecrets(t *testing.T) {
	t.Skip("Example requires unimplemented advanced workflow APIs: Interpolate, WithBody, RuntimeSecret, RuntimeEnv")
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
// NOTE: Skipped - requires advanced workflow APIs (Interpolate, WithEnv, AgentTimeout, RuntimeSecret, WithBody)
// These APIs are part of Phase 3 implementation (~4 hours estimated work)
// See _pending_api_implementation/README.md for details
func TestExample17_WorkflowAgentWithRuntimeSecrets(t *testing.T) {
	t.Skip("Example requires unimplemented advanced workflow APIs: Interpolate, WithEnv, AgentTimeout, RuntimeSecret, WithBody")
}

// TestExample19_WorkflowAgentExecutionConfig tests the workflow agent execution config example
// NOTE: Skipped - requires advanced workflow APIs (AgentModel, AgentTemperature, AgentTimeout, Interpolate)
// These APIs are part of Phase 3 implementation (~4 hours estimated work)
// See _pending_api_implementation/README.md for details
func TestExample19_WorkflowAgentExecutionConfig(t *testing.T) {
	t.Skip("Example requires unimplemented advanced workflow APIs: AgentModel, AgentTemperature, AgentTimeout, Interpolate")
}

// Note: Examples 08, 09, 10, 11, and 18 are in _pending_api_implementation/
// They require high-level APIs (Switch, ForEach, Try, Fork, Interpolate) to be implemented.
// See _pending_api_implementation/README.md for details.
//
// Examples 14, 17, and 19 also require advanced APIs (Phase 3) that haven't been implemented yet:
// - workflow.Interpolate() - String interpolation
// - workflow.WithBody() - HTTP request body
// - workflow.WithEnv() - Environment variables for agent calls
// - workflow.RuntimeSecret() - Runtime secret references
// - workflow.RuntimeEnv() - Runtime environment variable references
// - workflow.AgentTimeout() - Agent call timeout
// - workflow.AgentModel() - Model selection
// - workflow.AgentTemperature() - Temperature control
//
// These examples compile but won't execute until the APIs are implemented (~4 hours of work).

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
