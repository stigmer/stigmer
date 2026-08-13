// Package enabledtools classifies enabled-tools selections against an MCP
// server's discovered capabilities.
//
// It is the shared core of the apply-time validation added for issue #402:
// the agent controller checks McpServerUsage.enabled_tools and the mcpserver
// controller checks McpServerSpec.default_enabled_tools, and both must agree
// on what counts as a valid tool name. Keeping the classification here — in
// the domain that owns capability semantics — prevents the two error paths
// from drifting.
//
// The classification deliberately distinguishes resource templates from
// plainly unknown names: a resource-template name in an enabled-tools list is
// a specific, documented mistake (templates are read-only data endpoints, not
// callable tools — see DiscoveredCapabilities in mcpserver/v1/status.proto),
// and the error message should say so instead of implying a typo.
package enabledtools

import (
	"strings"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
)

// Classification partitions the requested-but-invalid names of an
// enabled-tools list. Names present in the server's discovered tools appear
// in neither slice. Order follows the requested list (stable, deterministic
// error messages).
type Classification struct {
	// Unknown holds names the server exposes neither as a tool nor as a
	// resource template — almost always typos or stale entries.
	Unknown []string
	// ResourceTemplates holds names that match a discovered resource
	// template: real names on the server, but never callable as tools.
	ResourceTemplates []string
}

// Valid reports whether every requested name resolved to a discovered tool.
func (c Classification) Valid() bool {
	return len(c.Unknown) == 0 && len(c.ResourceTemplates) == 0
}

// Classify checks each requested name against the discovered capabilities.
// Matching is exact and case-sensitive — tool names must match what the
// server reports via tools/list (see McpServerUsage.enabled_tools docs).
//
// Callers are expected to skip validation entirely when capabilities are
// absent (server not yet connected); passing nil capabilities here would
// classify every name as unknown, which is not a statement the platform can
// honestly make before the first discovery.
func Classify(caps *mcpserverv1.DiscoveredCapabilities, requested []string) Classification {
	tools := make(map[string]struct{}, len(caps.GetTools()))
	for _, tool := range caps.GetTools() {
		tools[tool.GetName()] = struct{}{}
	}
	templates := make(map[string]struct{}, len(caps.GetResourceTemplates()))
	for _, tmpl := range caps.GetResourceTemplates() {
		templates[tmpl.GetName()] = struct{}{}
	}

	var result Classification
	for _, name := range requested {
		if _, ok := tools[name]; ok {
			continue
		}
		if _, ok := templates[name]; ok {
			result.ResourceTemplates = append(result.ResourceTemplates, name)
			continue
		}
		result.Unknown = append(result.Unknown, name)
	}
	return result
}

// ToolNames returns the discovered tool names in discovery order, for use in
// error messages that tell the operator what IS valid.
func ToolNames(caps *mcpserverv1.DiscoveredCapabilities) []string {
	names := make([]string, 0, len(caps.GetTools()))
	for _, tool := range caps.GetTools() {
		names = append(names, tool.GetName())
	}
	return names
}

// QuoteJoin renders a name list as 'a', 'b', 'c' for error messages — shared
// so the agent and mcpserver error texts quote tool names identically.
func QuoteJoin(names []string) string {
	quoted := make([]string, len(names))
	for i, n := range names {
		quoted[i] = "'" + n + "'"
	}
	return strings.Join(quoted, ", ")
}
