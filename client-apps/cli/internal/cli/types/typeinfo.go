package types

import (
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
)

// TypeInfo contains CLI metadata for a resource type.
// Built from proto ApiResourceKind metadata with derived aliases.
type TypeInfo struct {
	// Name is the kind name from proto kind_meta.name (e.g., "McpServer").
	// This matches the YAML "kind" field value.
	Name string

	// DisplayName is the human-readable name from proto kind_meta.display_name.
	// Example: "MCP Server"
	DisplayName string

	// IdPrefix is the ID prefix from proto kind_meta.id_prefix.
	// Example: "mcp" for MCP servers, "agt" for agents.
	IdPrefix string

	// Singular is the canonical CLI singular form (lowercase of Name).
	// Example: "mcpserver"
	Singular string

	// Plural is the pluralized form for list commands.
	// Example: "mcpservers"
	Plural string

	// Aliases contains all accepted input forms for this type.
	// Generated algorithmically from Name, DisplayName, and IdPrefix.
	// Includes variations like "mcp-server", "mcp_server", "MCP", etc.
	Aliases []string

	// SupportedVerbs defines which verbs this type supports.
	// This is CLI-specific logic, not from proto.
	SupportedVerbs map[Verb]bool

	// ProtoKind is the link to the proto enum value.
	ProtoKind apiresourcekind.ApiResourceKind
}

// SupportsVerb checks if this type supports a given verb.
func (t *TypeInfo) SupportsVerb(verb Verb) bool {
	if t.SupportedVerbs == nil {
		return false
	}
	return t.SupportedVerbs[verb]
}

// SupportedVerbList returns the list of verbs this type supports.
func (t *TypeInfo) SupportedVerbList() []Verb {
	var verbs []Verb
	for _, v := range AllVerbs() {
		if t.SupportsVerb(v) {
			verbs = append(verbs, v)
		}
	}
	return verbs
}
