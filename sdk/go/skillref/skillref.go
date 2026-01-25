package skillref

import (
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// Platform creates a reference to a platform-scoped skill.
//
// Platform skills are shared across the entire platform and available to all users.
// The version parameter is optional - if omitted or empty, "latest" is used.
//
// Version supports three formats:
//   - Empty or omitted: Uses "latest" (most recent version)
//   - Tag name: e.g., "v1.0", "stable", "beta"
//   - Exact hash: e.g., "abc123..." (64-char hex, immutable reference)
//
// Examples:
//
//	skillref.Platform("code-review")           // Latest version
//	skillref.Platform("code-review", "v1.0")   // Specific tag
//	skillref.Platform("code-review", "stable") // Stable tag
//	skillref.Platform("code-review", "abc123") // Exact hash (immutable)
func Platform(slug string, version ...string) *apiresource.ApiResourceReference {
	ref := &apiresource.ApiResourceReference{
		Kind:  apiresourcekind.ApiResourceKind_skill,
		Slug:  slug,
		Scope: apiresource.ApiResourceOwnerScope_platform,
	}
	if len(version) > 0 && version[0] != "" {
		ref.Version = version[0]
	}
	return ref
}

// Organization creates a reference to an organization-scoped skill.
//
// Organization skills are specific to an organization and only available to its members.
// The version parameter is optional - if omitted or empty, "latest" is used.
//
// Version supports three formats:
//   - Empty or omitted: Uses "latest" (most recent version)
//   - Tag name: e.g., "v1.0", "stable", "beta"
//   - Exact hash: e.g., "abc123..." (64-char hex, immutable reference)
//
// Examples:
//
//	skillref.Organization("my-org", "internal-docs")           // Latest version
//	skillref.Organization("my-org", "internal-docs", "v1.0")   // Specific tag
func Organization(org, slug string, version ...string) *apiresource.ApiResourceReference {
	ref := &apiresource.ApiResourceReference{
		Kind:  apiresourcekind.ApiResourceKind_skill,
		Slug:  slug,
		Scope: apiresource.ApiResourceOwnerScope_organization,
		Org:   org,
	}
	if len(version) > 0 && version[0] != "" {
		ref.Version = version[0]
	}
	return ref
}
