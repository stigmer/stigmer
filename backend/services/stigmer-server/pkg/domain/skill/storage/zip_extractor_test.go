package storage

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestExtractSkillMd_Success verifies that a valid ZIP with SKILL.md
// extracts correctly and returns the content.
func TestExtractSkillMd_Success(t *testing.T) {
	skillContent := "# Calculator Skill\n\nThis skill performs calculations."
	zipData := CreateTestZip(skillContent)

	result, err := ExtractSkillMd(zipData)
	require.NoError(t, err)
	assert.Equal(t, skillContent, result.Content)
	assert.Len(t, result.Hash, 64, "hash should be 64-character SHA256")
}

// TestExtractSkillMd_ReturnsHash verifies that ExtractSkillMd returns
// the correct SHA256 hash of the ZIP content.
func TestExtractSkillMd_ReturnsHash(t *testing.T) {
	skillContent := "# Test Skill"
	zipData := CreateTestZip(skillContent)

	result, err := ExtractSkillMd(zipData)
	require.NoError(t, err)

	// Verify hash matches what we calculate directly
	expectedHash := CalculateHash(zipData)
	assert.Equal(t, expectedHash, result.Hash)
}

// TestExtractSkillMd_MultipleFiles verifies that extraction works correctly
// when the ZIP contains multiple files in addition to SKILL.md.
func TestExtractSkillMd_MultipleFiles(t *testing.T) {
	skillContent := "# Multi-file Skill"
	zipData := CreateTestZipWithFiles(map[string][]byte{
		"SKILL.md":  []byte(skillContent),
		"script.sh": []byte("#!/bin/bash\necho 'hello'"),
		"helper.py": []byte("def helper():\n    pass"),
		"README.md": []byte("# README"),
	})

	result, err := ExtractSkillMd(zipData)
	require.NoError(t, err)
	assert.Equal(t, skillContent, result.Content)
}

// TestExtractSkillMd_PreservesContent verifies that SKILL.md content is
// extracted exactly as-is, preserving whitespace, newlines, and encoding.
func TestExtractSkillMd_PreservesContent(t *testing.T) {
	// Content with various whitespace and special characters
	skillContent := `# Skill With Special Content

This has:
- Multiple lines
- Tabs:		here
- Unicode: 日本語, émojis 🎉
- Extra spaces:    lots    of    them
- Trailing newline

`
	zipData := CreateTestZip(skillContent)

	result, err := ExtractSkillMd(zipData)
	require.NoError(t, err)
	assert.Equal(t, skillContent, result.Content, "content should be preserved exactly")
}

// TestExtractSkillMd_ZipBomb_HighRatio verifies that ZIPs with compression
// ratio >100:1 are rejected (ZIP bomb protection).
func TestExtractSkillMd_ZipBomb_HighRatio(t *testing.T) {
	// Create a ZIP bomb with 150:1 compression ratio
	zipBomb := CreateZipBomb(150)

	_, err := ExtractSkillMd(zipBomb)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "compression ratio", "should reject high compression ratio")
}

// TestExtractSkillMd_ZipBomb_LargeUncompressed verifies that ZIPs with
// total uncompressed size >500MB are rejected.
func TestExtractSkillMd_ZipBomb_LargeUncompressed(t *testing.T) {
	// This test creates a large ZIP, so we skip it in short mode
	if testing.Short() {
		t.Skip("skipping large ZIP test in short mode")
	}

	zipData := CreateLargeUncompressedZip()

	_, err := ExtractSkillMd(zipData)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "uncompressed size too large")
}

// TestExtractSkillMd_OversizedZip verifies that ZIPs >100MB compressed
// are rejected immediately.
func TestExtractSkillMd_OversizedZip(t *testing.T) {
	// This test creates a 101MB ZIP, so we skip it in short mode
	if testing.Short() {
		t.Skip("skipping oversized ZIP test in short mode")
	}

	oversizedZip := CreateOversizedZip(101 * 1024 * 1024) // 101 MB

	_, err := ExtractSkillMd(oversizedZip)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "ZIP file too large")
}

// TestExtractSkillMd_TooManyFiles verifies that ZIPs with >10000 files
// are rejected (prevents resource exhaustion).
func TestExtractSkillMd_TooManyFiles(t *testing.T) {
	zipData := CreateZipWithManyFiles(10001) // Exceeds limit of 10000

	_, err := ExtractSkillMd(zipData)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "too many files")
}

// TestExtractSkillMd_EmptyZip verifies that empty ZIP files are rejected.
func TestExtractSkillMd_EmptyZip(t *testing.T) {
	// Create a valid ZIP structure but with no files
	zipData := CreateTestZipWithFiles(map[string][]byte{})

	_, err := ExtractSkillMd(zipData)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "empty")
}

// TestExtractSkillMd_NoSkillMd verifies that ZIPs without SKILL.md are rejected.
func TestExtractSkillMd_NoSkillMd(t *testing.T) {
	zipData := CreateZipWithoutSkillMd()

	_, err := ExtractSkillMd(zipData)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "SKILL.md not found")
}

// TestExtractSkillMd_EmptySkillMd verifies that ZIPs with empty SKILL.md
// files are rejected.
func TestExtractSkillMd_EmptySkillMd(t *testing.T) {
	zipData := CreateZipWithEmptySkillMd()

	_, err := ExtractSkillMd(zipData)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "empty")
}

// TestExtractSkillMd_OversizedSkillMd verifies that SKILL.md files >1MB
// are rejected (prevents memory exhaustion).
func TestExtractSkillMd_OversizedSkillMd(t *testing.T) {
	zipData := CreateZipWithOversizedSkillMd()

	_, err := ExtractSkillMd(zipData)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "too large")
}

// TestExtractSkillMd_InvalidFilename verifies that ZIPs with filenames
// containing control characters are rejected.
func TestExtractSkillMd_InvalidFilename(t *testing.T) {
	zipData := CreateZipWithInvalidFilename()

	_, err := ExtractSkillMd(zipData)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid character")
}

// TestExtractSkillMd_InvalidZipFormat verifies that non-ZIP data is rejected.
func TestExtractSkillMd_InvalidZipFormat(t *testing.T) {
	invalidData := []byte("This is not a ZIP file, just plain text")

	_, err := ExtractSkillMd(invalidData)
	require.Error(t, err)
	assert.Contains(t, strings.ToLower(err.Error()), "zip")
}

// TestValidateZipFile_Valid verifies that a valid ZIP passes validation.
func TestValidateZipFile_Valid(t *testing.T) {
	zipData := CreateTestZip("# Valid Skill")

	err := ValidateZipFile(zipData)
	assert.NoError(t, err)
}

// TestValidateZipFile_Empty verifies that empty byte slices are rejected.
func TestValidateZipFile_Empty(t *testing.T) {
	emptyData := []byte{}

	err := ValidateZipFile(emptyData)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "empty")
}

// TestValidateZipFile_Oversized verifies that oversized ZIPs are rejected.
func TestValidateZipFile_Oversized(t *testing.T) {
	// This test creates a large ZIP, so we skip it in short mode
	if testing.Short() {
		t.Skip("skipping oversized ZIP test in short mode")
	}

	oversizedZip := CreateOversizedZip(101 * 1024 * 1024) // 101 MB

	err := ValidateZipFile(oversizedZip)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "too large")
}

// TestValidateZipFile_InvalidFormat verifies that non-ZIP data is rejected.
func TestValidateZipFile_InvalidFormat(t *testing.T) {
	invalidData := []byte("Not a ZIP file at all")

	err := ValidateZipFile(invalidData)
	require.Error(t, err)
	assert.Contains(t, strings.ToLower(err.Error()), "zip")
}
