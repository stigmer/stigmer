//go:build windows && amd64

package embedded

// Windows AMD64 - Docker-only mode
//
// The agent runner is pulled as a Docker image on first daemon start.
// GetRunnerBinary returns nil to trigger that Docker pull path.

func GetRunnerBinary() ([]byte, error) {
	return nil, nil
}
