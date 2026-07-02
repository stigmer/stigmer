package approval

// Coarse, cross-taxonomy approval category of a gated built-in tool — the Go
// edition of toolApprovalCategory (backend/services/runner/src/shared/tool-kind.ts).
//
// FILE_WRITE and FILE_EDIT both collapse to "write" on purpose: the Cursor
// preToolUse hook reports every file mutation (create or edit) as `Write`, while
// the SDK stream names them `edit`/`write`. The category is therefore the only
// tool identity stable across the hook and stream taxonomies, which is exactly
// what the coarse approval fingerprint matches on. This table must stay in
// lockstep with the TS TOOL_NAME_TO_KIND map (the machine-checked contract for
// the full classification lives in the runner's classification.json fixture; the
// subset reproduced here is only the gated, mutating names the category needs).

// toolNameToCategory maps a built-in tool name (either harness's naming) to its
// approval category. Only mutating built-ins appear; everything else (read-only
// built-ins, MCP tools, unknown names) has no category and is matched by other
// means.
var toolNameToCategory = map[string]string{
	// FILE_WRITE + FILE_EDIT collapse to "write".
	"write":              "write",
	"write_file":         "write",
	"create_file":        "write",
	"overwrite_file":     "write",
	"Write":              "write",
	"edit":               "write",
	"edit_file":          "write",
	"str_replace_editor": "write",
	"StrReplace":         "write",
	"EditNotebook":       "write",

	// FILE_DELETE.
	"delete":      "delete",
	"delete_file": "delete",
	"remove_file": "delete",
	"Delete":      "delete",

	// SHELL.
	"shell":           "shell",
	"bash":            "shell",
	"execute":         "shell",
	"execute_command": "shell",
	"run_command":     "shell",
	"terminal":        "shell",
	"Shell":           "shell",
}

// ToolApprovalCategory returns the approval category ("write"/"delete"/"shell")
// of a gated built-in tool, and ok=false for tools that are not gated by category
// (read-only built-ins, MCP tools, and unknown names).
func ToolApprovalCategory(name string) (string, bool) {
	category, ok := toolNameToCategory[name]
	return category, ok
}
