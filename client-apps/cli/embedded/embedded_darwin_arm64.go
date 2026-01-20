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

//go:embed binaries/darwin_arm64/agent-runner.tar.gz
var agentRunnerTarball []byte

// GetStigmerServerBinary returns the embedded stigmer-server binary for darwin/arm64
func GetStigmerServerBinary() ([]byte, error) {
	return stigmerServerBinary, nil
}

// GetWorkflowRunnerBinary returns the embedded workflow-runner binary for darwin/arm64
func GetWorkflowRunnerBinary() ([]byte, error) {
	return workflowRunnerBinary, nil
}

// GetAgentRunnerTarball returns the embedded agent-runner tarball for darwin/arm64
func GetAgentRunnerTarball() ([]byte, error) {
	return agentRunnerTarball, nil
}
