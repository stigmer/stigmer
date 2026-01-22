//go:build darwin && arm64

package embedded

// Darwin ARM64 (Apple Silicon) - Docker-based agent-runner
//
// The agent-runner is now distributed as a Docker image (ghcr.io/stigmer/agent-runner).
// This approach provides:
// 1. Multi-arch support (amd64/arm64) without embedding large binaries
// 2. Easier updates via standard Docker pull
// 3. Consistent behavior across all platforms
//
// Strategy: Return nil to trigger Docker pull fallback on daemon start.
// The daemon will automatically pull the agent-runner Docker image from GitHub Container Registry.
//
// User impact: Users need Docker and internet connectivity on first run only.

// GetAgentRunnerBinary returns nil to trigger Docker pull for ARM Macs
func GetAgentRunnerBinary() ([]byte, error) {
	// Return nil to signal that binary is not embedded
	// This triggers the Docker image pull in daemon.go:ensureAgentRunnerImage()
	return nil, nil
}
