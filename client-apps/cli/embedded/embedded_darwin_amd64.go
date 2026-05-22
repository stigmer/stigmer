//go:build darwin && amd64

package embedded

// Darwin AMD64 (Intel Mac)
//
// The unified runner (@stigmer/runner) is a TypeScript/Node.js process started
// directly by the daemon. No embedded binary is needed.

// GetRunnerBinary is a legacy stub retained for backward compatibility.
// Returns nil (no binary to extract).
func GetRunnerBinary() ([]byte, error) {
	return nil, nil
}
