package artifact

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/pkg/errors"
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

	// Step 2: Get skill name from directory name
	skillName := filepath.Base(opts.Directory)
	if !opts.Quiet {
		cliprint.PrintInfo("Skill name: %s", skillName)
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

	// Step 5: Upload to backend
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
		Name:     skillName,
		Scope:    apiresource.ApiResourceOwnerScope_organization,
		Org:      opts.OrgID,
		Artifact: zipBytes,
		Tag:      tag,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to upload skill artifact")
	}

	if !opts.Quiet {
		cliprint.PrintSuccess("✓ Skill artifact uploaded successfully")
		cliprint.PrintInfo("  Version hash: %s", response.VersionHash)
		if response.Tag != "" {
			cliprint.PrintInfo("  Tag: %s", response.Tag)
		}
	}

	return &SkillArtifactResult{
		SkillName:    skillName,
		VersionHash:  response.VersionHash,
		StorageKey:   response.ArtifactStorageKey,
		Tag:          response.Tag,
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
