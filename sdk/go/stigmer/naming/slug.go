package naming

import (
	"fmt"
	"regexp"
	"strings"
)

// GenerateSlug converts a name into a URL-friendly slug.
//
// This implementation matches the backend (Java & Go) to ensure consistency.
// The slug generation follows these rules:
//   - Replace non-alphanumeric characters (except hyphens) with hyphens
//   - Replace spaces with hyphens
//   - Convert to lowercase
//   - Collapse multiple consecutive hyphens into single hyphen
//   - Trim leading and trailing hyphens
//
// Examples:
//   - "My Cool Agent" → "my-cool-agent"
//   - "Code Analysis & Review" → "code-analysis-review"
//   - "Data Processing (v2)" → "data-processing-v2"
//   - "Special@#$Characters" → "special-characters"
//
// Note: This does NOT truncate slugs to avoid silent collisions where
// two different names would generate the same slug after truncation.
func GenerateSlug(name string) string {
	if name == "" {
		return ""
	}

	// 1. Replace non-alphanumeric characters (except hyphens) with hyphens
	slug := replaceNonAlphanumericWithHyphen(name)

	// 2. Replace spaces with hyphens
	slug = strings.ReplaceAll(slug, " ", "-")

	// 3. Convert to lowercase
	slug = strings.ToLower(slug)

	// 4. Collapse multiple consecutive hyphens
	slug = collapseHyphens(slug)

	// 5. Trim leading and trailing hyphens
	slug = strings.Trim(slug, "-")

	return slug
}

// ValidateSlug checks if a slug matches the expected format.
//
// Valid slugs:
//   - Must contain only lowercase letters, numbers, and hyphens
//   - Cannot start or end with a hyphen
//   - Must be at least 1 character long
//
// Examples:
//   - "my-agent" ✓
//   - "code-review-v2" ✓
//   - "a" ✓
//   - "-invalid" ✗ (starts with hyphen)
//   - "invalid-" ✗ (ends with hyphen)
//   - "Invalid" ✗ (uppercase)
func ValidateSlug(slug string) error {
	if slug == "" {
		return fmt.Errorf("slug cannot be empty")
	}

	// Pattern allows:
	// - Single character: ^[a-z0-9]$
	// - Multiple characters: ^[a-z0-9][a-z0-9-]*[a-z0-9]$
	pattern := regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`)
	if !pattern.MatchString(slug) {
		return fmt.Errorf("invalid slug %q: must contain only lowercase letters, numbers, and hyphens (cannot start/end with hyphen)", slug)
	}

	return nil
}

// replaceNonAlphanumericWithHyphen replaces all non-alphanumeric characters
// (except hyphens and spaces) with hyphens.
// This matches the Java backend behavior: [^\\w-] → "-"
func replaceNonAlphanumericWithHyphen(s string) string {
	var builder strings.Builder
	builder.Grow(len(s))

	for _, r := range s {
		// Keep alphanumeric (a-z, A-Z, 0-9), hyphens, and spaces
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == ' ' {
			builder.WriteRune(r)
		} else {
			// Replace special characters with hyphen
			builder.WriteRune('-')
		}
	}

	return builder.String()
}

// collapseHyphens replaces multiple consecutive hyphens with a single hyphen.
func collapseHyphens(s string) string {
	var builder strings.Builder
	builder.Grow(len(s))

	lastWasHyphen := false
	for _, r := range s {
		if r == '-' {
			if !lastWasHyphen {
				builder.WriteRune(r)
				lastWasHyphen = true
			}
		} else {
			builder.WriteRune(r)
			lastWasHyphen = false
		}
	}

	return builder.String()
}
