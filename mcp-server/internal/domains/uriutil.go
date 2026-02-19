package domains

import (
	"fmt"
	"net/url"
	"strings"
)

// ParseResourceURI extracts the org and slug segments from a Stigmer resource
// URI of the form stigmer://{kind}/{org}/{slug}.
//
// Example: "stigmer://agents/acme/code-reviewer" → org="acme", slug="code-reviewer"
func ParseResourceURI(uri string) (org, slug string, err error) {
	u, err := url.Parse(uri)
	if err != nil {
		return "", "", fmt.Errorf("malformed resource URI: %w", err)
	}

	if u.Scheme != "stigmer" {
		return "", "", fmt.Errorf("unexpected URI scheme %q, expected \"stigmer\"", u.Scheme)
	}

	// In stigmer://agents/acme/code-reviewer the standard library parses:
	//   Host = "agents"    (the authority component)
	//   Path = "/acme/code-reviewer"
	segments := splitPathSegments(u.Path)
	if len(segments) != 2 {
		return "", "", fmt.Errorf(
			"expected URI path with 2 segments (org/slug), got %d in %q",
			len(segments), uri,
		)
	}

	org, slug = segments[0], segments[1]
	if org == "" || slug == "" {
		return "", "", fmt.Errorf("org and slug must be non-empty in %q", uri)
	}

	return org, slug, nil
}

// ParseVersionedResourceURI extracts the org, slug, and optional version
// segments from a Stigmer resource URI. It accepts two forms:
//
//	stigmer://{kind}/{org}/{slug}            → version=""
//	stigmer://{kind}/{org}/{slug}/{version}  → version="stable", "v1.0", sha256, etc.
//
// When the URI contains only two path segments, version is returned as the
// empty string, which conventionally means "latest". Three segments yield an
// explicit version. Any other segment count is an error.
func ParseVersionedResourceURI(uri string) (org, slug, version string, err error) {
	u, err := url.Parse(uri)
	if err != nil {
		return "", "", "", fmt.Errorf("malformed resource URI: %w", err)
	}

	if u.Scheme != "stigmer" {
		return "", "", "", fmt.Errorf("unexpected URI scheme %q, expected \"stigmer\"", u.Scheme)
	}

	segments := splitPathSegments(u.Path)
	switch len(segments) {
	case 2:
		org, slug = segments[0], segments[1]
	case 3:
		org, slug, version = segments[0], segments[1], segments[2]
		if version == "" {
			return "", "", "", fmt.Errorf("version segment must be non-empty in %q", uri)
		}
	default:
		return "", "", "", fmt.Errorf(
			"expected URI path with 2 or 3 segments (org/slug[/version]), got %d in %q",
			len(segments), uri,
		)
	}

	if org == "" || slug == "" {
		return "", "", "", fmt.Errorf("org and slug must be non-empty in %q", uri)
	}

	return org, slug, version, nil
}

// kindToAuthority maps singular resource kind names (as they appear in the
// ApiResourceKind proto enum) to the plural authority component used in
// stigmer:// URIs. Only kinds that have registered MCP resource templates
// are included.
var kindToAuthority = map[string]string{
	"agent":    "agents",
	"skill":    "skills",
	"workflow": "workflows",
}

// BuildResourceURI constructs a stigmer:// resource URI from a kind name, org,
// and slug. This is the inverse of ParseResourceURI.
//
// Returns an empty string when the kind has no registered resource template
// (e.g. "mcp_server"), or when org/slug are empty.
func BuildResourceURI(kind, org, slug string) string {
	authority, ok := kindToAuthority[kind]
	if !ok || org == "" || slug == "" {
		return ""
	}
	return fmt.Sprintf("stigmer://%s/%s/%s", authority, org, slug)
}

// splitPathSegments splits a URL path into non-empty segments, stripping
// leading/trailing slashes.
func splitPathSegments(path string) []string {
	path = strings.Trim(path, "/")
	if path == "" {
		return nil
	}
	return strings.Split(path, "/")
}
