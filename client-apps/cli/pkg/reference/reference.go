package reference

import (
	"strings"
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
//   - Resource IDs: Detected by prefix (agt_, wf_, mcp-, or UUID format)
//   - org/slug: Explicit organization and slug
//   - org/slug@version: With version suffix
//   - slug: Slug-only, requires contextOrg to be provided
//
// The contextOrg parameter provides the default organization for slug-only references.
// If contextOrg is empty and a slug-only reference is provided, ErrOrgRequired is returned.
//
// Examples:
//
//	Parse("stigmer/web-search", "")       // org=stigmer, slug=web-search
//	Parse("web-search", "my-org")         // org=my-org, slug=web-search
//	Parse("agt_abc123", "")               // IsID=true, ID=agt_abc123
//	Parse("stigmer/skill@v1.0", "")       // org=stigmer, slug=skill, version=v1.0
func Parse(ref string, contextOrg string) (*ParsedReference, error) {
	ref = strings.TrimSpace(ref)

	if ref == "" {
		return nil, newParseError("", "reference string is empty", ErrEmptyReference)
	}

	// Check if this is a resource ID
	if isResourceID(ref) {
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
// Resource IDs have specific prefixes or are UUIDs.
func isResourceID(ref string) bool {
	return IsAgentID(ref) || IsWorkflowID(ref) || IsMcpServerID(ref) ||
		IsAgentExecutionID(ref) || IsWorkflowExecutionID(ref) ||
		IsSkillID(ref) || IsAgentInstanceID(ref) || IsWorkflowInstanceID(ref)
}

// IsAgentID returns true if the reference is an agent resource ID.
// Agent IDs have the prefix "agt_".
func IsAgentID(ref string) bool {
	return strings.HasPrefix(ref, "agt_")
}

// IsWorkflowID returns true if the reference is a workflow resource ID.
// Workflow IDs have the prefix "wf_".
func IsWorkflowID(ref string) bool {
	return strings.HasPrefix(ref, "wf_")
}

// IsMcpServerID returns true if the reference is an MCP server resource ID.
// MCP server IDs have the prefix "mcp-" or look like UUIDs.
func IsMcpServerID(ref string) bool {
	if strings.HasPrefix(ref, "mcp-") {
		return true
	}
	// Check for UUID format (8-4-4-4-12)
	return isUUID(ref)
}

// IsAgentExecutionID returns true if the reference is an agent execution ID.
// Agent execution IDs have the prefix "agtexec_".
func IsAgentExecutionID(ref string) bool {
	return strings.HasPrefix(ref, "agtexec_")
}

// IsWorkflowExecutionID returns true if the reference is a workflow execution ID.
// Workflow execution IDs have the prefix "wfexec_".
func IsWorkflowExecutionID(ref string) bool {
	return strings.HasPrefix(ref, "wfexec_")
}

// IsSkillID returns true if the reference is a skill resource ID.
// Skill IDs have the prefix "skill_".
func IsSkillID(ref string) bool {
	return strings.HasPrefix(ref, "skill_")
}

// IsAgentInstanceID returns true if the reference is an agent instance ID.
// Agent instance IDs have the prefix "agtinst_".
func IsAgentInstanceID(ref string) bool {
	return strings.HasPrefix(ref, "agtinst_")
}

// IsWorkflowInstanceID returns true if the reference is a workflow instance ID.
// Workflow instance IDs have the prefix "wfinst_".
func IsWorkflowInstanceID(ref string) bool {
	return strings.HasPrefix(ref, "wfinst_")
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
