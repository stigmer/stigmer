//go:build !embed_agentrunner

package agentrunner

import (
	"os"
	"path/filepath"

	"github.com/rs/zerolog/log"
)

func init() {
	dir := locateRepoSource()
	if dir == "" {
		return
	}
	sourceFS = os.DirFS(dir)
}

// locateRepoSource finds the agent-runner source directory within the
// repository tree. It walks up from the executable's location looking for
// the characteristic backend/services/agent-runner/main.py path.
func locateRepoSource() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}

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

	if envDir := os.Getenv("STIGMER_AGENT_RUNNER_SOURCE_DIR"); envDir != "" {
		if _, err := os.Stat(filepath.Join(envDir, "main.py")); err == nil {
			return envDir
		}
	}

	return ""
}
