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

// splitPathSegments splits a URL path into non-empty segments, stripping
// leading/trailing slashes.
func splitPathSegments(path string) []string {
	path = strings.Trim(path, "/")
	if path == "" {
		return nil
	}
	return strings.Split(path, "/")
}
