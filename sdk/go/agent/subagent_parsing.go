package agent

import (
	"strings"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// parseSubAgentSkillRef parses a skill reference in "org/slug" or "org/slug@version" format.
//
// Unlike Agent parsing, SubAgent has no Org field and therefore cannot resolve
// slug-only references. All references must use explicit "org/slug" format.
//
// Parsing rules:
//   - "org/slug" → org="org", slug="slug"
//   - "org/slug@v1.0" → org="org", slug="slug", version="v1.0"
//   - "org/slug/nested" → org="org", slug="slug/nested" (first / splits org)
//   - "org/slug@email@domain" → uses last @ for version (slug="slug@email", version="domain")
//
// Error cases:
//   - "" → ErrSubAgentEmptyRef
//   - "slug-only" (no /) → ErrSubAgentOrgRequired
//   - "/slug" → ErrSubAgentEmptyOrg
//   - "org/" → ErrSubAgentEmptySlug
//   - "org/@v1.0" → ErrSubAgentEmptySlug
//
// Version handling:
//   - Version in string is extracted from last "@" character
//   - Option version (via AtVersion) overrides string version
//
// Returns a SubAgentRefParseError if parsing fails, allowing callers to use
// errors.Is() and errors.As() for specific error handling.
func parseSubAgentSkillRef(ref string, opts ...SkillOption) (*apiresource.ApiResourceReference, error) {
	// Validate non-empty input
	if ref == "" {
		return nil, &SubAgentRefParseError{
			Ref:     ref,
			Message: "reference string is empty",
			Err:     ErrSubAgentEmptyRef,
		}
	}

	// Apply options to get version override
	skillOpts := applySkillOptions(opts...)

	var org, slug, version string

	// SubAgents require explicit org/slug format - no defaultOrg fallback
	if !strings.Contains(ref, "/") {
		return nil, &SubAgentRefParseError{
			Ref:     ref,
			Message: "subagents require explicit org/slug format (no org context available)",
			Err:     ErrSubAgentOrgRequired,
		}
	}

	// Parse explicit org/slug format
	workingRef := ref

	// Extract version if present (use last @ to handle edge cases like email in slug)
	if atIdx := strings.LastIndex(workingRef, "@"); atIdx != -1 {
		version = workingRef[atIdx+1:]
		workingRef = workingRef[:atIdx]
	}

	// Split org/slug at first / (allows nested slugs like "org/path/to/skill")
	slashIdx := strings.Index(workingRef, "/")
	org = workingRef[:slashIdx]
	slug = workingRef[slashIdx+1:]

	// Validate org is not empty
	if org == "" {
		return nil, &SubAgentRefParseError{
			Ref:     ref,
			Message: "organization is empty in reference",
			Err:     ErrSubAgentEmptyOrg,
		}
	}

	// Validate slug is not empty
	if slug == "" {
		return nil, &SubAgentRefParseError{
			Ref:     ref,
			Message: "slug is empty in reference",
			Err:     ErrSubAgentEmptySlug,
		}
	}

	// Option version overrides string version
	if skillOpts.version != "" {
		version = skillOpts.version
	}

	return &apiresource.ApiResourceReference{
		Org:     org,
		Kind:    apiresourcekind.ApiResourceKind_skill,
		Slug:    slug,
		Version: version,
	}, nil
}
