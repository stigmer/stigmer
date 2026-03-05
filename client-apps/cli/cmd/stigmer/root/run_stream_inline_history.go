package root

import (
	"strings"

	tea "charm.land/bubbletea/v2"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/panel"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// renderHistoryBatch renders all history items into a single string for
// batched terminal output. Each non-empty item is separated by a newline,
// matching the newline that tea.Println appends per call. The result is
// suitable for a single tea.Println — reducing N event-loop round-trips
// and N terminal writes to one of each.
//
// The header item (kindHeader) gets an extra trailing newline to produce
// a blank-line gap between the panel and the first content item, matching
// the spacing of the initial render (statusf + blank line).
func renderHistoryBatch(items []committedItem, opts toolrender.CompactOptions, expanded bool) string {
	if len(items) == 0 {
		return ""
	}
	var b strings.Builder
	first := true
	for _, item := range items {
		text := renderCommittedItem(item, opts, expanded)
		if text == "" {
			continue
		}
		if !first {
			b.WriteByte('\n')
		}
		b.WriteString(text)
		if item.kind == kindHeader {
			b.WriteByte('\n')
		}
		needsGap := item.kind == kindHumanMessage ||
			item.kind == kindSystemMessage ||
			item.kind == kindSubAgentComplete ||
			item.kind == kindPhaseChange
		if needsGap {
			b.WriteByte('\n')
		}
		first = false
	}
	return b.String()
}

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
// to terminal scrollback via tea.Println. Stored in the renderer's history
// for re-rendering.
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
		return renderHeaderItem(item, expanded)
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

func renderHeaderItem(item committedItem, expanded bool) string {
	if item.header == nil {
		return ""
	}
	content := formatSessionHeaderContent(*item.header)
	if content == "" {
		return ""
	}
	return panel.Render(content, panel.Options{
		Title: headerTitle(item.header.Version, expanded),
		Style: panel.StyleBrand,
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

// triggerReCommit pre-renders the full history into a single string and
// sends it to the Bubbletea model. The model issues ClearScreen followed
// by a single Println, producing exactly 2 event-loop passes and 2
// terminal writes instead of N+1. No-op when no program is active
// (non-TTY, tests).
//
// Scrollback deduplication is handled inside buildReCommitCmd by
// prepending \033[3J (Erase Saved Lines) to the Println payload so it
// executes *after* tea.ClearScreen's \033[2J. See buildReCommitCmd for
// the ordering rationale.
func (r *inlineRenderer) triggerReCommit() {
	if r.cfg.program == nil {
		return
	}
	rendered := renderHistoryBatch(r.history, r.compactOpts, r.expandMode)
	r.cfg.program.Send(reCommitMsg{rendered: rendered})
}

// eraseScrollback is prepended to Println content during re-commit so
// that \033[3J executes after tea.ClearScreen's \033[2J.
//
// Ordering matters: in modern terminals (iTerm2, macOS Terminal, Ghostty)
// \033[2J pushes the visible screen into scrollback rather than truly
// erasing it. If \033[3J runs before \033[2J, the freshly-pushed content
// survives and the user sees duplicates when scrolling up.
//
// By embedding \033[3J at the start of the Println payload, the terminal
// processes the sequence as: \033[2J (push to scrollback) → \033[3J
// (wipe scrollback) → rendered content (fresh history).
const eraseScrollback = "\033[3J"

// buildReCommitCmd returns ClearScreen + a single Println containing
// the pre-rendered history. Used by the Bubbletea model's handleReCommit.
//
// \033[3J is prepended to the Println content rather than written
// separately before ClearScreen. This guarantees the erase-scrollback
// runs after \033[2J within a single Bubbletea event-loop tick,
// eliminating the race that previously left duplicates in scrollback.
func buildReCommitCmd(rendered string) tea.Cmd {
	if rendered == "" {
		return tea.Sequence(tea.ClearScreen, tea.Println(eraseScrollback))
	}
	return tea.Sequence(tea.ClearScreen, tea.Println(eraseScrollback+rendered))
}
