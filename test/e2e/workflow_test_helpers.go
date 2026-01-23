//go:build e2e
// +build e2e

package e2e

import (
	"path/filepath"
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stretchr/testify/require"
)

// WorkflowApplyResult contains the result of applying a workflow
type WorkflowApplyResult struct {
	Workflow *workflowv1.Workflow
	Output   string
}

// ApplyBasicWorkflow applies the basic workflow from SDK example 07_basic_workflow.go
// Returns the deployed workflow and CLI output
func ApplyBasicWorkflow(t *testing.T, serverPort int) *WorkflowApplyResult {
	// Get absolute path to basic-workflow test fixture
	// This fixture contains main.go copied from SDK example
	absTestdataDir, err := filepath.Abs(BasicWorkflowTestDataDir)
	require.NoError(t, err, "Failed to get absolute path to basic-workflow directory")

	t.Logf("Applying workflow from: %s", absTestdataDir)

	// Execute apply command
	output, err := RunCLIWithServerAddr(serverPort, "apply", "--config", absTestdataDir)
	require.NoError(t, err, "Apply command should succeed")

	t.Logf("Apply command output:\n%s", output)

	// Verify workflow exists by querying via API
	workflow, err := GetWorkflowBySlug(serverPort, BasicWorkflowName, LocalOrg)
	require.NoError(t, err, "Should be able to query workflow by slug via API")
	require.NotNil(t, workflow, "Workflow should exist")

	return &WorkflowApplyResult{
		Workflow: workflow,
		Output:   output,
	}
}

// ApplyBasicWorkflowDryRun executes dry-run mode for basic workflow
// Returns CLI output without deploying
func ApplyBasicWorkflowDryRun(t *testing.T, serverPort int) string {
	absTestdataDir, err := filepath.Abs(BasicWorkflowTestDataDir)
	require.NoError(t, err, "Failed to get absolute path to basic-workflow directory")

	t.Logf("Running dry-run for workflow from: %s", absTestdataDir)

	output, err := RunCLIWithServerAddr(serverPort, "apply", "--config", absTestdataDir, "--dry-run")
	require.NoError(t, err, "Dry-run should succeed")

	t.Logf("Dry-run output:\n%s", output)

	return output
}

// VerifyWorkflowBasicProperties verifies core workflow properties from SDK example
func VerifyWorkflowBasicProperties(t *testing.T, workflow *workflowv1.Workflow) {
	require.Equal(t, BasicWorkflowName, workflow.Metadata.Name, 
		"Workflow name should match SDK example")
	require.Equal(t, BasicWorkflowNamespace, workflow.Spec.Document.Namespace, 
		"Workflow namespace should match SDK example")
	require.Equal(t, BasicWorkflowVersion, workflow.Spec.Document.Version, 
		"Workflow version should match SDK example")
	require.Equal(t, LocalOrg, workflow.Metadata.Org, 
		"Workflow org should be 'local' in local backend mode")
	require.NotEmpty(t, workflow.Spec.Description, 
		"Workflow should have description from SDK example")

	t.Logf("✓ Basic properties verified: name=%s, namespace=%s, version=%s", 
		workflow.Metadata.Name, workflow.Spec.Document.Namespace, workflow.Spec.Document.Version)
}

// VerifyWorkflowTasks verifies workflow tasks from SDK example
func VerifyWorkflowTasks(t *testing.T, workflow *workflowv1.Workflow) {
	require.NotNil(t, workflow.Spec.Tasks, "Workflow should have tasks")
	require.Len(t, workflow.Spec.Tasks, BasicWorkflowTaskCount, 
		"Workflow should have exactly 2 tasks from SDK example")

	// Build task map for verification
	taskMap := make(map[string]*workflowv1.WorkflowTask)
	taskNames := make([]string, 0, len(workflow.Spec.Tasks))
	for _, task := range workflow.Spec.Tasks {
		taskMap[task.Name] = task
		taskNames = append(taskNames, task.Name)
	}

	// Verify expected tasks from SDK example exist
	_, hasFetchTask := taskMap[BasicWorkflowFetchTask]
	require.True(t, hasFetchTask, "Workflow should have fetchData task from SDK example")

	_, hasProcessTask := taskMap[BasicWorkflowProcessTask]
	require.True(t, hasProcessTask, "Workflow should have processResponse task from SDK example")

	t.Logf("✓ Tasks verified: %v", taskNames)
}

// VerifyWorkflowEnvironmentVariables verifies environment variables from SDK example
func VerifyWorkflowEnvironmentVariables(t *testing.T, workflow *workflowv1.Workflow) {
	require.NotNil(t, workflow.Spec.EnvSpec, "Workflow should have environment spec")
	require.NotNil(t, workflow.Spec.EnvSpec.Data, "Workflow should have environment data")
	require.Len(t, workflow.Spec.EnvSpec.Data, BasicWorkflowEnvVarCount, 
		"Workflow should have 1 environment variable from SDK example")

	envVar, exists := workflow.Spec.EnvSpec.Data[BasicWorkflowEnvVarName]
	require.True(t, exists, "API_TOKEN environment variable should exist from SDK example")
	require.NotNil(t, envVar, "API_TOKEN environment variable should not be nil")
	require.True(t, envVar.IsSecret, "API_TOKEN should be marked as secret in SDK example")
	require.NotEmpty(t, envVar.Description, "Environment variable should have description")

	t.Logf("✓ Environment variable verified: %s (secret: %v)", 
		BasicWorkflowEnvVarName, envVar.IsSecret)
}

// VerifyWorkflowDefaultInstance verifies default workflow instance was auto-created
func VerifyWorkflowDefaultInstance(t *testing.T, serverPort int, workflow *workflowv1.Workflow) {
	require.NotNil(t, workflow.Status, "Workflow should have status")
	require.NotEmpty(t, workflow.Status.DefaultInstanceId, 
		"Workflow should have default_instance_id")

	defaultInstanceID := workflow.Status.DefaultInstanceId
	t.Logf("Verifying default workflow instance: %s", defaultInstanceID)

	// Query default instance via API
	workflowInstance, err := GetWorkflowInstanceViaAPI(serverPort, defaultInstanceID)
	require.NoError(t, err, "Should be able to query default workflow instance")
	require.NotNil(t, workflowInstance, "Default workflow instance should exist")
	require.Equal(t, workflow.Metadata.Id, workflowInstance.Spec.WorkflowId, 
		"Instance should reference workflow")
	require.Contains(t, workflowInstance.Metadata.Name, "-default", 
		"Default instance should have '-default' suffix")

	t.Logf("✓ Default workflow instance verified: %s", workflowInstance.Metadata.Id)
}

// VerifyApplyOutputSuccess verifies apply command output contains success indicators
func VerifyApplyOutputSuccess(t *testing.T, output string) {
	require.Contains(t, output, "Deployment successful", 
		"Output should contain deployment success message")
	require.Contains(t, output, BasicWorkflowName, 
		"Output should mention the workflow name from SDK example")

	t.Logf("✓ Apply output verified: deployment successful")
}

// VerifyDryRunOutput verifies dry-run output format and content
func VerifyDryRunOutput(t *testing.T, output string) {
	require.Contains(t, output, "Dry run successful", 
		"Output should indicate dry run completion")
	require.Contains(t, output, "TYPE", 
		"Dry-run output should contain table header: TYPE")
	require.Contains(t, output, "NAME", 
		"Dry-run output should contain table header: NAME")
	require.Contains(t, output, "ACTION", 
		"Dry-run output should contain table header: ACTION")
	require.Contains(t, output, "Workflow", 
		"Dry-run output should contain resource type: Workflow")
	require.Contains(t, output, "Create", 
		"Dry-run output should show Create action")

	t.Logf("✓ Dry-run output verified: table format correct")
}
