package harness

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// MonorepoRoot returns the absolute path of the stigmer monorepo checkout
// this harness is compiled from. Derived from this source file's own location
// so it is independent of the test process's working directory.
func MonorepoRoot() string {
	_, thisFile, _, _ := runtime.Caller(0)
	// test/integration/harness/npm_workspace.go → repo root is three levels up.
	return filepath.Join(filepath.Dir(thisFile), "..", "..", "..")
}

// ResolveWorkspaceTsx returns the monorepo's own tsx binary
// (<repoRoot>/node_modules/.bin/tsx, installed by `npm install` at the repo
// root from the version package-lock.json pins).
//
// PATH is deliberately not consulted. A globally-installed tsx of arbitrary
// version silently running test entrypoints is the same nondeterminism class
// as bare `npx prettier` (oss#531): the same bytes pass on one machine and
// fail on another. It was also the original failure mode of the TypeScript
// SDK acceptance test (oss#481), which gated on PATH and therefore silently
// skipped everywhere, indefinitely. Workspace binary or a loud, actionable
// error — nothing in between.
func ResolveWorkspaceTsx() (string, error) {
	tsxBin := filepath.Join(MonorepoRoot(), "node_modules", ".bin", "tsx")
	if _, err := os.Stat(tsxBin); err != nil {
		return "", fmt.Errorf("workspace tsx not found at %s (run `npm install` at the repo root): %w", tsxBin, err)
	}
	return tsxBin, nil
}
