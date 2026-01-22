package examples_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"google.golang.org/protobuf/proto"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
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

// Note: Examples 08, 09, 10, 11, and 18 are in _pending_api_implementation/
// They require high-level APIs (Switch, ForEach, Try, Fork, Interpolate) to be implemented.
// See _pending_api_implementation/README.md for details.

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
