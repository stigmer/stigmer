// Package ignore provides pattern-based file filtering for Stigmer artifacts.
//
// This package implements gitignore-compatible pattern matching with layered
// precedence, designed for filtering files during artifact creation (e.g., skill push).
//
// # Pattern Syntax
//
// The package supports full gitignore syntax via the go-git library:
//   - Blank lines and lines starting with # are ignored
//   - Patterns can be negated with a leading ! to re-include files
//   - Trailing slashes indicate directory-only matches
//   - ** matches across directory boundaries
//   - Standard glob wildcards: *, ?, [abc]
//
// # Precedence Order
//
// Patterns are applied in the following order (lowest to highest priority):
//  1. Built-in defaults - Security-focused patterns (credentials, .git, etc.)
//  2. .gitignore - If RespectGitignore is true and file exists
//  3. .stigmerignore - Stigmer-specific overrides
//  4. CLI --ignore flags - Runtime exclusions
//  5. CLI --include flags - Force inclusions (highest priority)
//
// Later patterns override earlier ones. The last matching pattern wins.
//
// # Security by Default
//
// Built-in patterns ensure sensitive files are never accidentally included:
//   - Credentials: .env, *.pem, *.key, credentials.json, etc.
//   - Version control: .git/, .svn/, .hg/
//   - IDE files: .idea/, .vscode/
//   - Build artifacts: node_modules/, __pycache__/, etc.
//
// # Usage Example
//
//	matcher, err := ignore.New(ignore.Options{
//	    RootDir:          "/path/to/skill",
//	    RespectGitignore: true,
//	    IncludeDefaults:  true,
//	})
//	if err != nil {
//	    return err
//	}
//
//	// Check if a file should be ignored
//	if matcher.Match("secrets/.env", false) {
//	    // Skip this file
//	}
//
//	// For debugging, get detailed match info
//	result := matcher.MatchWithReason("config.yaml", false)
//	if result.Ignored {
//	    fmt.Printf("Ignored by %s: %s\n", result.Source, result.Pattern)
//	}
package ignore
