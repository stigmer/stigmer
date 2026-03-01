// Package agentrunner provides access to the agent-runner Python source code
// as an io/fs.FS.
//
// The source is resolved at init time via one of two mechanisms:
//
//   - Production (build tag embed_agentrunner): Python source is embedded in the
//     binary via //go:embed after running sync.sh. The CLI is fully self-contained.
//
//   - Development (default): Python source is located in the repository tree by
//     walking up from the executable path, or via the STIGMER_AGENT_RUNNER_SOURCE_DIR
//     environment variable.
package agentrunner

import "io/fs"

// sourceFS is populated at init time by the build-tagged init functions.
var sourceFS fs.FS

// SourceFS returns the agent-runner Python source as a read-only filesystem.
// Returns nil when the source is not available (e.g., production build without
// sync, or running outside the repo tree in dev mode).
func SourceFS() fs.FS {
	return sourceFS
}

// IsAvailable reports whether the agent-runner source is accessible.
func IsAvailable() bool {
	return sourceFS != nil
}
