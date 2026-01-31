package agent

import (
	"errors"
	"fmt"
	"strings"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// Sentinel errors for reference parsing in agent context.
var (
	// ErrOrgRequired is returned when a slug-only reference is used but agent.Org is not set.
	ErrOrgRequired = errors.New("agent.Org is required for slug-only references")

	// ErrEmptyRef is returned when an empty reference string is provided.
	ErrEmptyRef = errors.New("reference string is empty")

	// ErrEmptyOrg is returned when the organization part of a reference is empty.
	ErrEmptyOrg = errors.New("organization is empty in reference")

	// ErrEmptySlug is returned when the slug part of a reference is empty.
	ErrEmptySlug = errors.New("slug is empty in reference")
)

// RefParseError provides detailed context for reference parsing failures.
type RefParseError struct {
	// Ref is the original reference string that failed to parse.
	Ref string

	// Message provides a human-readable description of what went wrong.
	Message string

	// Err is the underlying sentinel error.
	Err error
}

// Error implements the error interface.
func (e *RefParseError) Error() string {
	if e.Ref == "" {
		return fmt.Sprintf("agent: %s", e.Message)
	}
	return fmt.Sprintf("agent: cannot parse %q: %s", e.Ref, e.Message)
}

// Unwrap returns the underlying error for use with errors.Is and errors.As.
func (e *RefParseError) Unwrap() error {
	return e.Err
}

// parseSkillRef parses a skill reference with smart org resolution.
//
// Smart parsing rules:
//   - If ref contains "/", parse as "org/slug" or "org/slug@version"
//   - If ref has no "/", use defaultOrg + ref as slug
//   - Version can be specified in the string ("@version") or via options
//   - Option version overrides string version if both are provided
//
// Returns a RefParseError if parsing fails.
func parseSkillRef(ref, defaultOrg string, opts ...SkillOption) (*apiresource.ApiResourceReference, error) {
	if ref == "" {
		return nil, &RefParseError{
			Ref:     ref,
			Message: "reference string is empty",
			Err:     ErrEmptyRef,
		}
	}

	// Apply options
	skillOpts := applySkillOptions(opts...)

	var org, slug, version string

	// Check if this is an explicit org/slug reference or a slug-only reference
	if strings.Contains(ref, "/") {
		// Explicit org/slug format
		// First, extract version if present (use last @ to handle edge cases)
		workingRef := ref
		if atIdx := strings.LastIndex(workingRef, "@"); atIdx != -1 {
			version = workingRef[atIdx+1:]
			workingRef = workingRef[:atIdx]
		}

		// Split org/slug (use first / to allow slugs with slashes)
		slashIdx := strings.Index(workingRef, "/")
		org = workingRef[:slashIdx]
		slug = workingRef[slashIdx+1:]

		if org == "" {
			return nil, &RefParseError{
				Ref:     ref,
				Message: "organization is empty in reference",
				Err:     ErrEmptyOrg,
			}
		}

		if slug == "" {
			return nil, &RefParseError{
				Ref:     ref,
				Message: "slug is empty in reference",
				Err:     ErrEmptySlug,
			}
		}
	} else {
		// Slug-only format - requires defaultOrg
		if defaultOrg == "" {
			return nil, &RefParseError{
				Ref:     ref,
				Message: "agent.Org is not set (use \"org/slug\" format or set agent.Org first)",
				Err:     ErrOrgRequired,
			}
		}

		org = defaultOrg

		// Extract version if present
		workingRef := ref
		if atIdx := strings.LastIndex(workingRef, "@"); atIdx != -1 {
			version = workingRef[atIdx+1:]
			slug = workingRef[:atIdx]
		} else {
			slug = workingRef
		}

		if slug == "" {
			return nil, &RefParseError{
				Ref:     ref,
				Message: "slug is empty in reference",
				Err:     ErrEmptySlug,
			}
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

// parseMcpServerRef parses an MCP server reference with smart org resolution.
//
// Smart parsing rules:
//   - If ref contains "/", parse as "org/slug"
//   - If ref has no "/", use defaultOrg + ref as slug
//
// Note: MCP servers do not support versioning.
//
// Returns a RefParseError if parsing fails.
func parseMcpServerRef(ref, defaultOrg string) (*apiresource.ApiResourceReference, error) {
	if ref == "" {
		return nil, &RefParseError{
			Ref:     ref,
			Message: "reference string is empty",
			Err:     ErrEmptyRef,
		}
	}

	var org, slug string

	// Check if this is an explicit org/slug reference or a slug-only reference
	if strings.Contains(ref, "/") {
		// Explicit org/slug format
		slashIdx := strings.Index(ref, "/")
		org = ref[:slashIdx]
		slug = ref[slashIdx+1:]

		if org == "" {
			return nil, &RefParseError{
				Ref:     ref,
				Message: "organization is empty in reference",
				Err:     ErrEmptyOrg,
			}
		}

		if slug == "" {
			return nil, &RefParseError{
				Ref:     ref,
				Message: "slug is empty in reference",
				Err:     ErrEmptySlug,
			}
		}
	} else {
		// Slug-only format - requires defaultOrg
		if defaultOrg == "" {
			return nil, &RefParseError{
				Ref:     ref,
				Message: "agent.Org is not set (use \"org/slug\" format or set agent.Org first)",
				Err:     ErrOrgRequired,
			}
		}

		org = defaultOrg
		slug = ref

		if slug == "" {
			return nil, &RefParseError{
				Ref:     ref,
				Message: "slug is empty in reference",
				Err:     ErrEmptySlug,
			}
		}
	}

	return &apiresource.ApiResourceReference{
		Org:  org,
		Kind: apiresourcekind.ApiResourceKind_mcp_server,
		Slug: slug,
	}, nil
}
