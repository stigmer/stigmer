package ignore

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

const (
	// SourceDefaults is the source name for built-in default patterns.
	SourceDefaults = "defaults"

	// SourceGitignore is the source name for .gitignore patterns.
	SourceGitignore = ".gitignore"

	// SourceStigmerignore is the source name for .stigmerignore patterns.
	SourceStigmerignore = ".stigmerignore"

	// SourceCLI is the source name for command-line patterns.
	SourceCLI = "cli"
)

// loadDefaultPatterns returns the built-in security-first patterns.
func loadDefaultPatterns() []patternEntry {
	return parsePatterns(DefaultPatterns, SourceDefaults, nil)
}

// loadGitignore reads and parses the .gitignore file in the given directory.
// Returns an empty slice if the file doesn't exist or can't be read.
// Parse errors for individual patterns are silently skipped (lenient like Git).
func loadGitignore(rootDir string) []patternEntry {
	return loadIgnoreFile(filepath.Join(rootDir, ".gitignore"), SourceGitignore)
}

// loadStigmerignore reads and parses the .stigmerignore file in the given directory.
// Returns an empty slice if the file doesn't exist or can't be read.
// Parse errors for individual patterns are silently skipped.
func loadStigmerignore(rootDir string) []patternEntry {
	return loadIgnoreFile(filepath.Join(rootDir, ".stigmerignore"), SourceStigmerignore)
}

// loadIgnoreFile reads and parses an ignore file (gitignore or stigmerignore).
// Returns an empty slice if the file doesn't exist or can't be read.
func loadIgnoreFile(path string, source string) []patternEntry {
	file, err := os.Open(path)
	if err != nil {
		// File doesn't exist or can't be read - this is normal
		return nil
	}
	defer file.Close()

	var patterns []string
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		// Keep all lines, parsePatterns will handle comments and blanks
		patterns = append(patterns, line)
	}

	if err := scanner.Err(); err != nil {
		// Read error - return empty
		return nil
	}

	return parsePatterns(patterns, source, nil)
}

// loadCLIPatterns parses patterns provided via command-line flags.
// ignore patterns are used as-is, include patterns are converted to negations.
func loadCLIPatterns(ignore []string, include []string) []patternEntry {
	// First add ignore patterns
	entries := parsePatterns(ignore, SourceCLI, nil)

	// Then add include patterns as negations (higher priority)
	// Convert each pattern to a negation if it isn't already
	includeNegations := make([]string, 0, len(include))
	for _, pattern := range include {
		trimmed := strings.TrimSpace(pattern)
		if trimmed == "" {
			continue
		}
		// If not already a negation, prepend !
		if !strings.HasPrefix(trimmed, "!") {
			trimmed = "!" + trimmed
		}
		includeNegations = append(includeNegations, trimmed)
	}

	entries = append(entries, parsePatterns(includeNegations, SourceCLI, nil)...)

	return entries
}
