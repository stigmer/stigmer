//go:build darwin && arm64

package embedded

import (
	_ "embed"
)

// Darwin ARM64 (Apple Silicon) embedded binaries
// Note: Only agent-runner is embedded (Python binary)
// stigmer-server and workflow-runner are compiled into the CLI (BusyBox pattern)
//
//go:embed binaries/darwin_arm64/agent-runner
var agentRunnerBinary []byte

// GetAgentRunnerBinary returns the embedded agent-runner binary for darwin/arm64
func GetAgentRunnerBinary() ([]byte, error) {
	return agentRunnerBinary, nil
}
