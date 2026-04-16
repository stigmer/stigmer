package reference

import (
	"strings"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/kindmeta"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
)

// ParsedReference contains the components of a parsed resource reference.
type ParsedReference struct {
	// Org is the organization that owns the resource.
	// Either extracted from the reference or provided via context.
	Org string

	// Slug is the resource slug (user-friendly identifier).
	Slug string

	// Version is the optional version specifier (for versioned resources like skills).
	// Supports tag names (e.g., "v1.0", "stable") or exact hashes.
	Version string

	// IsID indicates whether the reference is a resource ID rather than org/slug.
	IsID bool

	// ID is the resource ID value when IsID is true.
	ID string
}

// Parse parses a resource reference string into its components.
//
// The function handles multiple reference formats:
//   - Resource IDs: prefix + separator + 26-char ULID (e.g., agt_01ARZ3NDEKTSV4RRFFQ69G5FAV), or UUID
//   - org/slug: Explicit organization and slug
//   - org/slug@version: With version suffix
//   - slug: Slug-only, requires contextOrg to be provided
//
// Resource ID detection is strict: the body after the prefix must be exactly 26 characters
// (ULID length). This prevents slugs like "mcp-server-stigmer" from being misidentified
// as resource IDs just because they start with a known prefix.
//
// The contextOrg parameter provides the default organization for slug-only references.
// If contextOrg is empty and a slug-only reference is provided, ErrOrgRequired is returned.
//
// Examples:
//
//	Parse("stigmer/web-search", "")                        // org=stigmer, slug=web-search
//	Parse("web-search", "my-org")                          // org=my-org, slug=web-search
//	Parse("agt_01ARZ3NDEKTSV4RRFFQ69G5FAV", "")           // IsID=true
//	Parse("stigmer/skill@v1.0", "")                        // org=stigmer, slug=skill, version=v1.0
//	Parse("mcp-server-stigmer", "default")                 // org=default, slug=mcp-server-stigmer
func Parse(ref string, contextOrg string) (*ParsedReference, error) {
	ref = strings.TrimSpace(ref)

	if ref == "" {
		return nil, newParseError("", "reference string is empty", ErrEmptyReference)
	}

	// Check if this is a fully valid resource ID (prefix + separator + 26-char ULID, or UUID).
	// We use strict validation here to avoid misidentifying slugs that happen to
	// start with a known prefix (e.g., "mcp-server-stigmer" starts with "mcp-").
	if ValidateResourceID(ref) == nil {
		return &ParsedReference{
			IsID: true,
			ID:   ref,
		}, nil
	}

	// Check for org/slug format
	if strings.Contains(ref, "/") {
		return parseOrgSlug(ref)
	}

	// Slug-only format - requires context org
	if contextOrg == "" {
		return nil, newParseError(ref, "slug-only reference requires organization context", ErrOrgRequired)
	}

	// Extract version if present
	slug, version := extractVersion(ref)

	return &ParsedReference{
		Org:     contextOrg,
		Slug:    slug,
		Version: version,
	}, nil
}

// MustParse is like Parse but panics on error.
// Useful for package-level variable initialization or test code.
func MustParse(ref string, contextOrg string) *ParsedReference {
	parsed, err := Parse(ref, contextOrg)
	if err != nil {
		panic(err)
	}
	return parsed
}

// parseOrgSlug parses a reference in org/slug[@version] format.
func parseOrgSlug(ref string) (*ParsedReference, error) {
	// Extract version if present (before splitting org/slug)
	refWithoutVersion, version := extractVersion(ref)

	// Split org/slug
	slashIdx := strings.Index(refWithoutVersion, "/")
	if slashIdx == -1 {
		// This shouldn't happen since caller checks for "/", but handle gracefully
		return nil, newParseError(ref, "expected org/slug format", ErrEmptyOrg)
	}

	org := refWithoutVersion[:slashIdx]
	slug := refWithoutVersion[slashIdx+1:]

	// Handle edge case of multiple slashes (take first part as org, rest as slug)
	// e.g., "org/path/to/resource" -> org="org", slug="path/to/resource"
	// This is intentionally permissive to allow hierarchical slugs in the future

	if org == "" {
		return nil, newParseError(ref, "organization is empty", ErrEmptyOrg)
	}

	if slug == "" {
		return nil, newParseError(ref, "slug is empty", ErrEmptySlug)
	}

	return &ParsedReference{
		Org:     org,
		Slug:    slug,
		Version: version,
	}, nil
}

// extractVersion extracts a version suffix from a reference.
// The version is everything after the last "@" character.
// Returns the reference without version and the version (empty if no version).
func extractVersion(ref string) (string, string) {
	atIdx := strings.LastIndex(ref, "@")
	if atIdx == -1 {
		return ref, ""
	}
	return ref[:atIdx], ref[atIdx+1:]
}

// isResourceID checks if the reference looks like a resource ID.
// Resource IDs are detected by prefix from ApiResourceKind enum options or UUID format.
// Supports both underscore (prefix_) and hyphen (prefix-) separators.
func isResourceID(ref string) bool {
	// Check against all known resource kinds
	for kind := range apiresourcekind.ApiResourceKind_name {
		k := apiresourcekind.ApiResourceKind(kind)
		if k == apiresourcekind.ApiResourceKind_api_resource_kind_unknown {
			continue
		}
		if isResourceIDWithKind(ref, k) {
			return true
		}
	}
	// Also check for UUID format (legacy compatibility)
	return isUUID(ref)
}

// isResourceIDWithKind checks if the reference is a resource ID for the given kind.
// ID format is: prefix + separator + ULID, where separator is underscore or hyphen.
// Prefix is derived from the ApiResourceKind enum options (id_prefix).
func isResourceIDWithKind(ref string, kind apiresourcekind.ApiResourceKind) bool {
	prefix, err := kindmeta.GetIDPrefix(kind)
	if err != nil || prefix == "" {
		return false
	}
	// Support both underscore and hyphen separators
	return strings.HasPrefix(ref, prefix+"_") || strings.HasPrefix(ref, prefix+"-")
}

// IsAgentID returns true if the reference is an agent resource ID.
func IsAgentID(ref string) bool {
	return isResourceIDWithKind(ref, apiresourcekind.ApiResourceKind_agent)
}

// IsWorkflowID returns true if the reference is a workflow resource ID.
func IsWorkflowID(ref string) bool {
	return isResourceIDWithKind(ref, apiresourcekind.ApiResourceKind_workflow)
}

// IsMcpServerID returns true if the reference is an MCP server resource ID or UUID.
func IsMcpServerID(ref string) bool {
	return isResourceIDWithKind(ref, apiresourcekind.ApiResourceKind_mcp_server) || isUUID(ref)
}

// IsAgentExecutionID returns true if the reference is an agent execution ID.
func IsAgentExecutionID(ref string) bool {
	return isResourceIDWithKind(ref, apiresourcekind.ApiResourceKind_agent_execution)
}

// IsWorkflowExecutionID returns true if the reference is a workflow execution ID.
func IsWorkflowExecutionID(ref string) bool {
	return isResourceIDWithKind(ref, apiresourcekind.ApiResourceKind_workflow_execution)
}

// IsSkillID returns true if the reference is a skill resource ID.
func IsSkillID(ref string) bool {
	return isResourceIDWithKind(ref, apiresourcekind.ApiResourceKind_skill)
}

// IsAgentInstanceID returns true if the reference is an agent instance ID.
func IsAgentInstanceID(ref string) bool {
	return isResourceIDWithKind(ref, apiresourcekind.ApiResourceKind_agent_instance)
}

// IsWorkflowInstanceID returns true if the reference is a workflow instance ID.
func IsWorkflowInstanceID(ref string) bool {
	return isResourceIDWithKind(ref, apiresourcekind.ApiResourceKind_workflow_instance)
}

// IsSessionID returns true if the reference is a session resource ID.
func IsSessionID(ref string) bool {
	return isResourceIDWithKind(ref, apiresourcekind.ApiResourceKind_session)
}

// IsEnvironmentID returns true if the reference is an environment resource ID.
func IsEnvironmentID(ref string) bool {
	return isResourceIDWithKind(ref, apiresourcekind.ApiResourceKind_environment)
}

// IsProjectID returns true if the reference is a project resource ID.
func IsProjectID(ref string) bool {
	return isResourceIDWithKind(ref, apiresourcekind.ApiResourceKind_project)
}

// ulidLength is the expected length of a ULID string (26 Crockford base-32 chars).
const ulidLength = 26

// ValidateResourceID checks that ref is a syntactically complete resource ID:
// a known kind prefix, a separator (_ or -), and a 26-character ULID body.
// Returns nil if valid, ErrNotResourceID if no prefix matches, or
// ErrIncompleteID if the prefix matches but the body is wrong.
func ValidateResourceID(ref string) error {
	_, err := ResourceIDKind(ref)
	return err
}

// ResourceIDKind returns the ApiResourceKind for a well-formed resource ID.
// It validates both the prefix and the ULID body length. Use this in
// resolution chains to determine which domain the ID belongs to.
func ResourceIDKind(ref string) (apiresourcekind.ApiResourceKind, error) {
	for kind := range apiresourcekind.ApiResourceKind_name {
		k := apiresourcekind.ApiResourceKind(kind)
		if k == apiresourcekind.ApiResourceKind_api_resource_kind_unknown {
			continue
		}
		prefix, err := kindmeta.GetIDPrefix(k)
		if err != nil || prefix == "" {
			continue
		}
		for _, sep := range []string{"_", "-"} {
			pfx := prefix + sep
			if !strings.HasPrefix(ref, pfx) {
				continue
			}
			body := ref[len(pfx):]
			if len(body) != ulidLength {
				return 0, newParseError(ref,
					"incomplete resource ID: expected 26-character ULID after prefix",
					ErrIncompleteID)
			}
			return k, nil
		}
	}
	if isUUID(ref) {
		return apiresourcekind.ApiResourceKind_api_resource_kind_unknown, nil
	}
	return 0, newParseError(ref, "not a recognized resource ID", ErrNotResourceID)
}

// HasResourceIDPrefix returns true if ref starts with any known resource ID
// prefix followed by _ or -. Unlike ValidateResourceID, it does not check
// the ULID body length — use this to detect intent, then ValidateResourceID
// to enforce completeness.
func HasResourceIDPrefix(ref string) bool {
	return isResourceID(ref)
}

// isUUID checks if a string looks like a UUID (8-4-4-4-12 format).
func isUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	// Check for hyphens in correct positions
	if s[8] != '-' || s[13] != '-' || s[18] != '-' || s[23] != '-' {
		return false
	}
	// Check that all other characters are hex digits
	for i, c := range s {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			continue // skip hyphens
		}
		if !isHexDigit(byte(c)) {
			return false
		}
	}
	return true
}

// isHexDigit checks if a character is a valid hexadecimal digit.
func isHexDigit(c byte) bool {
	return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
}
