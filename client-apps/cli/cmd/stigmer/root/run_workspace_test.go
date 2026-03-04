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
		name       string
		workspace  string
		branch     string
		commit     string
		wantURL    string
		wantBranch string
		wantCommit string
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

// ---------------------------------------------------------------------------
// parseWorkspaceEntries tests
// ---------------------------------------------------------------------------

func TestParseWorkspaceEntries_Empty(t *testing.T) {
	entries, err := parseWorkspaceEntries(nil, "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if entries != nil {
		t.Fatalf("expected nil, got %v", entries)
	}
}

func TestParseWorkspaceEntries_BranchWithoutWorkspace(t *testing.T) {
	_, err := parseWorkspaceEntries(nil, "main", "")
	if err == nil {
		t.Fatal("expected error for --branch without --workspace")
	}
}

func TestParseWorkspaceEntries_SingleLocal(t *testing.T) {
	dir := t.TempDir()

	entries, err := parseWorkspaceEntries([]string{dir}, "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(entries))
	}
	if entries[0].Name != filepath.Base(dir) {
		t.Errorf("name = %q, want %q", entries[0].Name, filepath.Base(dir))
	}
	if entries[0].GetSource().GetLocalPath() == nil {
		t.Fatal("expected LocalPathSource")
	}
}

func TestParseWorkspaceEntries_SingleGit(t *testing.T) {
	entries, err := parseWorkspaceEntries([]string{"https://github.com/acme/my-app.git"}, "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(entries))
	}
	if entries[0].Name != "my-app" {
		t.Errorf("name = %q, want %q", entries[0].Name, "my-app")
	}
	if entries[0].GetSource().GetGitRepo() == nil {
		t.Fatal("expected GitRepoSource")
	}
}

func TestParseWorkspaceEntries_SingleGitWithBranch(t *testing.T) {
	entries, err := parseWorkspaceEntries(
		[]string{"https://github.com/acme/app"}, "develop", "",
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(entries))
	}
	git := entries[0].GetSource().GetGitRepo()
	if git == nil {
		t.Fatal("expected GitRepoSource")
	}
	if git.Branch != "develop" {
		t.Errorf("branch = %q, want %q", git.Branch, "develop")
	}
}

func TestParseWorkspaceEntries_MultipleLocal(t *testing.T) {
	dir1 := t.TempDir()
	dir2 := t.TempDir()

	entries, err := parseWorkspaceEntries([]string{dir1, dir2}, "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}
	if entries[0].Name == entries[1].Name {
		t.Errorf("expected distinct names, both are %q", entries[0].Name)
	}
}

func TestParseWorkspaceEntries_MultipleBranchRejected(t *testing.T) {
	dir1 := t.TempDir()
	dir2 := t.TempDir()

	_, err := parseWorkspaceEntries([]string{dir1, dir2}, "main", "")
	if err == nil {
		t.Fatal("expected error for --branch with multiple workspaces")
	}
}

func TestParseWorkspaceEntries_DuplicateNameRejected(t *testing.T) {
	// Two git URLs with the same repo name should collide.
	_, err := parseWorkspaceEntries([]string{
		"https://github.com/acme/app.git",
		"https://github.com/other/app.git",
	}, "", "")
	if err == nil {
		t.Fatal("expected error for duplicate derived names")
	}
}

// ---------------------------------------------------------------------------
// deriveEntryName tests
// ---------------------------------------------------------------------------

func TestDeriveEntryName_GitURLs(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want string
	}{
		{"with .git suffix", "https://github.com/acme/my-app.git", "my-app"},
		{"without .git suffix", "https://github.com/acme/my-app", "my-app"},
		{"trailing slash", "https://github.com/acme/my-app/", "my-app"},
		{"trailing slash with .git", "https://github.com/acme/my-app.git/", "my-app"},
		{"nested path", "https://gitlab.com/group/sub/repo", "repo"},
		{"http scheme", "http://gitea.internal/team/my-service", "my-service"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := deriveEntryName(tt.url)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("deriveEntryName(%q) = %q, want %q", tt.url, got, tt.want)
			}
		})
	}
}

func TestDeriveEntryName_LocalPaths(t *testing.T) {
	tests := []struct {
		name string
		path string
		want string
	}{
		{"absolute path", "/Users/dev/my-project", "my-project"},
		{"nested path", "/home/user/src/backend", "backend"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := deriveEntryName(tt.path)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("deriveEntryName(%q) = %q, want %q", tt.path, got, tt.want)
			}
		})
	}
}

func TestDeriveEntryName_Dot(t *testing.T) {
	got, err := deriveEntryName(".")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	cwd, _ := os.Getwd()
	want := filepath.Base(cwd)
	if got != want {
		t.Errorf("deriveEntryName(\".\") = %q, want cwd basename %q", got, want)
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
