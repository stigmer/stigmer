//go:build linux && amd64

package embedded

import (
	_ "embed"
)

// Linux AMD64 embedded binaries
// Note: Only agent-runner is embedded (Python binary)
// stigmer-server and workflow-runner are compiled into the CLI (BusyBox pattern)
//
//go:embed binaries/linux_amd64/agent-runner
var agentRunnerBinary []byte

// GetAgentRunnerBinary returns the embedded agent-runner binary for linux/amd64
func GetAgentRunnerBinary() ([]byte, error) {
	return agentRunnerBinary, nil
}
