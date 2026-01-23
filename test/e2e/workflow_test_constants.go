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
	BasicWorkflowFetchTask   = "fetchData"
	BasicWorkflowProcessTask = "processResponse"
	
	// Expected values
	BasicWorkflowTaskCount = 2
	BasicWorkflowEnvVarCount = 1
	
	// Backend configuration
	LocalOrg = "local"
)
