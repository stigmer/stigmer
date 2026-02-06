// Package skillref provides helpers for creating skill references.
//
// This package creates VALUE OBJECTS that reference existing skills.
// For DEFINING new skills, use the skill package instead.
//
// # Domain Concept
//
// skillref creates ApiResourceReference value objects - lightweight pointers
// to skills identified by org/slug/version. These are used when agents need to
// declare which skills they want to use.
//
// # Reference Format
//
// All skills follow the "org/slug" format with optional version:
//   - "stigmer/web-search" - skill owned by stigmer org
//   - "acme/internal-docs" - skill owned by acme org
//   - "stigmer/code-review@v1.0" - skill with specific version
//
// # Creating References
//
// There are three ways to create skill references:
//
// 1. Using New() for explicit org/slug:
//
//	ref := skillref.New("stigmer", "web-search")
//	ref := skillref.New("stigmer", "web-search", skillref.WithVersion("v1.0"))
//
// 2. Using Parse() for string parsing (returns error):
//
//	ref, err := skillref.Parse("stigmer/web-search")
//	ref, err := skillref.Parse("stigmer/web-search@v1.0")
//
// 3. Using MustParse() for string parsing (panics on error):
//
//	ref := skillref.MustParse("stigmer/web-search")  // For init or tests
//
// # Version Formats
//
// Skills support optional versioning:
//   - Empty/unset: Uses latest version
//   - Tag name: e.g., "v1.0", "stable", "beta"
//   - Exact hash: e.g., "abc123..." (64-char hex, immutable)
//
// # Usage with Agents
//
// When adding skill references to agents:
//
//	import (
//	    "github.com/stigmer/stigmer/sdk/go/agent"
//	    "github.com/stigmer/stigmer/sdk/go/skillref"
//	)
//
//	reviewer, _ := agent.New(ctx, "code-reviewer", &agent.AgentArgs{...})
//	reviewer.AddSkillRef(skillref.New("stigmer", "coding-best-practices"))
//	reviewer.AddSkillRef(skillref.New("stigmer", "security-guidelines", skillref.WithVersion("v2.0")))
//
// # Error Handling
//
// Parse() returns a *ParseError that wraps one of these sentinel errors:
//   - ErrInvalidFormat: Missing "/" separator or empty input
//   - ErrEmptyOrg: Organization part is empty (e.g., "/slug")
//   - ErrEmptySlug: Slug part is empty (e.g., "org/")
//
// Use errors.Is to check for specific errors:
//
//	ref, err := skillref.Parse(input)
//	if errors.Is(err, skillref.ErrInvalidFormat) {
//	    // Handle invalid format
//	}
package skillref
