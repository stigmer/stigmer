package root

import (
	"strings"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/panel"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// committedKind classifies a committed history item for re-rendering.
// Items that may render differently in compact vs expanded mode store
// structured data (ToolCallInfo, sessionHeaderInfo). Mode-invariant
// items store pre-rendered text.
type committedKind int

const (
	kindHeader          committedKind = iota // session header panel (mutable subject)
	kindToolCompact                          // single tool call completion
	kindReadGroup                            // grouped read completions (>= readGroupThreshold)
	kindApproval                             // post-approval collapsed result
	kindAIMessage                            // complete AI message (main or sub-agent)
	kindHumanMessage                         // styled human/user message
	kindSystemMessage                        // system message (dimmed)
	kindSubAgentStart                        // sub-agent lifecycle: started
	kindSubAgentComplete                     // sub-agent lifecycle: completed/failed
	kindTodoUpdate                           // plan/todo list snapshot
	kindPhaseChange                          // execution phase transition
	kindText                                 // generic pre-rendered text
)

// committedItem represents one logical unit of output that was committed
// to terminal scrollback via tea.Println (or direct stderr write for the
// session header). Stored in the renderer's history for re-rendering.
//
// Items that may change between compact and expanded modes store structured
// data (toolCalls, header). Mode-invariant items store pre-rendered text.
type committedItem struct {
	kind committedKind

	// text holds pre-rendered display content for mode-invariant items
	// (AI messages, human messages, system messages, lifecycle, etc.).
	// For AI messages replayed during re-commit, this is the complete
	// formatted content including prefix and trailing whitespace.
	text string

	// subAgentID is set when this item belongs to a sub-agent context.
	// Used by renderCommittedItem to apply gutter-wrapping on re-render.
	subAgentID string

	// toolCalls holds structured data for items that render differently
	// across modes: kindToolCompact (single element), kindReadGroup
	// (multiple elements), kindApproval (single element).
	toolCalls []toolrender.ToolCallInfo

	// header points to the session header metadata. Only set for
	// kindHeader (always history[0]). The Subject field is mutable —
	// updated when the backend resolves the session subject.
	header *sessionHeaderInfo

	// action is the approval decision string ("approve", "skip", "reject")
	// for kindApproval items.
	action string
}

// renderCommittedItem re-renders a history item to its display string.
// The returned string is suitable for tea.Println — no trailing newline.
//
// When expanded is false, output matches what was originally committed via
// statusf/Println during normal rendering. When expanded is true, tool
// completions and read groups use their expanded renderers (full output,
// no truncation). Mode-invariant items (AI messages, system messages,
// lifecycle events) are unaffected by the expanded flag.
func renderCommittedItem(item committedItem, opts toolrender.CompactOptions, expanded bool) string {
	switch item.kind {
	case kindHeader:
		return renderHeaderItem(item)
	case kindToolCompact:
		return renderToolCompactItem(item, opts, expanded)
	case kindReadGroup:
		return renderReadGroupItem(item, opts, expanded)
	case kindApproval:
		return renderApprovalItem(item, opts)
	default:
		return item.text
	}
}

func renderHeaderItem(item committedItem) string {
	if item.header == nil {
		return ""
	}
	content := formatSessionHeaderContent(*item.header)
	if content == "" {
		return ""
	}
	return panel.Render(content, panel.Options{
		Title: "Stigmer",
		Style: panel.StyleDefault,
	})
}

func renderToolCompactItem(item committedItem, opts toolrender.CompactOptions, expanded bool) string {
	if len(item.toolCalls) == 0 {
		return ""
	}
	var line string
	if expanded {
		line = toolrender.RenderExpanded(item.toolCalls[0], opts)
	} else {
		line = toolrender.RenderCompact(item.toolCalls[0], opts)
	}
	if item.subAgentID != "" {
		line = toolrender.GutterWrap(line)
	}
	if strings.Contains(line, "\n") {
		line += "\n"
	}
	return line
}

func renderReadGroupItem(item committedItem, opts toolrender.CompactOptions, expanded bool) string {
	if len(item.toolCalls) == 0 {
		return ""
	}
	var output string
	if len(item.toolCalls) >= readGroupThreshold {
		if expanded {
			output = toolrender.RenderReadGroupExpanded(item.toolCalls, opts)
		} else {
			output = toolrender.RenderReadGroup(item.toolCalls, opts)
		}
	} else {
		var lines []string
		for _, tc := range item.toolCalls {
			if expanded {
				lines = append(lines, toolrender.RenderExpanded(tc, opts))
			} else {
				lines = append(lines, toolrender.RenderCompact(tc, opts))
			}
		}
		output = strings.Join(lines, "\n")
	}
	if item.subAgentID != "" {
		output = toolrender.GutterWrap(output)
	}
	if strings.Contains(output, "\n") {
		output += "\n"
	}
	return output
}

func renderApprovalItem(item committedItem, opts toolrender.CompactOptions) string {
	if len(item.toolCalls) == 0 {
		return ""
	}
	result := toolrender.RenderApprovalResult(item.toolCalls[0], item.action, opts)
	if item.subAgentID != "" {
		result = toolrender.GutterWrap(result)
	}
	return result
}

// triggerReCommit packages the renderer's current history into a reCommitMsg
// and sends it to the Bubbletea model. The model handles the actual
// ClearScreen + Println sequence atomically. No-op when no program is active
// (non-TTY, tests).
//
// Currently always sends expanded=false (subject update is compact-mode only).
// Phase 3 will thread the renderer's expand state through this call.
func (r *inlineRenderer) triggerReCommit() {
	if r.cfg.program == nil {
		return
	}
	snapshot := make([]committedItem, len(r.history))
	copy(snapshot, r.history)
	r.cfg.program.Send(reCommitMsg{
		items:       snapshot,
		compactOpts: r.compactOpts,
		expanded:    false,
	})
}

// reCommitHistory builds a tea.Cmd that clears the terminal and re-commits
// all history items via tea.Println. When expanded is true, tool completions
// and read groups render in expanded mode (full output, no truncation).
// Executed atomically within Bubbletea's render loop so no intermediate
// frame is visible.
func reCommitHistory(items []committedItem, opts toolrender.CompactOptions, expanded bool) tea.Cmd {
	cmds := make([]tea.Cmd, 0, len(items)+1)
	cmds = append(cmds, tea.ClearScreen)
	for _, item := range items {
		text := renderCommittedItem(item, opts, expanded)
		if text != "" {
			cmds = append(cmds, tea.Println(text))
		}
	}
	return tea.Sequence(cmds...)
}
