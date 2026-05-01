// Package cursorrunner provides access to the cursor-runner TypeScript source
// code as an io/fs.FS and as a filesystem path.
//
// The source is resolved at init time via one of two mechanisms:
//
//   - Production (build tag embed_cursorrunner): TypeScript source is embedded
//     in the binary via //go:embed after running sync.sh. The CLI is fully
//     self-contained.
//
//   - Development (default): TypeScript source is located in the repository
//     tree by walking up from the executable path, or via the
//     STIGMER_CURSOR_RUNNER_SOURCE_DIR environment variable.
//
// Unlike the Python agent-runner, the cursor-runner also needs the raw
// filesystem path (not just fs.FS) because npm install and tsx execution
// operate on the real filesystem.
package cursorrunner

import "io/fs"

// sourceFS is populated at init time by the build-tagged init functions.
var sourceFS fs.FS

// sourceDir is the absolute filesystem path to the cursor-runner source.
// Only available in dev mode (embed mode uses the embedded FS and extracts
// to a staging directory managed by the caller).
var sourceDir string

// SourceFS returns the cursor-runner TypeScript source as a read-only
// filesystem. Returns nil when the source is not available.
func SourceFS() fs.FS {
	return sourceFS
}

// IsAvailable reports whether the cursor-runner source is accessible.
func IsAvailable() bool {
	return sourceFS != nil
}

// SourceDir returns the absolute filesystem path to the cursor-runner
// source directory. Returns empty string in embed mode or when the
// directory cannot be determined.
func SourceDir() string {
	return sourceDir
}

// DevRepoRoot returns the repository root when running in dev mode.
// Returns empty string in embed mode or when the root cannot be determined.
// Callers use this to locate monorepo path dependencies that live outside
// the cursor-runner source tree.
func DevRepoRoot() string {
	return devRepoRoot()
}
