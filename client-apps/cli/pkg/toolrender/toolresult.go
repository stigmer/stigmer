package toolrender

// Go mirror of @stigmer/sdk's normalizeToolResult. Turns an opaque tool result
// string into a typed view so the CLI renders diffs, terminals, and search
// lists instead of raw JSON. Engine result formats are version-fragile, so this
// is validated against the same golden fixtures as the TS implementation
// (test/fixtures/tool-view/result-views.json) to guarantee cross-language parity.

import (
	"encoding/json"
	"regexp"
	"strings"
)

// ResultViewType discriminates a ToolResultView.
type ResultViewType string

const (
	ResultDiff          ResultViewType = "diff"
	ResultFile          ResultViewType = "file"
	ResultTerminal      ResultViewType = "terminal"
	ResultSearch        ResultViewType = "search"
	ResultList          ResultViewType = "list"
	ResultContentBlocks ResultViewType = "contentBlocks"
	ResultText          ResultViewType = "text"
	ResultJSON          ResultViewType = "json"
	ResultError         ResultViewType = "error"
	ResultEmpty         ResultViewType = "empty"
)

// SearchMatch is a single search/grep hit.
type SearchMatch struct {
	File string
	Line int
	Text string
}

// ContentBlock is an MCP content block.
type ContentBlock struct {
	Type string
	Text string
}

// ToolResultView is the typed projection of a tool result. Only the fields
// relevant to Type are populated. It mirrors the @stigmer/sdk discriminated union.
type ToolResultView struct {
	Type ResultViewType

	// diff
	Path         string
	OldText      string
	NewText      string
	LinesAdded   *int
	LinesRemoved *int
	UnifiedDiff  string

	// file
	Content   string
	Language  string
	Truncated bool

	// terminal
	Stdout   string
	Stderr   string
	ExitCode *int

	// search / list
	Matches []SearchMatch
	Entries []string
	Count   int

	// contentBlocks
	Blocks        []ContentBlock
	McpServerSlug string

	// text / json / error
	Text    string
	JSON    interface{}
	Message string
}

// NormalizeInput is the proto-decoupled input to NormalizeToolResult.
type NormalizeInput struct {
	Name          string
	Args          map[string]interface{}
	Result        string
	Error         string
	Failed        bool
	McpServerSlug string
	WireKind      ToolKind
}

var (
	pathFields    = []string{"path", "file_path", "file", "filename"}
	oldTextFields = []string{"old_string", "old_text", "oldText"}
	newTextFields = []string{"new_string", "new_text", "newText", "replacement"}
	writeFields   = []string{"contents", "content", "file_content"}

	// Matches the deepagents shell marker. Format owned by the engine (DD-003);
	// covered by the golden fixtures so a change fails one test.
	shellExitMarker = regexp.MustCompile(`\n?\[Command (?:succeeded|failed with exit code (\d+))\]\s*$`)
	grepMatchLine   = regexp.MustCompile(`^\s*\d+[:\t]`)
	truncatedMark   = regexp.MustCompile(`\[truncated: \d+ chars total\]`)
)

// NormalizeToolResult mirrors the TS normalizer. A failed tool with an error
// yields an error view; otherwise the kind drives interpretation and anything
// unrecognized degrades to json/text.
func NormalizeToolResult(in NormalizeInput) ToolResultView {
	if in.Failed && (in.Error != "" || in.Result != "") {
		msg := in.Error
		if msg == "" {
			msg = in.Result
		}
		return ToolResultView{Type: ResultError, Message: msg}
	}

	kind := ResolveToolKind(in.WireKind, in.Name, in.McpServerSlug)

	switch kind {
	case ToolKindFileEdit:
		return normalizeEdit(in)
	case ToolKindFileWrite:
		path := firstString(in.Args, pathFields)
		return ToolResultView{Type: ResultFile, Path: path, Content: firstString(in.Args, writeFields), Language: languageFromPath(path)}
	case ToolKindFileRead:
		path := firstString(in.Args, pathFields)
		return ToolResultView{Type: ResultFile, Path: path, Content: in.Result, Language: languageFromPath(path), Truncated: truncatedMark.MatchString(in.Result)}
	case ToolKindFileDelete:
		if in.Result != "" {
			return ToolResultView{Type: ResultText, Text: in.Result}
		}
		return ToolResultView{Type: ResultEmpty}
	case ToolKindShell:
		return normalizeShell(in.Result)
	case ToolKindSearch:
		return normalizeSearch(in.Result)
	case ToolKindList:
		entries := nonEmptyLines(in.Result)
		return ToolResultView{Type: ResultList, Entries: entries, Count: len(entries)}
	case ToolKindThink:
		thought := firstString(in.Args, []string{"thought"})
		if thought == "" {
			thought = in.Result
		}
		return ToolResultView{Type: ResultText, Text: thought}
	case ToolKindMcp:
		return normalizeMcp(in.Result, in.McpServerSlug)
	default:
		return genericView(in.Result)
	}
}

func normalizeEdit(in NormalizeInput) ToolResultView {
	view := ToolResultView{
		Type:    ResultDiff,
		Path:    firstString(in.Args, pathFields),
		OldText: firstString(in.Args, oldTextFields),
		NewText: firstString(in.Args, newTextFields),
	}
	if parsed := tryParseObject(in.Result); parsed != nil {
		if value, ok := parsed["value"].(map[string]interface{}); ok {
			if n, ok := asInt(value["linesAdded"]); ok {
				view.LinesAdded = &n
			}
			if n, ok := asInt(value["linesRemoved"]); ok {
				view.LinesRemoved = &n
			}
			if s, ok := value["diffString"].(string); ok {
				view.UnifiedDiff = s
			}
		}
	}
	return view
}

func normalizeShell(result string) ToolResultView {
	if parsed := tryParseObject(result); parsed != nil {
		_, hasStdout := parsed["stdout"]
		_, hasExit := parsed["exitCode"]
		if hasStdout || hasExit {
			v := ToolResultView{Type: ResultTerminal}
			if s, ok := parsed["stdout"].(string); ok {
				v.Stdout = s
			}
			if s, ok := parsed["stderr"].(string); ok {
				v.Stderr = s
			}
			if n, ok := asInt(parsed["exitCode"]); ok {
				v.ExitCode = &n
			}
			return v
		}
	}

	if m := shellExitMarker.FindStringSubmatch(result); m != nil {
		stdout := shellExitMarker.ReplaceAllString(result, "")
		code := 0
		if m[1] != "" {
			if n, ok := asIntString(m[1]); ok {
				code = n
			}
		}
		return ToolResultView{Type: ResultTerminal, Stdout: stdout, ExitCode: &code}
	}

	return ToolResultView{Type: ResultTerminal, Stdout: result}
}

func normalizeSearch(result string) ToolResultView {
	lines := nonEmptyLines(result)
	var matchLines []string
	for _, l := range lines {
		if grepMatchLine.MatchString(l) {
			matchLines = append(matchLines, l)
		}
	}
	if len(matchLines) > 0 {
		matches := make([]SearchMatch, 0, len(matchLines))
		for _, l := range matchLines {
			matches = append(matches, SearchMatch{Text: strings.TrimSpace(l)})
		}
		return ToolResultView{Type: ResultSearch, Matches: matches, Count: len(matches)}
	}

	noResults := regexp.MustCompile(`(?i)^no (files|matches|results)`)
	var matches []SearchMatch
	for _, l := range lines {
		if !noResults.MatchString(l) {
			matches = append(matches, SearchMatch{Text: l})
		}
	}
	return ToolResultView{Type: ResultSearch, Matches: matches, Count: len(matches)}
}

func normalizeMcp(result, slug string) ToolResultView {
	parsed := tryParseAny(result)
	if blocks := extractContentBlocks(parsed); blocks != nil {
		return ToolResultView{Type: ResultContentBlocks, Blocks: blocks, McpServerSlug: slug}
	}
	switch parsed.(type) {
	case map[string]interface{}, []interface{}:
		return ToolResultView{Type: ResultJSON, JSON: parsed}
	}
	if result != "" {
		return ToolResultView{Type: ResultText, Text: result}
	}
	return ToolResultView{Type: ResultEmpty}
}

func genericView(result string) ToolResultView {
	if result == "" {
		return ToolResultView{Type: ResultEmpty}
	}
	parsed := tryParseAny(result)
	switch parsed.(type) {
	case map[string]interface{}, []interface{}:
		return ToolResultView{Type: ResultJSON, JSON: parsed}
	}
	return ToolResultView{Type: ResultText, Text: result}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func firstString(args map[string]interface{}, fields []string) string {
	if args == nil {
		return ""
	}
	for _, f := range fields {
		if v, ok := args[f].(string); ok && v != "" {
			return v
		}
	}
	return ""
}

func nonEmptyLines(s string) []string {
	var out []string
	for _, l := range strings.Split(s, "\n") {
		trimmed := strings.TrimRight(l, " \t\r\n")
		if strings.TrimSpace(trimmed) != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func tryParseAny(s string) interface{} {
	t := strings.TrimSpace(s)
	if t == "" || (t[0] != '{' && t[0] != '[') {
		return nil
	}
	var v interface{}
	if err := json.Unmarshal([]byte(t), &v); err != nil {
		return nil
	}
	return v
}

func tryParseObject(s string) map[string]interface{} {
	if obj, ok := tryParseAny(s).(map[string]interface{}); ok {
		return obj
	}
	return nil
}

func extractContentBlocks(parsed interface{}) []ContentBlock {
	var content []interface{}
	switch p := parsed.(type) {
	case map[string]interface{}:
		if c, ok := p["content"].([]interface{}); ok {
			content = c
		}
	case []interface{}:
		content = p
	}
	if content == nil {
		return nil
	}
	var blocks []ContentBlock
	for _, item := range content {
		if obj, ok := item.(map[string]interface{}); ok {
			if t, ok := obj["type"].(string); ok {
				b := ContentBlock{Type: t}
				if txt, ok := obj["text"].(string); ok {
					b.Text = txt
				}
				blocks = append(blocks, b)
			}
		}
	}
	if len(blocks) == 0 {
		return nil
	}
	return blocks
}

func asInt(v interface{}) (int, bool) {
	if f, ok := v.(float64); ok {
		return int(f), true
	}
	return 0, false
}

func asIntString(s string) (int, bool) {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, false
		}
		n = n*10 + int(c-'0')
	}
	return n, true
}

var extToLang = map[string]string{
	"ts": "typescript", "tsx": "tsx", "js": "javascript", "jsx": "jsx",
	"py": "python", "go": "go", "rs": "rust", "java": "java",
	"rb": "ruby", "sh": "bash", "md": "markdown", "json": "json",
	"yaml": "yaml", "yml": "yaml", "proto": "protobuf", "sql": "sql",
	"css": "css", "html": "html", "toml": "toml",
}

func languageFromPath(path string) string {
	dot := strings.LastIndex(path, ".")
	if dot < 0 {
		return ""
	}
	return extToLang[strings.ToLower(path[dot+1:])]
}
