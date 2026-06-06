package toolrender

// Harness-agnostic tool classification for the CLI.
//
// This mirrors @stigmer/sdk's resolveToolKind and the runner classifier. The
// package stays decoupled from proto types (see ToolCallInfo), so ToolKind is a
// local string type whose values match the proto enum value names — callers map
// proto ToolKind -> this when converting. The shared, machine-checked contract
// is test/fixtures/tool-view/classification.json.

// ToolKind is the harness-agnostic category of a tool call. Values match the
// proto enum (ai.stigmer.agentic.agentexecution.v1.ToolKind) value names.
type ToolKind string

const (
	ToolKindUnspecified ToolKind = "TOOL_KIND_UNSPECIFIED"
	ToolKindFileRead    ToolKind = "TOOL_KIND_FILE_READ"
	ToolKindFileWrite   ToolKind = "TOOL_KIND_FILE_WRITE"
	ToolKindFileEdit    ToolKind = "TOOL_KIND_FILE_EDIT"
	ToolKindFileDelete  ToolKind = "TOOL_KIND_FILE_DELETE"
	ToolKindShell       ToolKind = "TOOL_KIND_SHELL"
	ToolKindSearch      ToolKind = "TOOL_KIND_SEARCH"
	ToolKindList        ToolKind = "TOOL_KIND_LIST"
	ToolKindFetch       ToolKind = "TOOL_KIND_FETCH"
	ToolKindWebSearch   ToolKind = "TOOL_KIND_WEB_SEARCH"
	ToolKindThink       ToolKind = "TOOL_KIND_THINK"
	ToolKindTodo        ToolKind = "TOOL_KIND_TODO"
	ToolKindSubagent    ToolKind = "TOOL_KIND_SUBAGENT"
	ToolKindMcp         ToolKind = "TOOL_KIND_MCP"
)

// nameToKind maps a bare tool name to its kind, covering both harness naming
// conventions. A name found here is a built-in and wins over a non-empty slug.
var nameToKind = map[string]ToolKind{
	"read": ToolKindFileRead, "read_file": ToolKindFileRead, "Read": ToolKindFileRead,

	"write": ToolKindFileWrite, "write_file": ToolKindFileWrite,
	"create_file": ToolKindFileWrite, "overwrite_file": ToolKindFileWrite, "Write": ToolKindFileWrite,

	"edit": ToolKindFileEdit, "edit_file": ToolKindFileEdit, "str_replace_editor": ToolKindFileEdit,
	"StrReplace": ToolKindFileEdit, "EditNotebook": ToolKindFileEdit,

	"delete": ToolKindFileDelete, "delete_file": ToolKindFileDelete,
	"remove_file": ToolKindFileDelete, "Delete": ToolKindFileDelete,

	"shell": ToolKindShell, "bash": ToolKindShell, "execute": ToolKindShell,
	"execute_command": ToolKindShell, "run_command": ToolKindShell, "terminal": ToolKindShell, "Shell": ToolKindShell,

	"grep": ToolKindSearch, "glob": ToolKindSearch, "search": ToolKindSearch,
	"ripgrep": ToolKindSearch, "find_files": ToolKindSearch,
	"Grep": ToolKindSearch, "Glob": ToolKindSearch, "SemanticSearch": ToolKindSearch,

	"ls": ToolKindList, "list_directory": ToolKindList,

	"WebFetch": ToolKindFetch, "WebSearch": ToolKindWebSearch,

	"think": ToolKindThink,

	"write_todos": ToolKindTodo, "updateTodos": ToolKindTodo, "TodoWrite": ToolKindTodo,

	"task": ToolKindSubagent, "Task": ToolKindSubagent,
}

// ClassifyToolByName classifies a tool by name and MCP slug. Built-in names win;
// an unknown name with a non-empty slug is an MCP tool; otherwise UNSPECIFIED.
func ClassifyToolByName(name, mcpServerSlug string) ToolKind {
	if kind, ok := nameToKind[name]; ok {
		return kind
	}
	if mcpServerSlug != "" {
		return ToolKindMcp
	}
	return ToolKindUnspecified
}

// ResolveToolKind returns the wire kind when set, falling back to a name lookup
// for legacy executions where it is UNSPECIFIED.
func ResolveToolKind(wireKind ToolKind, name, mcpServerSlug string) ToolKind {
	if wireKind != "" && wireKind != ToolKindUnspecified {
		return wireKind
	}
	return ClassifyToolByName(name, mcpServerSlug)
}
