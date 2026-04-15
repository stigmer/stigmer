package root

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	sessionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/session/v1"
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

// parseWorkspaceEntries converts repeatable --workspace flags plus --branch
// and --commit into a list of WorkspaceEntry proto messages.
//
// Returns nil when no workspace is requested (empty workspaces list).
//
// --branch and --commit are rejected when more than one workspace is provided;
// they apply only to a single git workspace. This keeps the top-level flags
// simple for the common case while deferring per-entry branch syntax to a
// future inline format.
func parseWorkspaceEntries(workspaces []string, branch, commit string) ([]*sessionv1.WorkspaceEntry, error) {
	if len(workspaces) == 0 {
		if branch != "" || commit != "" {
			return nil, fmt.Errorf("--branch and --commit require --workspace")
		}
		return nil, nil
	}

	if len(workspaces) > 1 && (branch != "" || commit != "") {
		return nil, fmt.Errorf("--branch and --commit are only valid with a single git workspace")
	}

	entries := make([]*sessionv1.WorkspaceEntry, 0, len(workspaces))
	seenNames := make(map[string]string) // derived name -> original workspace value

	for _, ws := range workspaces {
		source, err := parseWorkspaceSource(ws, branch, commit)
		if err != nil {
			return nil, err
		}

		name, err := deriveEntryName(ws)
		if err != nil {
			return nil, err
		}

		if prev, exists := seenNames[name]; exists {
			return nil, fmt.Errorf(
				"duplicate workspace name %q derived from both %q and %q; "+
					"use distinct directory names or repository URLs",
				name, prev, ws,
			)
		}
		seenNames[name] = ws

		entries = append(entries, &sessionv1.WorkspaceEntry{
			Name:   name,
			Source: source,
		})
	}

	return entries, nil
}

// deriveEntryName returns a short identifier from a workspace flag value.
// Git URLs use the last path segment (sans ".git"), local paths use the
// directory basename. The name is used in system prompt headings and as
// the clone subdirectory in cloud mode.
func deriveEntryName(workspace string) (string, error) {
	if isGitURL(workspace) {
		return deriveGitRepoName(workspace)
	}
	return deriveLocalDirName(workspace)
}

// deriveGitRepoName extracts the repository name from an HTTPS git URL.
// Examples:
//
//	"https://github.com/acme/my-app.git"  -> "my-app"
//	"https://github.com/acme/my-app"      -> "my-app"
//	"https://github.com/acme/my-app/"     -> "my-app"
func deriveGitRepoName(rawURL string) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("cannot parse git URL for name derivation: %w", err)
	}

	path := strings.TrimRight(u.Path, "/")
	path = strings.TrimSuffix(path, ".git")

	segments := strings.Split(path, "/")
	for i := len(segments) - 1; i >= 0; i-- {
		if segments[i] != "" {
			return segments[i], nil
		}
	}

	return "", fmt.Errorf("cannot derive workspace name from URL: %s", rawURL)
}

// deriveLocalDirName extracts the directory basename from a local path.
// The path is resolved to absolute before taking the basename so that
// relative paths like "." produce meaningful names.
func deriveLocalDirName(path string) (string, error) {
	resolved, err := resolveLocalPath(path)
	if err != nil {
		return "", fmt.Errorf("cannot resolve path for name derivation: %w", err)
	}

	name := filepath.Base(resolved)
	if name == "." || name == "/" || name == string(filepath.Separator) {
		return "", fmt.Errorf("cannot derive workspace name from path: %s", path)
	}

	return name, nil
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
