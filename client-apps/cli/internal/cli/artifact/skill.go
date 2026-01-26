package artifact

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/pkg/errors"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"google.golang.org/grpc"
)

const (
	// SkillFileName is the name of the skill definition file
	SkillFileName = "SKILL.md"
)

// SkillArtifactOptions contains options for uploading a skill artifact
type SkillArtifactOptions struct {
	// Directory to zip (default: current directory)
	Directory string
	// Organization ID
	OrgID string
	// Tag for the skill version (default: "latest")
	Tag string
	// gRPC connection to backend
	Conn *grpc.ClientConn
	// Quiet mode (suppress detailed output)
	Quiet bool
}

// SkillArtifactResult contains the result of uploading a skill artifact
type SkillArtifactResult struct {
	SkillName    string
	VersionHash  string
	StorageKey   string
	Tag          string
	ArtifactSize int64
}

// SkillFromGitOptions contains options for pushing a skill from a git repository
type SkillFromGitOptions struct {
	// Directory containing the skill (cloned from git)
	Directory string
	// Organization ID
	OrgID string
	// Tag for the skill version
	Tag string
	// gRPC connection to backend
	Conn *grpc.ClientConn
	// Quiet mode (suppress detailed output)
	Quiet bool
	// Git repository URL
	GitURL string
	// Git reference (tag, branch, or commit SHA)
	GitRef string
	// Subdirectory within the git repository
	GitSubdir string
}

// HasSkillFile checks if the given directory contains a SKILL.md file
func HasSkillFile(dir string) bool {
	skillPath := filepath.Join(dir, SkillFileName)
	_, err := os.Stat(skillPath)
	return err == nil
}

// PushSkill zips the current directory and uploads it as a skill artifact
func PushSkill(opts *SkillArtifactOptions) (*SkillArtifactResult, error) {
	// Step 1: Validate directory
	if opts.Directory == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return nil, errors.Wrap(err, "failed to get current directory")
		}
		opts.Directory = cwd
	}

	// Ensure SKILL.md exists
	if !HasSkillFile(opts.Directory) {
		return nil, fmt.Errorf("SKILL.md not found in %s", opts.Directory)
	}

	// Step 2: Parse SKILL.md to get skill name from YAML frontmatter
	metadata, err := ParseSkillMetadata(opts.Directory)
	if err != nil {
		return nil, err
	}
	skillName := metadata.Name
	if !opts.Quiet {
		cliprint.PrintInfo("Skill name: %s (from SKILL.md)", skillName)
	}

	// Step 3: Create zip artifact
	if !opts.Quiet {
		cliprint.PrintInfo("Creating skill artifact...")
	}

	zipBuffer := new(bytes.Buffer)
	artifactSize, err := createSkillZip(opts.Directory, zipBuffer)
	if err != nil {
		return nil, errors.Wrap(err, "failed to create skill artifact")
	}

	if !opts.Quiet {
		cliprint.PrintSuccess("✓ Artifact created (%s)", formatBytes(artifactSize))
	}

	// Step 4: Calculate SHA256 hash
	zipBytes := zipBuffer.Bytes()
	hash := sha256.Sum256(zipBytes)
	hashHex := fmt.Sprintf("%x", hash)

	if !opts.Quiet {
		cliprint.PrintInfo("Version hash: %s", hashHex[:16]+"...") // Show first 16 chars
	}

	// Step 5: Collect source information (git detection)
	source := collectLocalSource(opts.Directory, opts.Quiet)

	// Step 6: Upload to backend
	if !opts.Quiet {
		cliprint.PrintInfo("Uploading skill artifact...")
	}

	// Default tag to "latest" if not provided
	tag := opts.Tag
	if tag == "" {
		tag = "latest"
	}

	client := skillv1.NewSkillCommandControllerClient(opts.Conn)
	response, err := client.Push(context.Background(), &skillv1.PushSkillRequest{
		Scope:    apiresource.ApiResourceOwnerScope_organization,
		Org:      opts.OrgID,
		Artifact: zipBytes,
		Tag:      tag,
		Source:   source,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to upload skill artifact")
	}

	if !opts.Quiet {
		cliprint.PrintSuccess("✓ Skill artifact uploaded successfully")
		cliprint.PrintInfo("  Version hash: %s", response.Status.VersionHash)
		if response.Spec.Tag != "" {
			cliprint.PrintInfo("  Tag: %s", response.Spec.Tag)
		}
	}

	return &SkillArtifactResult{
		SkillName:    skillName,
		VersionHash:  response.Status.VersionHash,
		StorageKey:   response.Status.ArtifactStorageKey,
		Tag:          response.Spec.Tag,
		ArtifactSize: artifactSize,
	}, nil
}

// PushSkillFromGit uploads a skill artifact from a git repository with GitSource metadata.
// This is used when pushing directly from a remote git URL.
func PushSkillFromGit(opts *SkillFromGitOptions) (*SkillArtifactResult, error) {
	// Step 1: Validate directory
	if opts.Directory == "" {
		return nil, errors.New("directory is required for git push")
	}

	// Ensure SKILL.md exists
	if !HasSkillFile(opts.Directory) {
		return nil, fmt.Errorf("SKILL.md not found in %s", opts.Directory)
	}

	// Step 2: Parse SKILL.md to get skill name from YAML frontmatter
	metadata, err := ParseSkillMetadata(opts.Directory)
	if err != nil {
		return nil, err
	}
	skillName := metadata.Name
	if !opts.Quiet {
		cliprint.PrintInfo("Skill name: %s (from SKILL.md)", skillName)
	}

	// Step 3: Create zip artifact
	if !opts.Quiet {
		cliprint.PrintInfo("Creating skill artifact...")
	}

	zipBuffer := new(bytes.Buffer)
	artifactSize, err := createSkillZip(opts.Directory, zipBuffer)
	if err != nil {
		return nil, errors.Wrap(err, "failed to create skill artifact")
	}

	if !opts.Quiet {
		cliprint.PrintSuccess("✓ Artifact created (%s)", formatBytes(artifactSize))
	}

	// Step 4: Calculate SHA256 hash
	zipBytes := zipBuffer.Bytes()
	hash := sha256.Sum256(zipBytes)
	hashHex := fmt.Sprintf("%x", hash)

	if !opts.Quiet {
		cliprint.PrintInfo("Version hash: %s", hashHex[:16]+"...")
	}

	// Step 5: Create GitSource for source tracking
	source := &skillv1.SkillSource{
		Source: &skillv1.SkillSource_Git{
			Git: &skillv1.GitSource{
				Url:    opts.GitURL,
				Ref:    opts.GitRef,
				Subdir: opts.GitSubdir,
			},
		},
	}

	if !opts.Quiet {
		cliprint.PrintInfo("Source: git repository")
		cliprint.PrintInfo("  URL: %s", opts.GitURL)
		if opts.GitRef != "" {
			cliprint.PrintInfo("  Ref: %s", opts.GitRef)
		}
		if opts.GitSubdir != "" {
			cliprint.PrintInfo("  Subdir: %s", opts.GitSubdir)
		}
	}

	// Step 6: Upload to backend
	if !opts.Quiet {
		cliprint.PrintInfo("Uploading skill artifact...")
	}

	// Default tag to "latest" if not provided
	tag := opts.Tag
	if tag == "" {
		tag = "latest"
	}

	client := skillv1.NewSkillCommandControllerClient(opts.Conn)
	response, err := client.Push(context.Background(), &skillv1.PushSkillRequest{
		Scope:    apiresource.ApiResourceOwnerScope_organization,
		Org:      opts.OrgID,
		Artifact: zipBytes,
		Tag:      tag,
		Source:   source,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to upload skill artifact")
	}

	if !opts.Quiet {
		cliprint.PrintSuccess("✓ Skill artifact uploaded successfully")
		cliprint.PrintInfo("  Version hash: %s", response.Status.VersionHash)
		if response.Spec.Tag != "" {
			cliprint.PrintInfo("  Tag: %s", response.Spec.Tag)
		}
	}

	return &SkillArtifactResult{
		SkillName:    skillName,
		VersionHash:  response.Status.VersionHash,
		StorageKey:   response.Status.ArtifactStorageKey,
		Tag:          response.Spec.Tag,
		ArtifactSize: artifactSize,
	}, nil
}

// createSkillZip creates a zip archive of the skill directory
// Returns the size of the zip file in bytes
func createSkillZip(sourceDir string, zipWriter io.Writer) (int64, error) {
	zipArchive := zip.NewWriter(zipWriter)
	defer zipArchive.Close()

	var totalSize int64

	// Walk through the directory
	err := filepath.Walk(sourceDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Skip directories
		if info.IsDir() {
			return nil
		}

		// Get relative path
		relPath, err := filepath.Rel(sourceDir, path)
		if err != nil {
			return errors.Wrapf(err, "failed to get relative path for %s", path)
		}

		// Skip excluded files/directories
		if shouldExclude(relPath) {
			return nil
		}

		// Create zip entry
		writer, err := zipArchive.Create(relPath)
		if err != nil {
			return errors.Wrapf(err, "failed to create zip entry for %s", relPath)
		}

		// Open source file
		file, err := os.Open(path)
		if err != nil {
			return errors.Wrapf(err, "failed to open file %s", path)
		}
		defer file.Close()

		// Copy file content to zip
		size, err := io.Copy(writer, file)
		if err != nil {
			return errors.Wrapf(err, "failed to write file %s to zip", path)
		}

		totalSize += size
		return nil
	})

	if err != nil {
		return 0, err
	}

	return totalSize, nil
}

// shouldExclude determines if a file/directory should be excluded from the zip
func shouldExclude(relPath string) bool {
	// Normalize path separators for consistent matching
	relPath = filepath.ToSlash(relPath)

	// Exclude patterns
	excludePatterns := []string{
		".git/",
		".git",
		"node_modules/",
		"node_modules",
		".venv/",
		".venv",
		"venv/",
		"venv",
		"__pycache__/",
		"__pycache__",
		".pytest_cache/",
		".pytest_cache",
		".idea/",
		".idea",
		".vscode/",
		".vscode",
		".DS_Store",
		"Thumbs.db",
		"*.pyc",
		"*.pyo",
		"*.pyd",
		".Python",
		"*.so",
		"*.dylib",
		"*.dll",
		"*.class",
		"*.log",
		"*.swp",
		"*.swo",
		"*~",
		".env",
		".env.local",
		".env.*",
	}

	for _, pattern := range excludePatterns {
		// Check if path starts with pattern (for directories)
		if strings.HasPrefix(relPath, pattern) {
			return true
		}

		// Check if path contains pattern (for nested paths)
		if strings.Contains(relPath, "/"+pattern) {
			return true
		}

		// Check if path matches pattern exactly (for files)
		if relPath == pattern {
			return true
		}

		// Handle wildcard patterns
		if strings.Contains(pattern, "*") {
			matched, _ := filepath.Match(pattern, filepath.Base(relPath))
			if matched {
				return true
			}
		}
	}

	return false
}

// formatBytes formats a byte count into a human-readable string
func formatBytes(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}

// collectLocalSource detects git information and creates a SkillSource for local pushes.
// If the directory is within a git repo, it collects remote URL, commit SHA, and subdir.
func collectLocalSource(directory string, quiet bool) *skillv1.SkillSource {
	localSource := &skillv1.LocalSource{
		IsGitRepo: false,
	}

	// Check if we're in a git repo
	repoRoot, err := getGitRepoRoot(directory)
	if err != nil {
		// Not a git repo, return empty local source
		if !quiet {
			cliprint.PrintInfo("Source: local directory (not a git repository)")
		}
		return &skillv1.SkillSource{
			Source: &skillv1.SkillSource_Local{Local: localSource},
		}
	}

	localSource.IsGitRepo = true

	// Get git remote URL (origin)
	if remoteURL, err := getGitRemoteURL(directory); err == nil && remoteURL != "" {
		localSource.GitRemoteUrl = remoteURL
	}

	// Get current commit SHA
	if commit, err := getGitCommit(directory); err == nil && commit != "" {
		localSource.GitCommit = commit
	}

	// Calculate subdir relative to repo root
	absDir, err := filepath.Abs(directory)
	if err == nil {
		relPath, err := filepath.Rel(repoRoot, absDir)
		if err == nil && relPath != "." {
			localSource.Subdir = relPath
		}
	}

	if !quiet {
		if localSource.GitRemoteUrl != "" {
			cliprint.PrintInfo("Source: git repository")
			cliprint.PrintInfo("  Remote: %s", localSource.GitRemoteUrl)
			if localSource.GitCommit != "" {
				cliprint.PrintInfo("  Commit: %s", localSource.GitCommit[:min(12, len(localSource.GitCommit))])
			}
			if localSource.Subdir != "" {
				cliprint.PrintInfo("  Subdir: %s", localSource.Subdir)
			}
		} else {
			cliprint.PrintInfo("Source: local git repository (no remote)")
		}
	}

	return &skillv1.SkillSource{
		Source: &skillv1.SkillSource_Local{Local: localSource},
	}
}

// getGitRepoRoot returns the root directory of the git repository.
// Returns an error if not in a git repository.
func getGitRepoRoot(directory string) (string, error) {
	cmd := exec.Command("git", "rev-parse", "--show-toplevel")
	cmd.Dir = directory
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}

// getGitRemoteURL returns the URL of the "origin" remote.
// Returns empty string if no origin remote exists.
func getGitRemoteURL(directory string) (string, error) {
	cmd := exec.Command("git", "remote", "get-url", "origin")
	cmd.Dir = directory
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}

// getGitCommit returns the current HEAD commit SHA.
func getGitCommit(directory string) (string, error) {
	cmd := exec.Command("git", "rev-parse", "HEAD")
	cmd.Dir = directory
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}
