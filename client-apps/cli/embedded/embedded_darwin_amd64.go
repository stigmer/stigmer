//go:build darwin && amd64

package embedded

// Darwin AMD64 (Intel Mac) - Download-only mode
//
// Intel Mac binaries cannot be cross-compiled from ARM Mac runners (GitHub Actions limitation).
// Since GitHub retired macos-13 (Intel) runners, we cannot build Intel binaries natively.
//
// Strategy: Return empty binary to trigger download fallback on first daemon start.
// The daemon will automatically download the agent-runner binary from GitHub releases.
//
// User impact: Intel Mac users need internet connectivity on first run only.

// GetRunnerBinary returns nil to trigger download fallback for Intel Macs
func GetRunnerBinary() ([]byte, error) {
	return nil, nil
}
