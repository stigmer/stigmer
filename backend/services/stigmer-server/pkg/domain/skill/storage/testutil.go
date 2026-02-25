package storage

import (
	"archive/zip"
	"bytes"
	"fmt"
	"math/rand"
	"strings"
)

// ValidSkillContent builds a valid SKILL.md string with proper YAML frontmatter.
// Use this when the test expects the push/extract pipeline to succeed.
//
// Parameters:
//   - name: kebab-case skill identifier (e.g. "calculator", "web-scraper")
//   - body: markdown body that follows the frontmatter (may be empty)
//
// Example:
//
//	content := ValidSkillContent("calculator", "# Calculator\n\nA basic calculator.")
//	// produces: "---\nname: calculator\n---\n# Calculator\n\nA basic calculator."
func ValidSkillContent(name, body string) string {
	return fmt.Sprintf("---\nname: %s\n---\n%s", name, body)
}

// CreateTestZip creates a valid ZIP file with SKILL.md containing the specified content.
// The content is placed into SKILL.md verbatim -- callers are responsible for including
// valid frontmatter when the test expects extraction to succeed. Use ValidSkillContent
// to build content with proper frontmatter.
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
// Files are stored without compression (zip.Store) so that the on-disk ZIP
// size equals the content size, reliably exceeding the compressed-size limit.
//
// Example:
//
//	oversized := CreateOversizedZip(101 * 1024 * 1024) // 101 MB
func CreateOversizedZip(size int) []byte {
	buf := new(bytes.Buffer)
	w := zip.NewWriter(buf)

	// Create SKILL.md (compressed is fine since it's tiny)
	skillMd, err := w.Create("SKILL.md")
	if err != nil {
		panic(fmt.Sprintf("failed to create SKILL.md in oversized ZIP: %v", err))
	}
	if _, err := skillMd.Write([]byte("# Oversized Skill\n")); err != nil {
		panic(fmt.Sprintf("failed to write SKILL.md: %v", err))
	}

	// Store the large file WITHOUT compression so ZIP size ≈ content size.
	header := &zip.FileHeader{Name: "large.bin", Method: zip.Store}
	largeFile, err := w.CreateHeader(header)
	if err != nil {
		panic(fmt.Sprintf("failed to create large file: %v", err))
	}

	chunkSize := 1024 * 1024 // 1MB
	chunk := make([]byte, chunkSize)
	for k := range chunk {
		chunk[k] = byte(k % 256)
	}
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
//
// The content uses PRNG-generated printable characters so DEFLATE compression
// cannot reduce the per-file ratio below the 100:1 safety threshold.
func CreateZipWithOversizedSkillMd() []byte {
	size := 1*1024*1024 + 1000 // 1MB + 1000 bytes
	rng := rand.New(rand.NewSource(99))
	var sb strings.Builder
	sb.WriteString("# Oversized SKILL.md\n")
	for i := 0; i < size; i++ {
		sb.WriteByte(byte(32 + rng.Intn(95))) // random printable ASCII
	}
	return CreateTestZip(sb.String())
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

	// Create multiple files whose content compresses moderately (target ~10:1)
	// so that per-file ratio stays under maxCompressionRatio (100:1) while
	// total compressed ZIP stays under maxZipSize (100MB). Total uncompressed
	// must exceed maxUncompressedSize (500MB).
	//
	// Each 1KB block has 100 bytes of PRNG-generated data (incompressible
	// to DEFLATE) and 924 bytes of zeros (highly compressible). This yields
	// roughly 8-12:1 deflate ratio, well under the 100:1 limit.
	fileCount := 50
	fileSizeEach := 11 * 1024 * 1024 // 11MB each = 550MB total

	const chunkSize = 1024 * 1024
	rng := rand.New(rand.NewSource(42))
	chunk := make([]byte, chunkSize)
	for k := range chunk {
		blockPos := k % 1024
		if blockPos < 100 {
			chunk[k] = byte(rng.Intn(256))
		} else {
			chunk[k] = 0
		}
	}

	for i := 0; i < fileCount; i++ {
		filename := fmt.Sprintf("data_%d.bin", i)
		f, err := w.Create(filename)
		if err != nil {
			panic(fmt.Sprintf("failed to create file %s: %v", filename, err))
		}

		remaining := fileSizeEach
		for remaining > 0 {
			toWrite := chunkSize
			if remaining < chunkSize {
				toWrite = remaining
			}
			if _, err := f.Write(chunk[:toWrite]); err != nil {
				panic(fmt.Sprintf("failed to write to %s: %v", filename, err))
			}
			remaining -= toWrite
		}
	}

	if err := w.Close(); err != nil {
		panic(fmt.Sprintf("failed to close ZIP: %v", err))
	}

	return buf.Bytes()
}
