//go:build !embed_cursorrunner

package cursorrunner

import (
	"os"
	"path/filepath"
)

// devSourceDir is injected at build time via -ldflags for local dev builds
// where the binary is installed outside the repository tree.
// Set by: -X github.com/stigmer/stigmer/client-apps/cli/embedded/cursorrunner.devSourceDir=<path>
var devSourceDir string

func init() {
	dir := locateRepoSource()
	if dir == "" {
		return
	}
	sourceFS = os.DirFS(dir)
	sourceDir = dir
}

func devRepoRoot() string {
	src := locateRepoSource()
	if src == "" {
		return ""
	}
	// cursor-runner source is at backend/services/cursor-runner — repo root is 3 levels up.
	root := filepath.Clean(filepath.Join(src, "..", "..", ".."))
	if _, err := os.Stat(filepath.Join(root, "Makefile")); err == nil {
		return root
	}
	return ""
}

// locateRepoSource finds the cursor-runner source directory.
//
// Resolution order:
//  1. devSourceDir — injected via -ldflags by `make local`
//  2. Walk up from os.Executable() — works when the binary is inside the repo tree
//  3. STIGMER_CURSOR_RUNNER_SOURCE_DIR env var — manual override
func locateRepoSource() string {
	if devSourceDir != "" {
		if _, err := os.Stat(filepath.Join(devSourceDir, "package.json")); err == nil {
			return devSourceDir
		}
	}

	exe, err := os.Executable()
	if err == nil {
		dir := filepath.Dir(exe)
		for i := 0; i < 10; i++ {
			candidate := filepath.Join(dir, "backend", "services", "cursor-runner")
			if _, err := os.Stat(filepath.Join(candidate, "package.json")); err == nil {
				return candidate
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}

	if envDir := os.Getenv("STIGMER_CURSOR_RUNNER_SOURCE_DIR"); envDir != "" {
		if _, err := os.Stat(filepath.Join(envDir, "package.json")); err == nil {
			return envDir
		}
	}

	return ""
}
