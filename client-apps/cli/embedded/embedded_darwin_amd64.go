//go:build darwin && amd64

package embedded

import (
	_ "embed"
)

// Darwin AMD64 (Intel Mac) embedded binaries
// Note: Only agent-runner is embedded (Python binary)
// stigmer-server and workflow-runner are compiled into the CLI (BusyBox pattern)
//
//go:embed binaries/darwin_amd64/agent-runner
var agentRunnerBinary []byte

// GetAgentRunnerBinary returns the embedded agent-runner binary for darwin/amd64
func GetAgentRunnerBinary() ([]byte, error) {
	return agentRunnerBinary, nil
}
