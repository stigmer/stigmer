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
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/ignore"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	skillv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
)

const (
	// SkillFileName is the name of the skill definition file
	SkillFileName = "SKILL.md"
)

// IgnoreOptions configures file filtering during artifact creation.
// These options control which files are included or excluded from the artifact.
type IgnoreOptions struct {
	// RespectGitignore enables loading patterns from .gitignore files.
	// When true (default), patterns in .gitignore are applied after security defaults.
	RespectGitignore bool

	// ExtraIgnore contains additional patterns to ignore, typically from CLI --ignore flags.
	// These patterns are applied after .stigmerignore with high priority.
	ExtraIgnore []string

	// ExtraInclude contains patterns to force-include, typically from CLI --include flags.
	// These are converted to negation patterns and have the highest priority.
	ExtraInclude []string

	// Verbose enables detailed output showing each file's ignore decision.
	// When true, shows INCLUDE/IGNORE/SKIP DIR for each path processed.
	Verbose bool
}

// DefaultIgnoreOptions returns the recommended default ignore configuration.
// Security defaults are always enabled, .gitignore is respected.
func DefaultIgnoreOptions() IgnoreOptions {
	return IgnoreOptions{
		RespectGitignore: true,
	}
}

// ZipStats contains statistics about the artifact creation process.
// This provides transparency into what was included and excluded.
type ZipStats struct {
	// FilesIncluded is the number of files added to the artifact.
	FilesIncluded int

	// FilesIgnored is the number of files skipped due to ignore patterns.
	FilesIgnored int

	// DirsSkipped is the number of directories entirely skipped.
	// This is a performance optimization - when a directory matches an ignore pattern,
	// we skip the entire subtree without examining individual files.
	DirsSkipped int

	// TotalSize is the uncompressed size of all included files in bytes.
	TotalSize int64

	// IgnoredBySource tracks how many files were ignored by each pattern source.
	// Keys are source names like "defaults", ".gitignore", ".stigmerignore", "cli".
	IgnoredBySource map[string]int
}

// SkillArtifactOptions contains options for uploading a skill artifact
type SkillArtifactOptions struct {
	// Directory to zip (default: current directory)
	Directory string
	// Organization ID
	OrgID string
	// Tag for the skill version (default: "latest")
	Tag string
	// Optional version message describing what changed
	Message string
	// Client is the Stigmer SDK client
	Client *stigmer.Client
	// Quiet mode (suppress detailed output)
	Quiet bool
	// Ignore configures file filtering during artifact creation.
	// If nil, DefaultIgnoreOptions() is used.
	Ignore *IgnoreOptions
}

// SkillArtifactResult contains the result of uploading a skill artifact.
type SkillArtifactResult struct {
	ID           string
	SkillName    string
	Slug         string
	VersionHash  string
	StorageKey   string
	Tag          string
	Message      string
	ArtifactSize int64
	// IsNewResource is true when this push created the skill (first version).
	IsNewResource bool
	// VersionChanged is true when the pushed content produced a new version
	// (false on an idempotent re-push of identical content).
	VersionChanged bool
}

// classifyPushVersion derives created/changed/unchanged from the response's
// version lineage. The backend sets metadata.version.id to the new content hash
// and previous_version_id to the prior head hash, so:
//   - previous_version_id == ""        → brand-new skill (first version)
//   - id == previous_version_id        → identical content (no new version)
//   - otherwise                        → content changed (new version)
//
// This is uniform across the cloud and OSS backends, which both populate the
// version lineage the same way.
func classifyPushVersion(version *apiresource.ApiResourceMetadataVersion) (isNew, changed bool) {
	if version == nil {
		return false, true
	}
	if version.GetPreviousVersionId() == "" {
		return true, true
	}
	if version.GetId() == version.GetPreviousVersionId() {
		return false, false
	}
	return false, true
}

// SkillFromGitOptions contains options for pushing a skill from a git repository
type SkillFromGitOptions struct {
	// Directory containing the skill (cloned from git)
	Directory string
	// Organization ID
	OrgID string
	// Tag for the skill version
	Tag string
	// Optional version message describing what changed
	Message string
	// Client is the Stigmer SDK client
	Client *stigmer.Client
	// Quiet mode (suppress detailed output)
	Quiet bool
	// Git repository URL
	GitURL string
	// Git reference (tag, branch, or commit SHA)
	GitRef string
	// Subdirectory within the git repository
	GitSubdir string
	// Ignore configures file filtering during artifact creation.
	// If nil, DefaultIgnoreOptions() is used.
	Ignore *IgnoreOptions
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
		climsg.Info("Skill name: %s (from SKILL.md)", skillName)
	}

	// Step 3: Create zip artifact with intelligent filtering
	ignoreOpts := DefaultIgnoreOptions()
	if opts.Ignore != nil {
		ignoreOpts = *opts.Ignore
	}

	if !opts.Quiet {
		climsg.Info("Creating skill artifact...")
		if ignoreOpts.Verbose {
			climsg.Info("Filtering files with ignore patterns...")
		}
	}

	zipBuffer := new(bytes.Buffer)
	stats, err := createSkillZip(opts.Directory, zipBuffer, ignoreOpts)
	if err != nil {
		return nil, errors.Wrap(err, "failed to create skill artifact")
	}

	if !opts.Quiet {
		climsg.Success("Artifact created (%s)", formatBytes(stats.TotalSize))
		climsg.Info("  Files: %d included, %d ignored", stats.FilesIncluded, stats.FilesIgnored)
		if stats.DirsSkipped > 0 {
			climsg.Info("  Skipped: %d directories", stats.DirsSkipped)
		}
	}

	// Step 4: Calculate SHA256 hash
	zipBytes := zipBuffer.Bytes()
	hash := sha256.Sum256(zipBytes)
	hashHex := fmt.Sprintf("%x", hash)

	if !opts.Quiet {
		climsg.Info("Version hash: %s", hashHex[:16]+"...") // Show first 16 chars
	}

	// Step 5: Collect git provenance (auto-detect from local git repo)
	gitProvenance := collectGitProvenance(opts.Directory, opts.Quiet)

	// Step 6: Upload to backend
	if !opts.Quiet {
		climsg.Info("Uploading skill artifact...")
	}

	// Default tag to "latest" if not provided
	tag := opts.Tag
	if tag == "" {
		tag = "latest"
	}

	response, err := opts.Client.Skill.Push(context.Background(), &skillv1.PushSkillRequest{
		Org:           opts.OrgID,
		Artifact:      zipBytes,
		Tag:           tag,
		GitProvenance: gitProvenance,
		Message:       opts.Message,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to upload skill artifact")
	}

	if !opts.Quiet {
		climsg.Success("✓ Skill artifact uploaded successfully")
		climsg.Info("  Version hash: %s", response.Status.VersionHash)
		if response.Spec.Tag != "" {
			climsg.Info("  Tag: %s", response.Spec.Tag)
		}
	}

	isNew, changed := classifyPushVersion(response.GetMetadata().GetVersion())
	return &SkillArtifactResult{
		ID:             response.Metadata.Id,
		SkillName:      skillName,
		Slug:           response.Metadata.Slug,
		VersionHash:    response.Status.VersionHash,
		StorageKey:     response.Status.ArtifactStorageKey,
		Tag:            response.Spec.Tag,
		Message:        opts.Message,
		ArtifactSize:   stats.TotalSize,
		IsNewResource:  isNew,
		VersionChanged: changed,
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
		climsg.Info("Skill name: %s (from SKILL.md)", skillName)
	}

	// Step 3: Create zip artifact with intelligent filtering
	ignoreOpts := DefaultIgnoreOptions()
	if opts.Ignore != nil {
		ignoreOpts = *opts.Ignore
	}

	if !opts.Quiet {
		climsg.Info("Creating skill artifact...")
		if ignoreOpts.Verbose {
			climsg.Info("Filtering files with ignore patterns...")
		}
	}

	zipBuffer := new(bytes.Buffer)
	stats, err := createSkillZip(opts.Directory, zipBuffer, ignoreOpts)
	if err != nil {
		return nil, errors.Wrap(err, "failed to create skill artifact")
	}

	if !opts.Quiet {
		climsg.Success("Artifact created (%s)", formatBytes(stats.TotalSize))
		climsg.Info("  Files: %d included, %d ignored", stats.FilesIncluded, stats.FilesIgnored)
		if stats.DirsSkipped > 0 {
			climsg.Info("  Skipped: %d directories", stats.DirsSkipped)
		}
	}

	// Step 4: Calculate SHA256 hash
	zipBytes := zipBuffer.Bytes()
	hash := sha256.Sum256(zipBytes)
	hashHex := fmt.Sprintf("%x", hash)

	if !opts.Quiet {
		climsg.Info("Version hash: %s", hashHex[:16]+"...")
	}

	// Step 5: Create GitProvenance for source tracking
	// Resolve the ref to a commit SHA from the cloned directory
	commit, err := getGitCommit(opts.Directory)
	if err != nil {
		return nil, errors.Wrap(err, "failed to get commit SHA from cloned repository")
	}

	gitProvenance := &skillv1.GitProvenance{
		RemoteUrl: opts.GitURL,
		Ref:       opts.GitRef, // Original user-provided ref (for display)
		Commit:    commit,      // Resolved immutable commit SHA
		Subdir:    opts.GitSubdir,
	}

	if !opts.Quiet {
		climsg.Info("Source: git repository")
		climsg.Info("  URL: %s", opts.GitURL)
		if opts.GitRef != "" {
			climsg.Info("  Ref: %s", opts.GitRef)
		}
		climsg.Info("  Commit: %s", commit[:min(12, len(commit))])
		if opts.GitSubdir != "" {
			climsg.Info("  Subdir: %s", opts.GitSubdir)
		}
	}

	// Step 6: Upload to backend
	if !opts.Quiet {
		climsg.Info("Uploading skill artifact...")
	}

	// Default tag to "latest" if not provided
	tag := opts.Tag
	if tag == "" {
		tag = "latest"
	}

	response, err := opts.Client.Skill.Push(context.Background(), &skillv1.PushSkillRequest{
		Org:           opts.OrgID,
		Artifact:      zipBytes,
		Tag:           tag,
		GitProvenance: gitProvenance,
		Message:       opts.Message,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to upload skill artifact")
	}

	if !opts.Quiet {
		climsg.Success("✓ Skill artifact uploaded successfully")
		climsg.Info("  Version hash: %s", response.Status.VersionHash)
		if response.Spec.Tag != "" {
			climsg.Info("  Tag: %s", response.Spec.Tag)
		}
	}

	isNew, changed := classifyPushVersion(response.GetMetadata().GetVersion())
	return &SkillArtifactResult{
		ID:             response.Metadata.Id,
		SkillName:      skillName,
		Slug:           response.Metadata.Slug,
		VersionHash:    response.Status.VersionHash,
		StorageKey:     response.Status.ArtifactStorageKey,
		Tag:            response.Spec.Tag,
		Message:        opts.Message,
		ArtifactSize:   stats.TotalSize,
		IsNewResource:  isNew,
		VersionChanged: changed,
	}, nil
}

// createSkillZip creates a zip archive of the skill directory with intelligent filtering.
// It uses the ignore package for gitignore-compatible pattern matching with layered precedence.
//
// Returns ZipStats containing detailed information about what was included/excluded.
func createSkillZip(sourceDir string, zipWriter io.Writer, opts IgnoreOptions) (*ZipStats, error) {
	// Create the ignore matcher with configured options
	matcher, err := ignore.New(ignore.Options{
		RootDir:          sourceDir,
		RespectGitignore: opts.RespectGitignore,
		IncludeDefaults:  true, // Always include security defaults
		ExtraIgnore:      opts.ExtraIgnore,
		ExtraInclude:     opts.ExtraInclude,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to create ignore matcher")
	}

	// Initialize statistics
	stats := &ZipStats{
		IgnoredBySource: make(map[string]int),
	}

	zipArchive := zip.NewWriter(zipWriter)
	defer zipArchive.Close()

	// Walk through the directory
	err = filepath.Walk(sourceDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Get relative path (normalized to forward slashes for cross-platform consistency)
		relPath, err := filepath.Rel(sourceDir, path)
		if err != nil {
			return errors.Wrapf(err, "failed to get relative path for %s", path)
		}

		// Normalize to forward slashes for consistent pattern matching
		relPath = filepath.ToSlash(relPath)

		// Skip the root directory itself
		if relPath == "." {
			return nil
		}

		// Check if this path should be ignored
		if info.IsDir() {
			result := matcher.MatchWithReason(relPath, true)
			if result.Ignored {
				stats.DirsSkipped++
				if result.Source != "" {
					stats.IgnoredBySource[result.Source]++
				}
				if opts.Verbose {
					climsg.Info("  SKIP DIR  %s/ (%s)", relPath, result.Reason)
				}
				return filepath.SkipDir // Skip entire directory tree for performance
			}
			return nil // Continue into directory
		}

		// Check file against ignore patterns
		result := matcher.MatchWithReason(relPath, false)
		if result.Ignored {
			stats.FilesIgnored++
			if result.Source != "" {
				stats.IgnoredBySource[result.Source]++
			}
			if opts.Verbose {
				climsg.Info("  IGNORE    %s (%s)", relPath, result.Reason)
			}
			return nil // Skip this file
		}

		if opts.Verbose {
			climsg.Info("  INCLUDE   %s", relPath)
		}

		// Create zip entry with forward slashes (ZIP standard)
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

		stats.FilesIncluded++
		stats.TotalSize += size
		return nil
	})

	if err != nil {
		return nil, err
	}

	return stats, nil
}

// DryRunAnalysis contains the results of a dry-run analysis.
// This shows what would happen during artifact creation without actually creating it.
type DryRunAnalysis struct {
	// Stats contains the same statistics that would be returned from createSkillZip.
	Stats *ZipStats

	// PatternSources describes the pattern sources being used.
	// Format: "source (N patterns)"
	PatternSources []string

	// SampleIgnored contains up to 10 sample ignored files with reasons.
	SampleIgnored []string

	// SampleIncluded contains up to 10 sample included files.
	SampleIncluded []string
}

// AnalyzeDryRun performs a dry-run analysis of what would be included/excluded.
// This walks the directory and applies ignore patterns without creating an artifact.
func AnalyzeDryRun(sourceDir string, opts IgnoreOptions) (*DryRunAnalysis, error) {
	// Create the ignore matcher
	matcher, err := ignore.New(ignore.Options{
		RootDir:          sourceDir,
		RespectGitignore: opts.RespectGitignore,
		IncludeDefaults:  true,
		ExtraIgnore:      opts.ExtraIgnore,
		ExtraInclude:     opts.ExtraInclude,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to create ignore matcher")
	}

	analysis := &DryRunAnalysis{
		Stats: &ZipStats{
			IgnoredBySource: make(map[string]int),
		},
	}

	// Describe pattern sources
	patterns := matcher.Patterns()
	sourceCounts := make(map[string]int)
	for _, p := range patterns {
		// Pattern format is "[source] pattern"
		if len(p) > 2 && p[0] == '[' {
			end := strings.Index(p, "]")
			if end > 0 {
				source := p[1:end]
				sourceCounts[source]++
			}
		}
	}
	for source, count := range sourceCounts {
		analysis.PatternSources = append(analysis.PatternSources, fmt.Sprintf("%s (%d patterns)", source, count))
	}

	// Walk and analyze
	err = filepath.Walk(sourceDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors gracefully in dry-run
		}

		relPath, err := filepath.Rel(sourceDir, path)
		if err != nil {
			return nil
		}
		relPath = filepath.ToSlash(relPath)

		if relPath == "." {
			return nil
		}

		if info.IsDir() {
			result := matcher.MatchWithReason(relPath, true)
			if result.Ignored {
				analysis.Stats.DirsSkipped++
				if result.Source != "" {
					analysis.Stats.IgnoredBySource[result.Source]++
				}
				if len(analysis.SampleIgnored) < 10 {
					analysis.SampleIgnored = append(analysis.SampleIgnored,
						fmt.Sprintf("%s/ (%s)", relPath, result.Reason))
				}
				return filepath.SkipDir
			}
			return nil
		}

		result := matcher.MatchWithReason(relPath, false)
		if result.Ignored {
			analysis.Stats.FilesIgnored++
			if result.Source != "" {
				analysis.Stats.IgnoredBySource[result.Source]++
			}
			if len(analysis.SampleIgnored) < 10 {
				analysis.SampleIgnored = append(analysis.SampleIgnored,
					fmt.Sprintf("%s (%s)", relPath, result.Reason))
			}
		} else {
			analysis.Stats.FilesIncluded++
			analysis.Stats.TotalSize += info.Size()
			if len(analysis.SampleIncluded) < 10 {
				analysis.SampleIncluded = append(analysis.SampleIncluded, relPath)
			}
		}
		return nil
	})

	if err != nil {
		return nil, err
	}

	return analysis, nil
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

// collectGitProvenance detects git information and creates GitProvenance for local pushes.
// If the directory is within a git repo, it collects remote URL, commit SHA, branch/ref, and subdir.
// Returns nil if the directory is not a git repository.
func collectGitProvenance(directory string, quiet bool) *skillv1.GitProvenance {
	// Check if we're in a git repo
	repoRoot, err := getGitRepoRoot(directory)
	if err != nil {
		// Not a git repo, no provenance to track
		if !quiet {
			climsg.Info("Source: local directory (not a git repository)")
		}
		return nil
	}

	provenance := &skillv1.GitProvenance{}

	// Get git remote URL (origin)
	if remoteURL, err := getGitRemoteURL(directory); err == nil && remoteURL != "" {
		provenance.RemoteUrl = remoteURL
	} else {
		// No remote URL means we can't provide meaningful provenance
		if !quiet {
			climsg.Info("Source: local git repository (no remote)")
		}
		return nil
	}

	// Get current commit SHA (required for provenance)
	if commit, err := getGitCommit(directory); err == nil && commit != "" {
		provenance.Commit = commit
	}

	// Get current branch name (for display purposes)
	if ref, err := getGitBranchName(directory); err == nil && ref != "" {
		provenance.Ref = ref
	}

	// Calculate subdir relative to repo root
	absDir, err := filepath.Abs(directory)
	if err == nil {
		relPath, err := filepath.Rel(repoRoot, absDir)
		if err == nil && relPath != "." {
			provenance.Subdir = relPath
		}
	}

	if !quiet {
		climsg.Info("Source: git repository")
		climsg.Info("  Remote: %s", provenance.RemoteUrl)
		if provenance.Ref != "" {
			climsg.Info("  Branch: %s", provenance.Ref)
		}
		if provenance.Commit != "" {
			climsg.Info("  Commit: %s", provenance.Commit[:min(12, len(provenance.Commit))])
		}
		if provenance.Subdir != "" {
			climsg.Info("  Subdir: %s", provenance.Subdir)
		}
	}

	return provenance
}

// getGitBranchName returns the current branch name.
// Returns empty string if in detached HEAD state or on error.
func getGitBranchName(directory string) (string, error) {
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = directory
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}
	branch := strings.TrimSpace(string(output))
	// "HEAD" means detached HEAD state
	if branch == "HEAD" {
		return "", nil
	}
	return branch, nil
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
