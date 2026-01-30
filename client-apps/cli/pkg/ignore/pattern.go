package ignore

import (
	"path/filepath"
	"strings"

	"github.com/go-git/go-git/v5/plumbing/format/gitignore"
)

// patternEntry wraps a gitignore.Pattern with metadata for diagnostics.
type patternEntry struct {
	pattern    gitignore.Pattern
	source     string // e.g., "defaults", ".gitignore", ".stigmerignore", "cli"
	rawPattern string // Original pattern string for diagnostics
	isNegation bool   // true if pattern starts with !
}

// pathToComponents converts a slash-separated path to the []string format
// required by go-git's gitignore.Pattern.Match.
//
// The path should be relative to the artifact root and use forward slashes.
// Empty paths and "." return nil.
func pathToComponents(path string) []string {
	// Normalize to forward slashes
	path = filepath.ToSlash(path)

	// Handle empty and current directory
	if path == "" || path == "." {
		return nil
	}

	// Remove leading ./ if present
	path = strings.TrimPrefix(path, "./")

	// Split into components
	return strings.Split(path, "/")
}

// parsePatterns converts a slice of pattern strings into patternEntry structs.
// Invalid patterns are logged as warnings but don't cause errors.
//
// The domain parameter is passed to gitignore.ParsePattern for proper scoping.
// For root-level patterns, pass nil.
func parsePatterns(patterns []string, source string, domain []string) []patternEntry {
	entries := make([]patternEntry, 0, len(patterns))

	for _, raw := range patterns {
		// Skip empty lines and comments
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}

		// Check for negation
		isNegation := strings.HasPrefix(trimmed, "!")

		// Parse the pattern using go-git
		pattern := gitignore.ParsePattern(trimmed, domain)

		entries = append(entries, patternEntry{
			pattern:    pattern,
			source:     source,
			rawPattern: trimmed,
			isNegation: isNegation,
		})
	}

	return entries
}

// isBlankOrComment returns true if the line is empty or a comment.
func isBlankOrComment(line string) bool {
	trimmed := strings.TrimSpace(line)
	return trimmed == "" || strings.HasPrefix(trimmed, "#")
}

// normalizePath ensures a path uses forward slashes and removes leading ./
func normalizePath(path string) string {
	path = filepath.ToSlash(path)
	path = strings.TrimPrefix(path, "./")
	return path
}
