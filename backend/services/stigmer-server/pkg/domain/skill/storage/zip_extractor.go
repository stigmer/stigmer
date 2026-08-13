package storage

import (
	"bytes"
	"fmt"
	"io"
	"strings"

	"github.com/google/safearchive/zip"
)

// Security limits for ZIP files
const (
	// MaxZipSize is the compressed-artifact ceiling. Exported because it is
	// the platform's skill size limit, not just an extraction guard: the
	// transfer lane (createArtifactUploadUrl) enforces it before any bytes
	// move, and clients quote it in fail-loud size errors (#675).
	MaxZipSize = 100 * 1024 * 1024 // 100MB compressed

	maxZipSize          = MaxZipSize
	maxUncompressedSize = 500 * 1024 * 1024 // 500MB uncompressed
	maxCompressionRatio = 100               // Max 100:1 compression ratio
	maxFiles            = 10000             // Max number of files in ZIP
	maxSkillMdSize      = 1 * 1024 * 1024   // 1MB for SKILL.md
)

// ExtractSkillMdResult contains the extracted SKILL.md content and parsed metadata.
type ExtractSkillMdResult struct {
	// Content is the full SKILL.md file content (including frontmatter).
	Content string

	// Hash is the SHA256 hash of the ZIP content for content-addressable storage.
	Hash string

	// Name is the skill identifier extracted from YAML frontmatter (kebab-case).
	Name string

	// Description is the human-readable summary extracted from YAML frontmatter.
	Description string
}

// ExtractSkillMd safely extracts SKILL.md from a ZIP archive and parses its metadata.
// This function implements multiple security measures:
// 1. Uses google/safearchive to prevent path traversal and symlink attacks
// 2. Validates ZIP size and compression ratios to prevent ZIP bombs
// 3. Extracts SKILL.md content IN MEMORY (never writes to disk)
// 4. Limits SKILL.md size to prevent memory exhaustion
// 5. Validates that SKILL.md exists in the archive
// 6. Parses YAML frontmatter to extract name and description
//
// Returns:
// - ExtractSkillMdResult with SKILL.md content, hash, name, and description
// - Error if validation fails, SKILL.md is not found, or frontmatter is invalid
func ExtractSkillMd(zipData []byte) (*ExtractSkillMdResult, error) {
	// 1. Validate ZIP size (prevent huge uploads)
	if len(zipData) > maxZipSize {
		return nil, fmt.Errorf("ZIP file too large: %d bytes (max: %d)", len(zipData), maxZipSize)
	}

	// 2. Calculate hash (for content-addressable storage)
	hash := CalculateHash(zipData)

	// 3. Open ZIP reader with safearchive (prevents path traversal, symlinks)
	reader, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		return nil, fmt.Errorf("invalid ZIP file: %w", err)
	}

	// 4. Enable maximum security mode (all protections)
	reader.SetSecurityMode(zip.MaximumSecurityMode)

	// 5. Validate ZIP content (bomb protection, file count)
	if err := validateZipContent(reader); err != nil {
		return nil, err
	}

	// 6. Extract SKILL.md content (in memory only)
	skillMdContent, err := extractSkillMdContent(reader)
	if err != nil {
		return nil, err
	}

	// 7. Parse YAML frontmatter to extract name and description
	frontmatter, err := ParseFrontmatter(skillMdContent)
	if err != nil {
		return nil, fmt.Errorf("invalid SKILL.md frontmatter: %w", err)
	}

	return &ExtractSkillMdResult{
		Content:     skillMdContent,
		Hash:        hash,
		Name:        frontmatter.Name,
		Description: frontmatter.Description,
	}, nil
}

// validateZipContent performs security validation on the ZIP archive.
// This prevents ZIP bomb attacks and ensures reasonable file counts.
func validateZipContent(reader *zip.Reader) error {
	if len(reader.File) == 0 {
		return fmt.Errorf("ZIP file is empty")
	}

	if len(reader.File) > maxFiles {
		return fmt.Errorf("too many files in ZIP: %d (max: %d)", len(reader.File), maxFiles)
	}

	var totalUncompressedSize uint64
	hasSkillMd := false
	hasNestedSkillMd := false

	for _, file := range reader.File {
		// SKILL.md must be at the archive root. Nested occurrences are tracked
		// only to make the rejection actionable (see below).
		if file.Name == "SKILL.md" {
			hasSkillMd = true
		} else if strings.HasSuffix(file.Name, "/SKILL.md") {
			hasNestedSkillMd = true
		}

		// Validate filename characters (prevent null bytes, control characters)
		for _, r := range file.Name {
			if r < 32 || r == 127 {
				return fmt.Errorf("invalid character in filename: %s", file.Name)
			}
		}

		// Track total uncompressed size (fail fast once limit exceeded)
		totalUncompressedSize += file.UncompressedSize64
		if totalUncompressedSize > maxUncompressedSize {
			return fmt.Errorf("total uncompressed size too large: %d bytes (max: %d)",
				totalUncompressedSize, maxUncompressedSize)
		}

		// Check compression ratio per file (prevent ZIP bombs)
		if file.CompressedSize64 > 0 {
			ratio := file.UncompressedSize64 / file.CompressedSize64
			if ratio > maxCompressionRatio {
				return fmt.Errorf("suspicious compression ratio in %s: %d:1 (max: %d:1)",
					file.Name, ratio, maxCompressionRatio)
			}
		}
	}

	// Ensure SKILL.md exists at the archive root. A nested-only SKILL.md is
	// the "zipped the folder instead of its contents" mistake: the runner
	// extracts entry paths verbatim when materializing a skill, so accepting
	// nested placement would land every supporting file one directory too
	// deep and break the skill silently at runtime (stigmer#452). The hint
	// teaches the fix; its text is byte-identical to the cloud edition's.
	if !hasSkillMd {
		if hasNestedSkillMd {
			return fmt.Errorf("SKILL.md must be at the archive root — zip the skill folder's contents, not the folder itself")
		}
		return fmt.Errorf("SKILL.md not found in ZIP archive")
	}

	return nil
}

// extractSkillMdContent extracts the SKILL.md file content from the ZIP.
// This function reads the content IN MEMORY only (never writes to disk).
// Size is limited to maxSkillMdSize to prevent memory exhaustion.
func extractSkillMdContent(reader *zip.Reader) (string, error) {
	for _, file := range reader.File {
		if file.Name == "SKILL.md" {
			// Open the file from the ZIP
			rc, err := file.Open()
			if err != nil {
				return "", fmt.Errorf("failed to open SKILL.md: %w", err)
			}
			defer rc.Close()

			// Read content with size limit (prevent memory exhaustion)
			limitedReader := io.LimitReader(rc, maxSkillMdSize)
			content, err := io.ReadAll(limitedReader)
			if err != nil {
				return "", fmt.Errorf("failed to read SKILL.md: %w", err)
			}

			// Check if we hit the size limit
			if len(content) == maxSkillMdSize {
				// Try to read one more byte to see if there's more content
				extraByte := make([]byte, 1)
				if _, err := rc.Read(extraByte); err != io.EOF {
					return "", fmt.Errorf("SKILL.md too large (max: %d bytes)", maxSkillMdSize)
				}
			}

			if len(content) == 0 {
				return "", fmt.Errorf("SKILL.md is empty")
			}

			return string(content), nil
		}
	}

	return "", fmt.Errorf("SKILL.md not found in ZIP archive")
}

// ValidateZipFile performs pre-checks on ZIP data before processing.
// This is a lightweight check that can be done before heavier operations.
func ValidateZipFile(zipData []byte) error {
	if len(zipData) == 0 {
		return fmt.Errorf("ZIP file is empty")
	}

	if len(zipData) > maxZipSize {
		return fmt.Errorf("ZIP file too large: %d bytes (max: %d)", len(zipData), maxZipSize)
	}

	// Try to open as ZIP (basic format check)
	_, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		return fmt.Errorf("invalid ZIP file format: %w", err)
	}

	return nil
}
