package root

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
)

// parseWorkspaceSource converts --workspace, --branch, and --commit flags
// into a WorkspaceSource proto message.
//
// Returns nil when no workspace is requested (empty workspace flag).
// The workspace flag value determines the WorkspaceSource variant:
//   - HTTPS URL  -> GitRepoSource  (--branch and --commit allowed)
//   - Local path -> LocalPathSource (--branch and --commit rejected)
func parseWorkspaceSource(workspace, branch, commit string) (*sessionv1.WorkspaceSource, error) {
	if workspace == "" {
		if branch != "" || commit != "" {
			return nil, fmt.Errorf("--branch and --commit require --workspace")
		}
		return nil, nil
	}

	if isSSHGitURL(workspace) {
		return nil, fmt.Errorf(
			"SSH git URLs are not supported: %s\n\nUse HTTPS instead: https://github.com/org/repo",
			workspace,
		)
	}

	if isGitURL(workspace) {
		return parseGitWorkspace(workspace, branch, commit)
	}

	if branch != "" || commit != "" {
		return nil, fmt.Errorf("--branch and --commit are only valid with git workspace URLs (https://...)")
	}

	return parseLocalWorkspace(workspace)
}

// isGitURL returns true if the value looks like an HTTPS git URL.
func isGitURL(s string) bool {
	return strings.HasPrefix(s, "https://") || strings.HasPrefix(s, "http://")
}

// isSSHGitURL returns true if the value looks like an SSH git URL.
func isSSHGitURL(s string) bool {
	return strings.HasPrefix(s, "git@")
}

// parseGitWorkspace constructs a GitRepoSource from CLI flags.
func parseGitWorkspace(url, branch, commit string) (*sessionv1.WorkspaceSource, error) {
	return &sessionv1.WorkspaceSource{
		Source: &sessionv1.WorkspaceSource_GitRepo{
			GitRepo: &sessionv1.GitRepoSource{
				Url:    url,
				Branch: branch,
				Commit: commit,
			},
		},
	}, nil
}

// parseLocalWorkspace resolves a local path and constructs a LocalPathSource.
// The path is resolved to absolute and validated to exist as a directory.
func parseLocalWorkspace(path string) (*sessionv1.WorkspaceSource, error) {
	resolved, err := resolveLocalPath(path)
	if err != nil {
		return nil, fmt.Errorf("invalid workspace path %q: %w", path, err)
	}

	info, err := os.Stat(resolved)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("workspace path does not exist: %s", resolved)
		}
		return nil, fmt.Errorf("cannot access workspace path %s: %w", resolved, err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("workspace path is not a directory: %s", resolved)
	}

	return &sessionv1.WorkspaceSource{
		Source: &sessionv1.WorkspaceSource_LocalPath{
			LocalPath: &sessionv1.LocalPathSource{
				Path: resolved,
			},
		},
	}, nil
}

// resolveLocalPath expands ~ and converts a path to absolute.
func resolveLocalPath(path string) (string, error) {
	if strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("cannot resolve home directory: %w", err)
		}
		path = filepath.Join(home, path[2:])
	}

	return filepath.Abs(path)
}
