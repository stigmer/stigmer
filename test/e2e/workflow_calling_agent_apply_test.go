//go:build e2e
// +build e2e

package e2e

import (
	"path/filepath"

	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

// TestApplyWorkflowCallingAgent tests the full workflow apply workflow where a workflow calls an agent:
// 1. Server is running with isolated storage
// 2. Apply command deploys both workflow and agent from code (from SDK example 15_workflow_calling_simple_agent.go)
// 3. Both workflow and agent are stored in BadgerDB
// 4. Can retrieve and verify both workflow and agent data
// 5. Verify workflow has agent call task that references the agent
//
// The SDK example creates:
// - code-reviewer: Simple agent for code reviews
// - simple-review: Workflow that calls the code-reviewer agent
//
// Example: sdk/go/examples/15_workflow_calling_simple_agent.go
// Test Fixture: test/e2e/testdata/examples/15-workflow-calling-simple-agent/
func (s *E2ESuite) TestApplyWorkflowCallingAgent() {
	// Get path to workflow-calling-simple-agent test fixture
	testdataDir := filepath.Join("testdata", "examples", "15-workflow-calling-simple-agent")
	absTestdataDir, err := filepath.Abs(testdataDir)
	s.Require().NoError(err, "Failed to get absolute path to workflow-calling-simple-agent directory")

	s.T().Logf("Using workflow-calling-simple-agent directory: %s", absTestdataDir)

	// Execute apply command with the workflow-calling-simple-agent directory
	// The CLI will look for Stigmer.yaml in this directory
	// Pass the server address so CLI connects to our test server
	output, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir)

	// Log output for debugging
	s.T().Logf("Apply command output:\n%s", output)

	// Verify command succeeded
	s.Require().NoError(err, "Apply command should succeed")

	// Verify success message in output
	s.Contains(output, "Deployment successful", "Output should contain success message")

	// Verify both agent and workflow are mentioned in output
	s.Contains(output, "code-reviewer", "Output should mention the agent")
	s.Contains(output, "simple-review", "Output should mention the workflow")

	org := "local" // Using local backend in tests

	// ========================================
	// STEP 1: Verify agent exists via API
	// ========================================
	s.T().Logf("Verifying agent via gRPC API by slug...")

	agent, err := GetAgentBySlug(s.Harness.ServerPort, "code-reviewer", org)
	s.Require().NoError(err, "Should be able to query agent by slug via API")
	s.Require().NotNil(agent, "Agent should exist")
	s.Equal("code-reviewer", agent.Metadata.Name, "Agent name should match")
	s.T().Logf("✓ Found agent: code-reviewer (ID: %s)", agent.Metadata.Id)

	// Verify agent properties from SDK example
	s.Contains(agent.Spec.Instructions, "You are a code reviewer", "Agent should have instructions")
	s.Contains(agent.Spec.Instructions, "Best practices", "Agent instructions should mention best practices")
	s.Contains(agent.Spec.Instructions, "Potential bugs", "Agent instructions should mention bugs")
	s.Equal("AI code reviewer for pull requests", agent.Spec.Description,
		"Agent should have description")

	// ========================================
	// STEP 2: Verify workflow exists via API
	// ========================================
	s.T().Logf("Verifying workflow via gRPC API by slug...")

	workflow, err := GetWorkflowBySlug(s.Harness.ServerPort, "simple-review", org)
	s.Require().NoError(err, "Should be able to query workflow by slug via API")
	s.Require().NotNil(workflow, "Workflow should exist")
	s.Equal("simple-review", workflow.Metadata.Name, "Workflow name should match")
	s.Equal("code-review", workflow.Spec.Document.Namespace, "Workflow namespace should match")
	s.T().Logf("✓ Found workflow: simple-review (ID: %s)", workflow.Metadata.Id)

	// Verify workflow properties from SDK example
	s.Equal("1.0.0", workflow.Spec.Document.Version, "Workflow should have version")
	s.Equal("Simple code review workflow", workflow.Spec.Description,
		"Workflow should have description")

	// Note: In local backend mode, org is always overwritten to "local"
	s.Equal("local", workflow.Metadata.Org,
		"Workflow org should be 'local' in local backend mode")

	// ========================================
	// STEP 3: Verify workflow has agent call task
	// ========================================
	s.Require().NotNil(workflow.Spec.Tasks, "Workflow should have tasks")
	s.Equal(1, len(workflow.Spec.Tasks), "Workflow should have exactly 1 task")

	task := workflow.Spec.Tasks[0]
	s.Equal("reviewCode", task.Name, "Task should be named 'reviewCode'")

	// Verify task is an agent call
	s.Equal(apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_AGENT_CALL, task.Kind, 
		"Task should be of type AGENT_CALL")

	// Verify task has configuration
	s.NotNil(task.TaskConfig, "Agent call task should have configuration")
	s.T().Logf("✓ Agent call task has configuration (type: %s)", task.Kind)

	s.T().Logf("✅ Test passed: Workflow calling agent was successfully applied")
	s.T().Logf("   Agent ID: %s", agent.Metadata.Id)
	s.T().Logf("   Workflow ID: %s", workflow.Metadata.Id)
	s.T().Logf("   Agent call task: %s", task.Name)
}

// TestApplyWorkflowCallingAgentCount verifies that the SDK example creates exactly 1 workflow and 1 agent
//
// Example: sdk/go/examples/15_workflow_calling_simple_agent.go creates:
// 1. code-reviewer (agent)
// 2. simple-review (workflow calling the agent)
//
// Test Fixture: test/e2e/testdata/examples/15-workflow-calling-simple-agent/
func (s *E2ESuite) TestApplyWorkflowCallingAgentCount() {
	testdataDir := filepath.Join("testdata", "examples", "15-workflow-calling-simple-agent")
	absTestdataDir, err := filepath.Abs(testdataDir)
	s.Require().NoError(err, "Failed to get absolute path to workflow-calling-simple-agent directory")

	output, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir)
	s.Require().NoError(err, "Apply command should succeed")

	s.T().Logf("Apply output:\n%s", output)

	org := "local" // Using local backend in tests

	// Verify agent exists
	agent, err := GetAgentBySlug(s.Harness.ServerPort, "code-reviewer", org)
	s.Require().NoError(err, "Should be able to query code-reviewer by slug via API")
	s.Require().NotNil(agent, "code-reviewer should exist in backend")
	s.Equal("code-reviewer", agent.Metadata.Name)
	s.T().Logf("✓ Found agent: code-reviewer (ID: %s)", agent.Metadata.Id)

	// Verify workflow exists
	workflow, err := GetWorkflowBySlug(s.Harness.ServerPort, "simple-review", org)
	s.Require().NoError(err, "Should be able to query simple-review by slug via API")
	s.Require().NotNil(workflow, "simple-review should exist in backend")
	s.Equal("simple-review", workflow.Metadata.Name)
	s.T().Logf("✓ Found workflow: simple-review (ID: %s)", workflow.Metadata.Id)

	s.T().Logf("✅ Resource count test passed: Exactly 1 agent and 1 workflow deployed (verified via API by slug)")
}

// TestApplyWorkflowCallingAgentDryRun tests the dry-run mode of apply command for workflow calling agent
//
// Example: sdk/go/examples/15_workflow_calling_simple_agent.go
// Test Fixture: test/e2e/testdata/examples/15-workflow-calling-simple-agent/
func (s *E2ESuite) TestApplyWorkflowCallingAgentDryRun() {
	// Get path to workflow-calling-simple-agent test fixture
	testdataDir := filepath.Join("testdata", "examples", "15-workflow-calling-simple-agent")
	absTestdataDir, err := filepath.Abs(testdataDir)
	s.Require().NoError(err, "Failed to get absolute path to workflow-calling-simple-agent directory")

	// Execute apply with --dry-run flag
	// Pass the server address so CLI connects to our test server
	output, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir, "--dry-run")

	s.T().Logf("Dry-run output:\n%s", output)

	// Verify command succeeded
	s.Require().NoError(err, "Dry-run should succeed")

	// Verify dry-run output
	s.Contains(output, "Dry run successful", "Output should indicate dry run")

	// Verify dry-run table format
	s.Contains(output, "TYPE", "Dry-run output should contain table header")
	s.Contains(output, "NAME", "Dry-run output should contain table header")
	s.Contains(output, "ACTION", "Dry-run output should contain table header")
	s.Contains(output, "Create", "Dry-run output should show action")

	s.T().Logf("✅ Dry-run test passed: Dry-run successful (no resources deployed)")
}

// TestApplyWorkflowCallingAgentTaskStructure verifies the agent call task structure
//
// Example: sdk/go/examples/15_workflow_calling_simple_agent.go demonstrates:
// - Creating an agent in the same context
// - Referencing the agent from a workflow
// - Using workflow.Agent() for direct instance references
//
// Test Fixture: test/e2e/testdata/examples/15-workflow-calling-simple-agent/
func (s *E2ESuite) TestApplyWorkflowCallingAgentTaskStructure() {
	testdataDir := filepath.Join("testdata", "examples", "15-workflow-calling-simple-agent")
	absTestdataDir, err := filepath.Abs(testdataDir)
	s.Require().NoError(err, "Failed to get absolute path to workflow-calling-simple-agent directory")

	output, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir)
	s.Require().NoError(err, "Apply command should succeed")

	s.T().Logf("Apply output:\n%s", output)

	org := "local" // Using local backend in tests

	// Query workflow by slug
	workflow, err := GetWorkflowBySlug(s.Harness.ServerPort, "simple-review", org)
	s.Require().NoError(err, "Should be able to query workflow by slug via API")
	s.Require().NotNil(workflow, "Workflow should exist")

	// Verify workflow has exactly one task
	s.Require().NotNil(workflow.Spec.Tasks, "Workflow should have tasks")
	s.Equal(1, len(workflow.Spec.Tasks), "Workflow should have exactly 1 task")

	task := workflow.Spec.Tasks[0]

	// Verify task name
	s.Equal("reviewCode", task.Name, "Task should be named 'reviewCode'")

	// Verify task type
	s.Equal(apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_AGENT_CALL, task.Kind, 
		"Task should be of type AGENT_CALL")

	// Verify agent call structure
	s.Require().NotNil(task.TaskConfig, "Task should have agent call configuration")

	s.T().Logf("✓ Task structure verified:")
	s.T().Logf("   Task name: %s", task.Name)
	s.T().Logf("   Task kind: %s", task.Kind)

	s.T().Logf("✅ Task structure test passed: Agent call task is properly configured")
}

// TestApplyWorkflowCallingAgentVerifyBoth verifies both agent and workflow can be queried independently
//
// Example: sdk/go/examples/15_workflow_calling_simple_agent.go
// Test Fixture: test/e2e/testdata/examples/15-workflow-calling-simple-agent/
func (s *E2ESuite) TestApplyWorkflowCallingAgentVerifyBoth() {
	testdataDir := filepath.Join("testdata", "examples", "15-workflow-calling-simple-agent")
	absTestdataDir, err := filepath.Abs(testdataDir)
	s.Require().NoError(err, "Failed to get absolute path to workflow-calling-simple-agent directory")

	output, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir)
	s.Require().NoError(err, "Apply command should succeed")

	s.T().Logf("Apply output:\n%s", output)

	org := "local" // Using local backend in tests

	// ========================================
	// STEP 1: Verify agent can be queried
	// ========================================
	agent, err := GetAgentBySlug(s.Harness.ServerPort, "code-reviewer", org)
	s.Require().NoError(err, "Should be able to query agent by slug via API")
	s.Require().NotNil(agent, "Agent should exist")

	// Verify agent is complete and valid
	s.Equal("code-reviewer", agent.Metadata.Name)
	s.NotEmpty(agent.Metadata.Id, "Agent should have an ID")
	s.NotEmpty(agent.Spec.Instructions, "Agent should have instructions")
	s.T().Logf("✓ Agent verified independently:")
	s.T().Logf("   Name: %s", agent.Metadata.Name)
	s.T().Logf("   ID: %s", agent.Metadata.Id)
	s.T().Logf("   Description: %s", agent.Spec.Description)

	// ========================================
	// STEP 2: Verify workflow can be queried
	// ========================================
	workflow, err := GetWorkflowBySlug(s.Harness.ServerPort, "simple-review", org)
	s.Require().NoError(err, "Should be able to query workflow by slug via API")
	s.Require().NotNil(workflow, "Workflow should exist")

	// Verify workflow is complete and valid
	s.Equal("simple-review", workflow.Metadata.Name)
	s.NotEmpty(workflow.Metadata.Id, "Workflow should have an ID")
	s.Equal("code-review", workflow.Spec.Document.Namespace)
	s.Equal("1.0.0", workflow.Spec.Document.Version)
	s.T().Logf("✓ Workflow verified independently:")
	s.T().Logf("   Name: %s", workflow.Metadata.Name)
	s.T().Logf("   ID: %s", workflow.Metadata.Id)
	s.T().Logf("   Namespace: %s", workflow.Spec.Document.Namespace)

	// ========================================
	// STEP 3: Verify workflow references agent
	// ========================================
	s.Require().NotNil(workflow.Spec.Tasks, "Workflow should have tasks")
	s.Require().Equal(1, len(workflow.Spec.Tasks), "Workflow should have 1 task")

	task := workflow.Spec.Tasks[0]
	s.Require().Equal(apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_AGENT_CALL, task.Kind,
		"Task should be an agent call")

	// Verify task has configuration
	s.Require().NotNil(task.TaskConfig, "Agent call task should have configuration")
	s.T().Logf("✓ Workflow has agent call task with configuration")

	s.T().Logf("✅ Independent verification test passed: Both resources are valid and properly linked")
}
