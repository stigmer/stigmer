// Package skillref provides helper functions for creating skill references.
//
// Skills are pushed to the platform via `stigmer skill push` CLI command.
// In the SDK, you only reference existing skills by slug and optional version.
//
// The helpers return *apiresource.ApiResourceReference directly (no wrapper types).
// This ensures zero schema drift between SDK and proto definitions.
//
// # Platform Skills
//
// Platform skills are shared across the entire platform and available to all users.
// Use skillref.Platform() to reference them:
//
//	import "github.com/stigmer/stigmer/sdk/go/skillref"
//
//	agent.AddSkillRef(skillref.Platform("code-review"))
//	agent.AddSkillRef(skillref.Platform("code-review", "v1.0"))
//	agent.AddSkillRef(skillref.Platform("code-review", "stable"))
//
// # Organization Skills
//
// Organization skills are scoped to a specific organization. Use the
// Agent.AddOrgSkillRef() method which automatically uses the agent's org:
//
//	agent.AddOrgSkillRef("internal-docs")
//	agent.AddOrgSkillRef("internal-docs", "v2.0")
//
// # Version Formats
//
// The version parameter supports three formats:
//   - Empty or omitted: Uses "latest" (most recent version)
//   - Tag name: e.g., "v1.0", "stable", "beta"
//   - Exact hash: e.g., "abc123..." (immutable reference)
package skillref
