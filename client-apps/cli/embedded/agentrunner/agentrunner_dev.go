//go:build !embed_agentrunner

package agentrunner

import (
	"os"
	"path/filepath"

	"github.com/rs/zerolog/log"
)

// devSourceDir is injected at build time via -ldflags for local dev builds
// where the binary is installed outside the repository tree (e.g. ~/bin/).
// Set by: -X github.com/stigmer/stigmer/client-apps/cli/embedded/agentrunner.devSourceDir=<path>
var devSourceDir string

func init() {
	dir := locateRepoSource()
	if dir == "" {
		return
	}
	sourceFS = os.DirFS(dir)
}

// locateRepoSource finds the agent-runner source directory.
//
// Resolution order:
//  1. devSourceDir — injected via -ldflags by `make release-local`
//  2. Walk up from os.Executable() — works when the binary is inside the repo tree
//  3. STIGMER_AGENT_RUNNER_SOURCE_DIR env var — manual override
func locateRepoSource() string {
	if devSourceDir != "" {
		if _, err := os.Stat(filepath.Join(devSourceDir, "main.py")); err == nil {
			log.Debug().
				Str("path", devSourceDir).
				Msg("Located agent-runner source via build-time path")
			return devSourceDir
		}
	}

	exe, err := os.Executable()
	if err == nil {
		dir := filepath.Dir(exe)
		for i := 0; i < 10; i++ {
			candidate := filepath.Join(dir, "backend", "services", "agent-runner")
			if _, err := os.Stat(filepath.Join(candidate, "main.py")); err == nil {
				log.Debug().
					Str("path", candidate).
					Msg("Located agent-runner source in repository tree")
				return candidate
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}

	if envDir := os.Getenv("STIGMER_AGENT_RUNNER_SOURCE_DIR"); envDir != "" {
		if _, err := os.Stat(filepath.Join(envDir, "main.py")); err == nil {
			log.Debug().
				Str("path", envDir).
				Msg("Located agent-runner source via STIGMER_AGENT_RUNNER_SOURCE_DIR")
			return envDir
		}
	}

	return ""
}
