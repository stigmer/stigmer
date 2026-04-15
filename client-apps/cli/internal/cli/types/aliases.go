package types

import (
	"strings"
	"unicode"
)

// GenerateAliases creates all accepted input forms from proto metadata.
// Aliases are derived algorithmically, not hardcoded.
//
// From name "McpServer" generates: "mcpserver", "mcp-server", "mcp_server", "McpServer"
// From displayName "MCP Server" generates: "mcp", "MCP"
// From idPrefix "mcp" generates: "mcp"
// Also generates plural forms of all aliases.
func GenerateAliases(name, displayName, idPrefix string) []string {
	seen := make(map[string]bool)
	var aliases []string

	addAlias := func(alias string) {
		if alias == "" {
			return
		}
		lower := strings.ToLower(alias)
		if !seen[lower] {
			seen[lower] = true
			aliases = append(aliases, alias)
		}
	}

	// From name: "McpServer"
	addAlias(strings.ToLower(name)) // "mcpserver"
	addAlias(toKebabCase(name))     // "mcp-server"
	addAlias(toSnakeCase(name))     // "mcp_server"
	addAlias(name)                  // "McpServer"

	// From display_name: "MCP Server"
	// For single-word display names, add lowercase and uppercase as aliases.
	// For multi-word display names, add the first word only when it differs
	// from the lowercased name (avoids "Agent Instance" stealing "agent"
	// from "Agent", while still allowing "MCP Server" to register "mcp").
	words := strings.Fields(displayName)
	if len(words) == 1 {
		addAlias(strings.ToLower(words[0]))
		addAlias(strings.ToUpper(words[0]))
	} else if len(words) > 1 {
		firstWord := strings.ToLower(words[0])
		lowerName := strings.ToLower(name)
		if !strings.HasPrefix(lowerName, firstWord) || firstWord == lowerName {
			addAlias(firstWord)
			addAlias(strings.ToUpper(words[0]))
		}
	}

	// From id_prefix: "mcp"
	addAlias(idPrefix)

	// Add plurals
	singulars := make([]string, len(aliases))
	copy(singulars, aliases)
	for _, alias := range singulars {
		addAlias(pluralize(alias))
	}

	return aliases
}

// toKebabCase converts a PascalCase string to kebab-case.
// Example: "McpServer" -> "mcp-server"
func toKebabCase(s string) string {
	if s == "" {
		return s
	}

	var result strings.Builder
	for i, r := range s {
		if i > 0 && unicode.IsUpper(r) {
			result.WriteRune('-')
		}
		result.WriteRune(unicode.ToLower(r))
	}
	return result.String()
}

// toSnakeCase converts a PascalCase string to snake_case.
// Example: "McpServer" -> "mcp_server"
func toSnakeCase(s string) string {
	if s == "" {
		return s
	}

	var result strings.Builder
	for i, r := range s {
		if i > 0 && unicode.IsUpper(r) {
			result.WriteRune('_')
		}
		result.WriteRune(unicode.ToLower(r))
	}
	return result.String()
}

// pluralize adds an 's' suffix for simple English pluralization.
// Handles common cases like "workflow" -> "workflows".
// For more complex cases, the singular form also works via alias lookup.
func pluralize(s string) string {
	if s == "" {
		return s
	}

	// Already plural
	if strings.HasSuffix(s, "s") {
		return s
	}

	// Common irregular plurals are not needed since we accept singular too
	return s + "s"
}

// NormalizeAlias normalizes user input for alias lookup.
// Converts to lowercase for case-insensitive matching.
func NormalizeAlias(input string) string {
	return strings.ToLower(strings.TrimSpace(input))
}
