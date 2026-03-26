// Package convert provides shared conversion utilities used by generated
// MCP input-to-proto code. These functions are called from the generated
// ToProto() methods in mcp-server/gen/<domain>/ packages.
package convert

import (
	"strings"

	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource"
)

// GenerateSlug converts a human-readable name to a URL-friendly slug.
// Matches the convention used by the backend and sdk/go/stigmer/naming.
func GenerateSlug(name string) string {
	if name == "" {
		return ""
	}

	var b strings.Builder
	b.Grow(len(name))
	lastHyphen := false
	for _, r := range strings.ToLower(name) {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
			lastHyphen = false
		default:
			if !lastHyphen {
				b.WriteRune('-')
				lastHyphen = true
			}
		}
	}
	return strings.Trim(b.String(), "-")
}

// VisibilityFromString converts a string visibility value to the proto enum.
// Defaults to PRIVATE if the value is empty or unrecognized.
func VisibilityFromString(s string) apiresource.ApiResourceVisibility {
	if strings.EqualFold(s, "PUBLIC") {
		return apiresource.ApiResourceVisibility_visibility_public
	}
	return apiresource.ApiResourceVisibility_visibility_private
}
