// Package skill provides helpers for creating skill references in agent definitions.
//
// When building agents, you add skills to give them specialized knowledge.
// Skills are managed separately (via CLI: stigmer skill push) - this package
// creates references to those skills.
//
// # Reference Format
//
// All skills follow the "org/slug" format:
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
//	ref := skill.New("stigmer", "web-search")
//	ref := skill.New("stigmer", "web-search", skill.WithVersion("v1.0"))
//
// 2. Using Parse() for string parsing (returns error):
//
//	ref, err := skill.Parse("stigmer/web-search")
//	ref, err := skill.Parse("stigmer/web-search@v1.0")
//
// 3. Using MustParse() for string parsing (panics on error):
//
//	ref := skill.MustParse("stigmer/web-search")  // For init or tests
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
// When using with agents, prefer the agent's AddSkill method for convenience:
//
//	agent, _ := agent.New("code-reviewer", agent.InOrg("acme"))
//	agent.AddSkill("stigmer/web-search")      // Uses string parsing
//	agent.AddSkill("internal-docs")           // Uses agent's org (acme)
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
//	ref, err := skill.Parse(input)
//	if errors.Is(err, skill.ErrInvalidFormat) {
//	    // Handle invalid format
//	}
package skill
