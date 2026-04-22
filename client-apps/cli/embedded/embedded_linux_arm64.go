//go:build linux && arm64

package embedded

// Linux ARM64 - Docker-based agent-runner
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

// GetRunnerBinary returns nil to trigger Docker pull for Linux ARM64
func GetRunnerBinary() ([]byte, error) {
	return nil, nil
}
