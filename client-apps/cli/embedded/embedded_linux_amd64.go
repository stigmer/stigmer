//go:build linux && amd64

package embedded

import (
	_ "embed"
)

// Linux AMD64 embedded binaries
//
//go:embed binaries/linux_amd64/stigmer-server
var stigmerServerBinary []byte

//go:embed binaries/linux_amd64/workflow-runner
var workflowRunnerBinary []byte

//go:embed binaries/linux_amd64/agent-runner
var agentRunnerBinary []byte

// GetStigmerServerBinary returns the embedded stigmer-server binary for linux/amd64
func GetStigmerServerBinary() ([]byte, error) {
	return stigmerServerBinary, nil
}

// GetWorkflowRunnerBinary returns the embedded workflow-runner binary for linux/amd64
func GetWorkflowRunnerBinary() ([]byte, error) {
	return workflowRunnerBinary, nil
}

// GetAgentRunnerBinary returns the embedded agent-runner binary for linux/amd64
func GetAgentRunnerBinary() ([]byte, error) {
	return agentRunnerBinary, nil
}
