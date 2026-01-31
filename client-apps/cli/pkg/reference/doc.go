// Package reference provides utilities for parsing resource references in the Stigmer CLI.
//
// Resource references follow the org/slug format, similar to GitHub repository references.
// This package handles parsing of various reference formats and detection of resource IDs.
//
// # Reference Formats
//
// The package supports several reference formats:
//
//   - org/slug: Full organization and slug reference (e.g., "stigmer/web-search")
//   - org/slug@version: With version suffix (e.g., "stigmer/web-search@v1.0")
//   - slug: Slug-only, uses context organization (e.g., "web-search")
//   - resource ID: Detected by prefix (e.g., "agt_xxx", "wf_xxx", "mcp-xxx")
//
// # Usage
//
// Basic parsing with context organization:
//
//	parsed, err := reference.Parse("web-search", "my-org")
//	// parsed.Org = "my-org", parsed.Slug = "web-search"
//
// Explicit org/slug parsing:
//
//	parsed, err := reference.Parse("stigmer/code-review", "")
//	// parsed.Org = "stigmer", parsed.Slug = "code-review"
//
// With version:
//
//	parsed, err := reference.Parse("stigmer/web-search@v1.0", "")
//	// parsed.Org = "stigmer", parsed.Slug = "web-search", parsed.Version = "v1.0"
//
// ID detection:
//
//	parsed, err := reference.Parse("agt_abc123", "")
//	// parsed.IsID = true, parsed.ID = "agt_abc123"
//
// # Error Handling
//
// The package provides typed errors for specific failure modes:
//
//   - ErrEmptyReference: Reference string is empty
//   - ErrEmptyOrg: Organization is empty (in org/slug format)
//   - ErrEmptySlug: Slug is empty (in org/slug format)
//   - ErrOrgRequired: Slug-only reference without context organization
//
// All errors include context about what was being parsed.
package reference
