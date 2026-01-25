//go:build e2e
// +build e2e

package e2e

// Workflow test constants - matches SDK example 07_basic_workflow.go
const (
	// Workflow names from SDK examples (source of truth)
	BasicWorkflowName      = "basic-data-fetch"
	BasicWorkflowNamespace = "data-processing"
	BasicWorkflowVersion   = "1.0.0"
	
	// Test fixture paths
	BasicWorkflowTestDataDir = "testdata/examples/07-basic-workflow"
	
	// Environment variables from SDK example
	BasicWorkflowEnvVarName = "API_TOKEN"
	
	// Task names from SDK example
	BasicWorkflowFetchTask   = "fetchPullRequest"
	BasicWorkflowProcessTask = "processResponse"
	
	// Expected values
	BasicWorkflowTaskCount = 2
	BasicWorkflowEnvVarCount = 1
	
	// Execution timeouts
	WorkflowExecutionTimeoutSeconds = 60
	
	// Backend configuration
	LocalOrg = "local"
)

// ============================================================================
// Workflow-Calling-Agent test constants - matches SDK example 15_workflow_calling_simple_agent.go
// ============================================================================
const (
	// Agent from SDK example 15
	WorkflowCallingAgentName        = "code-reviewer"
	WorkflowCallingAgentDescription = "AI code reviewer for pull requests"
	
	// Workflow from SDK example 15
	WorkflowCallingWorkflowName      = "simple-review"
	WorkflowCallingWorkflowNamespace = "code-review"
	WorkflowCallingWorkflowVersion   = "1.0.0"
	WorkflowCallingWorkflowDescription = "Simple code review workflow"
	
	// Task names from SDK example 15
	WorkflowCallingTaskName = "reviewCode"
	
	// Expected values
	WorkflowCallingWorkflowTaskCount = 1 // SDK creates 1 task (reviewCode)
	WorkflowCallingAgentCount        = 1 // SDK creates 1 agent
	WorkflowCallingWorkflowCount     = 1 // SDK creates 1 workflow
	
	// Test fixture path
	WorkflowCallingAgentTestDataDir = "testdata/examples/15-workflow-calling-simple-agent"
)
