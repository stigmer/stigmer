package root

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseWorkspaceSource_Empty(t *testing.T) {
	ws, err := parseWorkspaceSource("", "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ws != nil {
		t.Fatalf("expected nil, got %v", ws)
	}
}

func TestParseWorkspaceSource_BranchWithoutWorkspace(t *testing.T) {
	_, err := parseWorkspaceSource("", "main", "")
	if err == nil {
		t.Fatal("expected error for --branch without --workspace")
	}
}

func TestParseWorkspaceSource_CommitWithoutWorkspace(t *testing.T) {
	_, err := parseWorkspaceSource("", "", "abc123")
	if err == nil {
		t.Fatal("expected error for --commit without --workspace")
	}
}

func TestParseWorkspaceSource_GitURL(t *testing.T) {
	tests := []struct {
		name           string
		workspace      string
		branch         string
		commit         string
		wantURL        string
		wantBranch     string
		wantCommit     string
	}{
		{
			name:      "https url only",
			workspace: "https://github.com/acme/app.git",
			wantURL:   "https://github.com/acme/app.git",
		},
		{
			name:       "https url with branch",
			workspace:  "https://github.com/acme/app",
			branch:     "develop",
			wantURL:    "https://github.com/acme/app",
			wantBranch: "develop",
		},
		{
			name:       "https url with commit",
			workspace:  "https://github.com/acme/app",
			commit:     "abc123def",
			wantURL:    "https://github.com/acme/app",
			wantCommit: "abc123def",
		},
		{
			name:       "https url with branch and commit",
			workspace:  "https://github.com/acme/app",
			branch:     "main",
			commit:     "abc123def",
			wantURL:    "https://github.com/acme/app",
			wantBranch: "main",
			wantCommit: "abc123def",
		},
		{
			name:      "http url",
			workspace: "http://gitea.internal/team/repo",
			wantURL:   "http://gitea.internal/team/repo",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ws, err := parseWorkspaceSource(tt.workspace, tt.branch, tt.commit)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if ws == nil {
				t.Fatal("expected non-nil WorkspaceSource")
			}

			git := ws.GetGitRepo()
			if git == nil {
				t.Fatal("expected GitRepoSource, got nil")
			}
			if git.Url != tt.wantURL {
				t.Errorf("url = %q, want %q", git.Url, tt.wantURL)
			}
			if git.Branch != tt.wantBranch {
				t.Errorf("branch = %q, want %q", git.Branch, tt.wantBranch)
			}
			if git.Commit != tt.wantCommit {
				t.Errorf("commit = %q, want %q", git.Commit, tt.wantCommit)
			}
		})
	}
}

func TestParseWorkspaceSource_SSHRejected(t *testing.T) {
	_, err := parseWorkspaceSource("git@github.com:acme/app.git", "", "")
	if err == nil {
		t.Fatal("expected error for SSH URL")
	}
}

func TestParseWorkspaceSource_LocalPath(t *testing.T) {
	dir := t.TempDir()

	ws, err := parseWorkspaceSource(dir, "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ws == nil {
		t.Fatal("expected non-nil WorkspaceSource")
	}

	local := ws.GetLocalPath()
	if local == nil {
		t.Fatal("expected LocalPathSource, got nil")
	}
	if !filepath.IsAbs(local.Path) {
		t.Errorf("expected absolute path, got %q", local.Path)
	}
}

func TestParseWorkspaceSource_LocalPathRelative(t *testing.T) {
	// "." should resolve to the current working directory.
	ws, err := parseWorkspaceSource(".", "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	local := ws.GetLocalPath()
	if local == nil {
		t.Fatal("expected LocalPathSource")
	}

	cwd, _ := os.Getwd()
	if local.Path != cwd {
		t.Errorf("path = %q, want cwd %q", local.Path, cwd)
	}
}

func TestParseWorkspaceSource_LocalPathBranchRejected(t *testing.T) {
	dir := t.TempDir()
	_, err := parseWorkspaceSource(dir, "main", "")
	if err == nil {
		t.Fatal("expected error for --branch with local path")
	}
}

func TestParseWorkspaceSource_LocalPathNotExist(t *testing.T) {
	_, err := parseWorkspaceSource("/nonexistent/path/that/should/not/exist", "", "")
	if err == nil {
		t.Fatal("expected error for nonexistent path")
	}
}

func TestParseWorkspaceSource_LocalPathIsFile(t *testing.T) {
	f, err := os.CreateTemp("", "workspace-test-*")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	f.Close()
	defer os.Remove(f.Name())

	_, err = parseWorkspaceSource(f.Name(), "", "")
	if err == nil {
		t.Fatal("expected error when path is a file, not a directory")
	}
}

func TestIsGitURL(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"https://github.com/acme/app", true},
		{"http://gitea.local/repo", true},
		{"/usr/local/src", false},
		{"./relative", false},
		{"git@github.com:acme/app", false},
	}
	for _, tt := range tests {
		if got := isGitURL(tt.input); got != tt.want {
			t.Errorf("isGitURL(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}
