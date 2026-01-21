//go:build darwin && arm64

package embedded

import (
	_ "embed"
)

// Darwin ARM64 (Apple Silicon) embedded binaries
//
//go:embed binaries/darwin_arm64/stigmer-server
var stigmerServerBinary []byte

//go:embed binaries/darwin_arm64/workflow-runner
var workflowRunnerBinary []byte

//go:embed binaries/darwin_arm64/agent-runner
var agentRunnerBinary []byte

// GetStigmerServerBinary returns the embedded stigmer-server binary for darwin/arm64
func GetStigmerServerBinary() ([]byte, error) {
	return stigmerServerBinary, nil
}

// GetWorkflowRunnerBinary returns the embedded workflow-runner binary for darwin/arm64
func GetWorkflowRunnerBinary() ([]byte, error) {
	return workflowRunnerBinary, nil
}

// GetAgentRunnerBinary returns the embedded agent-runner binary for darwin/arm64
func GetAgentRunnerBinary() ([]byte, error) {
	return agentRunnerBinary, nil
}
