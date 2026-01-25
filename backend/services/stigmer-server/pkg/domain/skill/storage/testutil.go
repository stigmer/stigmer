package storage

import (
	"archive/zip"
	"bytes"
	"fmt"
	"strings"
)

// CreateTestZip creates a valid ZIP file with SKILL.md containing the specified content.
// This is the primary helper for creating test artifacts in a valid format.
func CreateTestZip(skillMdContent string) []byte {
	return CreateTestZipWithFiles(map[string][]byte{
		"SKILL.md": []byte(skillMdContent),
	})
}

// CreateTestZipWithFiles creates a ZIP file with the specified files.
// This allows creating ZIPs with multiple files for testing extraction logic.
//
// Example:
//
//	zip := CreateTestZipWithFiles(map[string][]byte{
//	    "SKILL.md": []byte("# My Skill"),
//	    "script.sh": []byte("#!/bin/bash\necho 'hello'"),
//	})
func CreateTestZipWithFiles(files map[string][]byte) []byte {
	buf := new(bytes.Buffer)
	w := zip.NewWriter(buf)

	for name, content := range files {
		f, err := w.Create(name)
		if err != nil {
			panic(fmt.Sprintf("failed to create file in test ZIP: %v", err))
		}
		if _, err := f.Write(content); err != nil {
			panic(fmt.Sprintf("failed to write file in test ZIP: %v", err))
		}
	}

	if err := w.Close(); err != nil {
		panic(fmt.Sprintf("failed to close test ZIP: %v", err))
	}

	return buf.Bytes()
}

// CreateZipBomb creates a ZIP with an extreme compression ratio to test ZIP bomb protection.
// The ratio parameter specifies the approximate uncompressed:compressed ratio.
//
// This creates a file with highly compressible content (repeated characters) that will
// trigger security checks if the ratio exceeds maxCompressionRatio (100:1).
//
// Example:
//
//	bomb := CreateZipBomb(150) // Creates a 150:1 compression ratio
func CreateZipBomb(ratio int) []byte {
	buf := new(bytes.Buffer)
	w := zip.NewWriter(buf)

	// Create SKILL.md first (required)
	skillMd, err := w.Create("SKILL.md")
	if err != nil {
		panic(fmt.Sprintf("failed to create SKILL.md in ZIP bomb: %v", err))
	}
	if _, err := skillMd.Write([]byte("# Bomb Skill\n")); err != nil {
		panic(fmt.Sprintf("failed to write SKILL.md in ZIP bomb: %v", err))
	}

	// Create a highly compressible file (repeated 'A' characters)
	// This will achieve a high compression ratio
	bombFile, err := w.Create("bomb.txt")
	if err != nil {
		panic(fmt.Sprintf("failed to create bomb file in ZIP: %v", err))
	}

	// Write highly compressible content (repeated characters compress very well)
	// Size is calibrated to achieve the desired ratio
	// Typical ZIP compression on repeated chars: 1000:1 or better
	// So we need size = ratio * 1000 to get roughly the desired ratio
	size := ratio * 1000
	content := strings.Repeat("A", size)
	if _, err := bombFile.Write([]byte(content)); err != nil {
		panic(fmt.Sprintf("failed to write bomb content: %v", err))
	}

	if err := w.Close(); err != nil {
		panic(fmt.Sprintf("failed to close ZIP bomb: %v", err))
	}

	return buf.Bytes()
}

// CreateOversizedZip creates a ZIP file exceeding the specified size in bytes.
// This tests the maxZipSize validation (100MB limit).
//
// Example:
//
//	oversized := CreateOversizedZip(101 * 1024 * 1024) // 101 MB
func CreateOversizedZip(size int) []byte {
	buf := new(bytes.Buffer)
	w := zip.NewWriter(buf)

	// Create SKILL.md
	skillMd, err := w.Create("SKILL.md")
	if err != nil {
		panic(fmt.Sprintf("failed to create SKILL.md in oversized ZIP: %v", err))
	}
	if _, err := skillMd.Write([]byte("# Oversized Skill\n")); err != nil {
		panic(fmt.Sprintf("failed to write SKILL.md: %v", err))
	}

	// Create a large file to exceed the size limit
	// We need to account for ZIP overhead, so we make it slightly larger
	largeFile, err := w.Create("large.bin")
	if err != nil {
		panic(fmt.Sprintf("failed to create large file: %v", err))
	}

	// Write in chunks to avoid allocating huge memory at once
	chunkSize := 1024 * 1024 // 1MB chunks
	chunk := bytes.Repeat([]byte("X"), chunkSize)
	remaining := size

	for remaining > 0 {
		toWrite := chunkSize
		if remaining < chunkSize {
			toWrite = remaining
		}
		if _, err := largeFile.Write(chunk[:toWrite]); err != nil {
			panic(fmt.Sprintf("failed to write large file content: %v", err))
		}
		remaining -= toWrite
	}

	if err := w.Close(); err != nil {
		panic(fmt.Sprintf("failed to close oversized ZIP: %v", err))
	}

	return buf.Bytes()
}

// CreateZipWithManyFiles creates a ZIP with the specified number of files.
// This tests the maxFiles validation (10000 file limit).
//
// Example:
//
//	manyFiles := CreateZipWithManyFiles(10001) // Exceeds limit
func CreateZipWithManyFiles(fileCount int) []byte {
	buf := new(bytes.Buffer)
	w := zip.NewWriter(buf)

	// Create SKILL.md first
	skillMd, err := w.Create("SKILL.md")
	if err != nil {
		panic(fmt.Sprintf("failed to create SKILL.md: %v", err))
	}
	if _, err := skillMd.Write([]byte("# Many Files Skill\n")); err != nil {
		panic(fmt.Sprintf("failed to write SKILL.md: %v", err))
	}

	// Create remaining files
	for i := 1; i < fileCount; i++ {
		filename := fmt.Sprintf("file_%d.txt", i)
		f, err := w.Create(filename)
		if err != nil {
			panic(fmt.Sprintf("failed to create file %s: %v", filename, err))
		}
		content := fmt.Sprintf("File %d content\n", i)
		if _, err := f.Write([]byte(content)); err != nil {
			panic(fmt.Sprintf("failed to write file %s: %v", filename, err))
		}
	}

	if err := w.Close(); err != nil {
		panic(fmt.Sprintf("failed to close ZIP: %v", err))
	}

	return buf.Bytes()
}

// CreateZipWithoutSkillMd creates a ZIP file that does NOT contain SKILL.md.
// This tests that extraction rejects ZIPs missing the required SKILL.md file.
func CreateZipWithoutSkillMd() []byte {
	return CreateTestZipWithFiles(map[string][]byte{
		"README.md": []byte("# This is not SKILL.md"),
		"script.sh": []byte("#!/bin/bash\necho 'missing SKILL.md'"),
	})
}

// CreateZipWithEmptySkillMd creates a ZIP with an empty SKILL.md file.
// This tests that extraction rejects empty SKILL.md content.
func CreateZipWithEmptySkillMd() []byte {
	return CreateTestZip("")
}

// CreateZipWithOversizedSkillMd creates a ZIP where SKILL.md exceeds 1MB.
// This tests the maxSkillMdSize validation.
func CreateZipWithOversizedSkillMd() []byte {
	// Create SKILL.md content > 1MB
	size := 1*1024*1024 + 1000 // 1MB + 1000 bytes
	content := "# Oversized SKILL.md\n" + strings.Repeat("A", size)
	return CreateTestZip(content)
}

// CreateZipWithInvalidFilename creates a ZIP with a filename containing control characters.
// This tests filename validation that rejects control characters.
func CreateZipWithInvalidFilename() []byte {
	return CreateTestZipWithFiles(map[string][]byte{
		"SKILL.md":         []byte("# Valid Skill"),
		"file\x00name.txt": []byte("Invalid filename with null byte"),
	})
}

// CreateLargeUncompressedZip creates a ZIP that exceeds the uncompressed size limit (500MB).
// This tests the maxUncompressedSize validation without triggering compression ratio checks.
func CreateLargeUncompressedZip() []byte {
	buf := new(bytes.Buffer)
	w := zip.NewWriter(buf)

	// Create SKILL.md
	skillMd, err := w.Create("SKILL.md")
	if err != nil {
		panic(fmt.Sprintf("failed to create SKILL.md: %v", err))
	}
	if _, err := skillMd.Write([]byte("# Large Uncompressed Skill\n")); err != nil {
		panic(fmt.Sprintf("failed to write SKILL.md: %v", err))
	}

	// Create multiple files with random-like content (doesn't compress well)
	// to avoid triggering compression ratio checks
	fileCount := 50
	fileSizeEach := 11 * 1024 * 1024 // 11MB each = 550MB total

	for i := 0; i < fileCount; i++ {
		filename := fmt.Sprintf("data_%d.bin", i)
		f, err := w.Create(filename)
		if err != nil {
			panic(fmt.Sprintf("failed to create file %s: %v", filename, err))
		}

		// Write pseudo-random content (varying bytes don't compress well)
		// This ensures we hit uncompressed size limit without compression ratio issues
		for j := 0; j < fileSizeEach; j++ {
			b := byte(j % 256)
			if _, err := f.Write([]byte{b}); err != nil {
				panic(fmt.Sprintf("failed to write to %s: %v", filename, err))
			}
		}
	}

	if err := w.Close(); err != nil {
		panic(fmt.Sprintf("failed to close ZIP: %v", err))
	}

	return buf.Bytes()
}
