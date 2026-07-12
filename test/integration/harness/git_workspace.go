package harness

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// NewGitWorkspace creates a hermetic git work tree under t.TempDir() suitable for
// exercising the Cursor harness "capture mode" end to end.
//
// Capture mode (per-file Accept/Reject via a git snapshot/restore at the turn
// boundary) is selected only when the session's primary workspace is a real git
// work tree (execute-cursor/index.ts: captureMode = isGitWorkTree(...)). Attach
// the returned directory to a session via a LocalPathSource workspace entry and
// the runner — co-located on this host — operates inside it, triggering the
// identical capture path a cloned repo would, but with no network, auth, or
// flake (the GitRepoSource path is HTTPS-only and must reach a real remote; see
// cursor_git_workspace_test.go).
//
// Load-bearing setup detail: the Cursor SDK persists its resume state under
// {workspace}/.stigmer/, and capture's git snapshot (shadow-capture.ts
// writeWorkingTree -> `git add -A`) honors .gitignore + .git/info/exclude. The
// whole snapshot/restore design depends on that state being git-IGNORED so it is
// never captured as an approval card nor clobbered by restoreToBaseline. The
// clone provisioner (workspace/sources/git.ts) seeds that exclusion via
// .git/info/exclude, but the local-path provisioner does not — so we seed it
// here, in both .gitignore and .git/info/exclude, exactly as the runner unit
// test (shadow-capture.test.ts) does.
//
// The seed commit makes .gitignore tracked so the baseline snapshot is a clean
// tree against which the agent's edits show as the only diff. Use
// SeedWorkspaceFile to add tracked content the agent will edit.
func NewGitWorkspace(t *testing.T) string {
	t.Helper()

	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not found on PATH — cannot create a capture-mode git workspace")
	}

	dir := t.TempDir()
	runGit(t, dir, "init", "-q")
	// Local identity only — never touch the host's global git config.
	runGit(t, dir, "config", "user.email", "test@stigmer.local")
	runGit(t, dir, "config", "user.name", "Stigmer Test")

	// .gitignore (tracked) covers the SDK state dir and .env-style secrets.
	require.NoError(t,
		os.WriteFile(filepath.Join(dir, ".gitignore"), []byte(".stigmer/\n.env\n"), 0o644),
		"seed .gitignore")
	// .git/info/exclude mirrors the clone path's GIT_EXCLUDE_ENTRIES so even a
	// bare `.stigmer` (e.g. the runner's workspace symlink, not a directory) is
	// excluded regardless of the trailing-slash semantics of .gitignore.
	appendToFile(t, filepath.Join(dir, ".git", "info", "exclude"), ".stigmer\nlost+found\n")

	runGit(t, dir, "add", ".gitignore")
	runGit(t, dir, "commit", "-q", "-m", "seed workspace")
	return dir
}

// SeedWorkspaceFile writes relPath under the git workspace dir and commits it, so
// the file is tracked and forms part of the pre-turn baseline. Use it for files
// the agent will modify or delete (so the captured change is a MODIFY/DELETE
// against real "before" content).
func SeedWorkspaceFile(t *testing.T, dir, relPath, content string) {
	t.Helper()
	abs := filepath.Join(dir, relPath)
	require.NoError(t, os.MkdirAll(filepath.Dir(abs), 0o755), "mkdir for %s", relPath)
	require.NoError(t, os.WriteFile(abs, []byte(content), 0o644), "seed %s", relPath)
	runGit(t, dir, "add", "--", relPath)
	runGit(t, dir, "commit", "-q", "-m", "seed "+relPath)
}

// SeedExecutableWorkspaceFile writes relPath under the git workspace dir with
// the executable bit set (0o755) and commits it. Use it for hook/helper scripts
// the workspace must carry before a turn starts — e.g. a FOREIGN
// `.cursor/hooks.json` preToolUse hook script (issue #205), which Cursor spawns
// directly and therefore must be executable.
func SeedExecutableWorkspaceFile(t *testing.T, dir, relPath, content string) {
	t.Helper()
	abs := filepath.Join(dir, relPath)
	require.NoError(t, os.MkdirAll(filepath.Dir(abs), 0o755), "mkdir for %s", relPath)
	require.NoError(t, os.WriteFile(abs, []byte(content), 0o755), "seed executable %s", relPath)
	runGit(t, dir, "add", "--", relPath)
	runGit(t, dir, "commit", "-q", "-m", "seed "+relPath)
}

// SeedGitignorePattern appends a pattern to the tracked .gitignore and commits
// it, so a matching path is git-IGNORED from the pre-turn baseline onward. Use it
// to create a NON-secret ignored path (e.g. "cache/") that the CAS substrate — not
// the git diff — captures for review. (NewGitWorkspace already ignores .env and
// .stigmer/, but those are secret/state; a distinct non-secret pattern is needed
// to exercise the GIT_IGNORED_CAPTURED capture-and-reconcile path.)
func SeedGitignorePattern(t *testing.T, dir, pattern string) {
	t.Helper()
	appendToFile(t, filepath.Join(dir, ".gitignore"), pattern+"\n")
	runGit(t, dir, "add", ".gitignore")
	runGit(t, dir, "commit", "-q", "-m", "gitignore "+pattern)
}

// ReadWorkspaceFile returns the current bytes of relPath under the workspace dir
// as a string, failing the test if the file cannot be read. Use WorkspaceFileExists
// first when a file may legitimately be absent (e.g. a rejected create).
func ReadWorkspaceFile(t *testing.T, dir, relPath string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, relPath))
	require.NoErrorf(t, err, "read workspace file %s", relPath)
	return string(data)
}

// WorkspaceFileExists reports whether relPath exists under the workspace dir.
func WorkspaceFileExists(t *testing.T, dir, relPath string) bool {
	t.Helper()
	_, err := os.Stat(filepath.Join(dir, relPath))
	return err == nil
}

// RemoveWorkspaceFile deletes relPath from the working tree (a no-op if absent),
// leaving .git and any out-of-tree stores untouched. Use it to model a sandbox
// recycle where the working files are lost but the durable git object store and
// CAS artifact store survive, so a resume must reconcile from those alone.
func RemoveWorkspaceFile(t *testing.T, dir, relPath string) {
	t.Helper()
	err := os.Remove(filepath.Join(dir, relPath))
	if err != nil && !os.IsNotExist(err) {
		require.NoErrorf(t, err, "remove workspace file %s", relPath)
	}
}

// WorkspaceHeadSHA returns the workspace's current HEAD commit SHA. Capture mode
// never commits, so this is the seed commit before and after every turn — the
// invariant the accumulation test asserts.
func WorkspaceHeadSHA(t *testing.T, dir string) string {
	t.Helper()
	return strings.TrimSpace(runGit(t, dir, "rev-parse", "HEAD"))
}

// runGit runs a git command in dir and returns its combined output, failing the
// test on error with the full output for diagnosis.
func runGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	require.NoErrorf(t, err, "git %s failed in %s: %s", strings.Join(args, " "), dir, string(out))
	return string(out)
}

// appendToFile appends content to path, creating parent dirs as needed.
func appendToFile(t *testing.T, path, content string) {
	t.Helper()
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755), "mkdir for %s", path)
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	require.NoErrorf(t, err, "open %s for append", path)
	defer func() { require.NoError(t, f.Close(), "close %s", path) }()
	_, err = f.WriteString(content)
	require.NoErrorf(t, err, "append to %s", path)
}
