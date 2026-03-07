package root

import (
	"fmt"
	"strings"

	tea "charm.land/bubbletea/v2"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/panel"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// needsTrailingGap reports whether a committed item kind requires a blank-line
// gap after it. Used by both renderHistoryBatch (recommit) and
// writeToScrollback (live) so that both codepaths produce identical spacing.
//
// Default is true (safe-by-default spacing). Only items that should stack
// tightly opt out. This avoids the pattern where a new kind silently gets
// no spacing because someone forgot to add it to an allow-list.
func needsTrailingGap(kind committedKind) bool {
	switch kind {
	case kindHeader:
		// Header has its own gap via a separate check in renderHistoryBatch
		// and writeToScrollback. Including it here would double the gap.
		return false
	case kindToolCompact, kindReadGroup:
		// Tool operations stack densely — consecutive reads, shell calls,
		// etc. look best without blank lines between them.
		return false
	case kindAIStreamLine:
		// Individual streaming lines stack tightly within one AI message.
		// The trailing gap for the message as a whole is emitted after the
		// stream ends (using kindAIMessage's trailing-gap rule).
		return false
	case kindTodoUpdate:
		// Rendered exclusively in the composed View(); never appears in
		// scrollback, so trailing gap is irrelevant.
		return false
	}
	return true
}

// needsLeadingGap reports whether a blank-line gap should be inserted
// before the current item based on what was last written to scrollback.
//
// Rule: after a dense-stacking block (tools, reads), add a blank line
// before any non-dense item. This gives visual separation between a
// cluster of tool completions and the next AI message or system event
// without breaking the tight stacking between consecutive tools.
//
// Used by both writeToScrollback (live) and renderHistoryBatch (recommit).
func needsLeadingGap(prev, current committedKind) bool {
	switch prev {
	case kindToolCompact, kindReadGroup:
		switch current {
		case kindToolCompact, kindReadGroup:
			return false
		}
		return true
	}
	return false
}

// renderHistoryBatch renders all history items into a single string for
// batched terminal output. Each non-empty item is separated by a newline,
// matching the newline that tea.Println appends per call. The result is
// suitable for a single tea.Println — reducing N event-loop round-trips
// and N terminal writes to one of each.
//
// The header item (kindHeader) gets an extra trailing newline to produce
// a blank-line gap between the panel and the first content item, matching
// the spacing of the initial render (commitToScrollback + blank line).
func renderHistoryBatch(items []committedItem, opts toolrender.CompactOptions, expanded bool, showExpandHint bool) string {
	if len(items) == 0 {
		return ""
	}
	var b strings.Builder
	first := true
	var lastKind committedKind
	for _, item := range items {
		text := renderCommittedItem(item, opts, expanded, showExpandHint)
		if text == "" {
			continue
		}
		if !first {
			b.WriteByte('\n')
			if needsLeadingGap(lastKind, item.kind) {
				b.WriteByte('\n')
			}
		}
		b.WriteString(text)
		if item.kind == kindHeader {
			b.WriteByte('\n')
		}
		if needsTrailingGap(item.kind) {
			b.WriteByte('\n')
		}
		lastKind = item.kind
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
	kindHeader        committedKind = iota // session header panel (mutable subject)
	kindToolCompact                        // single tool call completion
	kindReadGroup                          // grouped read completions (>= readGroupThreshold)
	kindApproval                           // post-approval collapsed result
	kindAIMessage                          // complete AI message (main or sub-agent)
	kindHumanMessage                       // styled human/user message
	kindSystemMessage                      // system message (dimmed)
	kindSubAgentBlock                      // collapsed sub-agent block (aggregate of internal events)
	kindTodoUpdate                         // plan/todo list snapshot
	kindPhaseChange                        // execution phase transition
	kindText                               // generic pre-rendered text
	kindAIStreamLine                       // single line committed during AI streaming (not stored in history)
)

// lastKindFromHistory returns the committedKind of the last non-empty
// item in history. Used to initialize lastScrollbackKind when resuming
// a session so that gap decisions for the first new item are correct.
func lastKindFromHistory(items []committedItem) committedKind {
	for i := len(items) - 1; i >= 0; i-- {
		if items[i].kind == kindTodoUpdate {
			continue
		}
		return items[i].kind
	}
	return 0
}

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

	// saBlock holds the sub-agent aggregate for kindSubAgentBlock items.
	// Contains the sub-agent's identity, status, and all internal events
	// (children) for collapsed/expanded rendering.
	saBlock *subAgentBlock

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
//
// When showExpandHint is true and the item is in compact mode, a dim
// "(ctrl+o to expand)" suffix is appended to the first line of expandable
// items (tools, read groups, sub-agent blocks).
func renderCommittedItem(item committedItem, opts toolrender.CompactOptions, expanded bool, showExpandHint bool) string {
	switch item.kind {
	case kindHeader:
		return renderHeaderItem(item, expanded)
	case kindToolCompact:
		text := renderToolCompactItem(item, opts, expanded)
		if !expanded && showExpandHint && text != "" && len(item.toolCalls) > 0 && toolrender.IsExpandable(item.toolCalls[0]) {
			text = appendExpandHint(text)
		}
		return text
	case kindReadGroup:
		text := renderReadGroupItem(item, opts, expanded)
		if !expanded && showExpandHint && text != "" && toolrender.IsReadGroupExpandable(item.toolCalls) {
			text = appendExpandHint(text)
		}
		return text
	case kindApproval:
		return renderApprovalItem(item, opts)
	case kindSubAgentBlock:
		text := renderSubAgentBlockItem(item, opts, expanded)
		if !expanded && showExpandHint && text != "" && item.saBlock != nil && len(item.saBlock.children) > 0 {
			text = appendExpandHint(text)
		}
		return text
	case kindTodoUpdate:
		// The plan is rendered exclusively in the composed View() (via
		// planDisplay) so it is always visible above the input bar. Skip
		// it during re-commits to avoid duplication in scrollback.
		return ""
	default:
		return item.text
	}
}

func renderHeaderItem(item committedItem, expanded bool) string {
	if item.header == nil {
		return ""
	}
	content, pw := formatHeaderPanel(*item.header, terminalWidth())
	if content == "" {
		return ""
	}
	return panel.Render(content, panel.Options{
		Title: headerTitle(item.header.Version, expanded),
		Style: panel.StyleBrand,
		Width: pw,
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

// renderSubAgentBlockItem renders a completed sub-agent block.
//
// Collapsed (expanded == false): single summary line with status and tool count.
//
//	"● Task: Explore CLI rendering code ✓ Done (5 tools)"
//	"● Task: Fix auth tests ✗ Failed (3 tools)"
//
// Expanded (expanded == true): header + gutter-wrapped children + footer.
//
//	"● Task: Explore CLI rendering code"
//	"  │ ● Read(file1.go)"
//	"  │     Read 125 lines"
//	"  │ ..."
//	"  ✓ Done (5 tools)"
func renderSubAgentBlockItem(item committedItem, opts toolrender.CompactOptions, expanded bool) string {
	block := item.saBlock
	if block == nil {
		return ""
	}

	label := block.subject
	if label == "" {
		label = block.name
	}

	header := fmt.Sprintf("%s %s: %s",
		toolrender.BulletGreen("●"), toolrender.LabelBold("Task"), label)

	if !expanded {
		return renderSubAgentCollapsed(header, block)
	}
	return renderSubAgentExpanded(header, block, opts)
}

func renderSubAgentCollapsed(header string, block *subAgentBlock) string {
	var suffix string
	if block.status == "failed" {
		suffix = fmt.Sprintf("✗ Failed (%d tools)", block.toolCount)
	} else {
		suffix = fmt.Sprintf("✓ Done (%d tools)", block.toolCount)
	}
	return header + " " + suffix
}

func renderSubAgentExpanded(header string, block *subAgentBlock, opts toolrender.CompactOptions) string {
	var b strings.Builder
	b.WriteString(header)

	for _, child := range block.children {
		text := renderCommittedItem(child, opts, true, false)
		if text == "" {
			continue
		}
		guttered := toolrender.GutterWrap(text)
		b.WriteByte('\n')
		b.WriteString(guttered)
	}

	var footer string
	if block.status == "failed" {
		footer = fmt.Sprintf("  ✗ Failed (%d tools)", block.toolCount)
	} else {
		footer = fmt.Sprintf("  ✓ Done (%d tools)", block.toolCount)
	}
	b.WriteByte('\n')
	b.WriteString(footer)

	return b.String()
}

// expandHintSuffix is the dim "(ctrl+o to expand)" text appended to the
// first line of expandable items in compact mode.
var expandHintSuffix = " " + expandHintStyle.Render("(ctrl+o to expand)")

// appendExpandHint appends the expand-hint suffix to the first line of
// the rendered text. For multi-line output (read groups, expanded tools),
// only the header line receives the hint.
func appendExpandHint(text string) string {
	if text == "" {
		return text
	}
	if idx := strings.IndexByte(text, '\n'); idx >= 0 {
		return text[:idx] + expandHintSuffix + text[idx:]
	}
	return text + expandHintSuffix
}

// triggerReCommit pre-renders the full history into a single string and
// sends it to the Bubbletea model. The model issues a tea.Raw write
// followed by tea.ClearScreen to atomically replace terminal content.
// No-op when no program is active (non-TTY, tests).
func (r *inlineRenderer) triggerReCommit() {
	if r.cfg.program == nil {
		return
	}
	rendered := renderHistoryBatch(r.history, r.compactOpts, r.expandMode, r.expandHintEnabled())
	r.cfg.program.Send(reCommitMsg{rendered: rendered})
}

// clearAndHome is the escape sequence prefix written via tea.Raw during
// re-commit. It clears the visible screen, moves the cursor to row 1
// col 1, then erases saved scrollback lines.
//
// The ordering (\033[2J → \033[1;1H → \033[3J) matters: modern terminals
// (iTerm2, macOS Terminal, Ghostty) push visible content into scrollback
// on \033[2J rather than truly erasing it. \033[3J must follow to wipe
// that pushed content, otherwise duplicates survive in scrollback.
const clearAndHome = "\033[2J\033[1;1H\033[3J"

// buildReCommitCmd returns a tea.Sequence that atomically clears the
// terminal and writes the pre-rendered history via tea.Raw, followed by
// a reCommitDoneMsg that signals the model to restore View() rendering.
//
// Two-phase design:
//
// Phase 1: The calling handler sets reCommitPending = true so View()
// returns empty. This prevents the renderer from issuing cursor
// movements (relative to its stale tracked position) while tea.Raw
// rewrites the terminal. The Raw payload clears the screen and writes
// history; the cursor ends up at the bottom of the history content.
//
// Phase 2: reCommitDoneMsg clears reCommitPending. The renderer sees a
// transition from empty to the composed view and writes it fresh at the
// current cursor position — placing the input bar right below the
// history, which is the correct location.
//
// The rendered content's \n line breaks are replaced with \r\n because
// Bubbletea puts the terminal in raw mode (OPOST/ONLCR disabled). In
// raw mode \n is a bare line-feed — it moves the cursor down without
// returning to column 0. The explicit \r ensures each line starts at
// the left margin.
func buildReCommitCmd(rendered string) tea.Cmd {
	safe := strings.ReplaceAll(rendered, "\n", "\r\n")
	payload := clearAndHome + safe
	if rendered != "" {
		payload += "\r\n"
	}
	return tea.Sequence(
		tea.Raw(payload),
		func() tea.Msg { return reCommitDoneMsg{} },
	)
}
