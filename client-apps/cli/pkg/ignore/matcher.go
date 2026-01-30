package ignore

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/go-git/go-git/v5/plumbing/format/gitignore"
)

// Options configures how the Matcher is constructed.
type Options struct {
	// RootDir is the artifact root directory (required).
	// This is where .gitignore and .stigmerignore files are looked for.
	RootDir string

	// RespectGitignore enables loading patterns from .gitignore.
	// Defaults to true if not explicitly set via NewWithDefaults.
	RespectGitignore bool

	// IncludeDefaults enables built-in security patterns.
	// Defaults to true if not explicitly set via NewWithDefaults.
	IncludeDefaults bool

	// ExtraIgnore contains additional patterns to ignore (e.g., from CLI --ignore).
	ExtraIgnore []string

	// ExtraInclude contains patterns to force-include (e.g., from CLI --include).
	// These are converted to negation patterns and have highest priority.
	ExtraInclude []string
}

// Matcher determines whether paths should be ignored during artifact creation.
// It composes multiple pattern sources with proper precedence ordering.
//
// Matcher is safe for concurrent use after creation.
type Matcher struct {
	// patterns contains all patterns in priority order (lowest to highest).
	// The last matching pattern wins.
	patterns []patternEntry

	// rootDir is the artifact root directory.
	rootDir string
}

// New creates a Matcher with the given options.
//
// Returns an error if RootDir is empty or doesn't exist.
// Pattern parse errors are silently ignored (lenient like Git).
//
// The default behavior is:
//   - RespectGitignore: false (must be explicitly enabled)
//   - IncludeDefaults: false (must be explicitly enabled)
//
// Use NewWithDefaults for standard behavior with security defaults enabled.
func New(opts Options) (*Matcher, error) {
	if opts.RootDir == "" {
		return nil, fmt.Errorf("RootDir is required")
	}

	// Normalize and validate RootDir
	rootDir, err := filepath.Abs(opts.RootDir)
	if err != nil {
		return nil, fmt.Errorf("invalid RootDir %q: %w", opts.RootDir, err)
	}

	info, err := os.Stat(rootDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("RootDir does not exist: %s", rootDir)
		}
		return nil, fmt.Errorf("cannot access RootDir %s: %w", rootDir, err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("RootDir is not a directory: %s", rootDir)
	}

	// Build patterns in precedence order (lowest to highest priority)
	var patterns []patternEntry

	// 1. Built-in defaults (lowest priority)
	if opts.IncludeDefaults {
		patterns = append(patterns, loadDefaultPatterns()...)
	}

	// 2. .gitignore
	if opts.RespectGitignore {
		patterns = append(patterns, loadGitignore(rootDir)...)
	}

	// 3. .stigmerignore
	patterns = append(patterns, loadStigmerignore(rootDir)...)

	// 4. CLI patterns (highest priority)
	if len(opts.ExtraIgnore) > 0 || len(opts.ExtraInclude) > 0 {
		patterns = append(patterns, loadCLIPatterns(opts.ExtraIgnore, opts.ExtraInclude)...)
	}

	return &Matcher{
		patterns: patterns,
		rootDir:  rootDir,
	}, nil
}

// NewWithDefaults creates a Matcher with security defaults enabled.
// This is the recommended constructor for typical use cases.
//
// Equivalent to:
//
//	New(Options{
//	    RootDir:          rootDir,
//	    RespectGitignore: true,
//	    IncludeDefaults:  true,
//	})
func NewWithDefaults(rootDir string) (*Matcher, error) {
	return New(Options{
		RootDir:          rootDir,
		RespectGitignore: true,
		IncludeDefaults:  true,
	})
}

// Match returns true if the path should be ignored (excluded from the artifact).
//
// The path must be relative to the artifact root and should use forward slashes.
// isDir should be true if the path represents a directory.
//
// This is the hot path for filtering - optimized for minimal allocations.
func (m *Matcher) Match(path string, isDir bool) bool {
	result := m.MatchWithReason(path, isDir)
	return result.Ignored
}

// MatchWithReason returns detailed information about the match decision.
// This is useful for debugging, dry-run mode, and understanding ignore behavior.
//
// The path must be relative to the artifact root and should use forward slashes.
// isDir should be true if the path represents a directory.
func (m *Matcher) MatchWithReason(path string, isDir bool) MatchResult {
	result := MatchResult{
		Path:  path,
		IsDir: isDir,
	}

	// Normalize path
	path = normalizePath(path)
	if path == "" {
		// Root directory is never ignored
		return result
	}

	// Convert to path components for go-git
	components := pathToComponents(path)
	if len(components) == 0 {
		return result
	}

	// Evaluate patterns in order - last match wins
	var lastMatch *patternEntry
	var lastMatchResult gitignore.MatchResult

	for i := range m.patterns {
		entry := &m.patterns[i]
		matchResult := entry.pattern.Match(components, isDir)

		if matchResult != gitignore.NoMatch {
			lastMatch = entry
			lastMatchResult = matchResult
		}
	}

	// No pattern matched - include by default
	if lastMatch == nil {
		result.Ignored = false
		result.Reason = ReasonNoMatch
		return result
	}

	// Determine result based on match type
	switch lastMatchResult {
	case gitignore.Exclude:
		result.Ignored = true
		if lastMatch.source == SourceDefaults {
			result.Reason = ReasonDefaultDeny
		} else {
			result.Reason = ReasonExcluded
		}
	case gitignore.Include:
		result.Ignored = false
		result.Reason = ReasonIncluded
	default:
		// Shouldn't happen, but handle gracefully
		result.Ignored = false
		result.Reason = ReasonNoMatch
	}

	result.Source = lastMatch.source
	result.Pattern = lastMatch.rawPattern

	return result
}

// Patterns returns all loaded patterns for debugging/dry-run.
// The returned slice is a copy and can be safely modified.
func (m *Matcher) Patterns() []string {
	result := make([]string, len(m.patterns))
	for i, entry := range m.patterns {
		result[i] = fmt.Sprintf("[%s] %s", entry.source, entry.rawPattern)
	}
	return result
}

// PatternCount returns the total number of loaded patterns.
func (m *Matcher) PatternCount() int {
	return len(m.patterns)
}

// RootDir returns the root directory used by this matcher.
func (m *Matcher) RootDir() string {
	return m.rootDir
}
