package root

import (
	"fmt"
	"strings"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/panel"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/termctl"
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
		// In expanded mode the plan appears in scrollback and needs a
		// trailing gap. In collapsed mode renderCommittedItem returns ""
		// so the gap is never emitted regardless of this value.
		return true
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
//
// kindTodoUpdate items are deferred and rendered at the very end so the
// plan always appears below all messages/tool output regardless of when
// the first todo event arrived in the session.
func renderHistoryBatch(items []committedItem, opts toolrender.CompactOptions, expanded bool, showExpandHint bool) string {
	if len(items) == 0 {
		return ""
	}
	var b strings.Builder
	first := true
	var lastKind committedKind
	var deferredTodo *committedItem
	for i := range items {
		if items[i].kind == kindTodoUpdate {
			deferredTodo = &items[i]
			continue
		}
		text := renderCommittedItem(items[i], opts, expanded, showExpandHint)
		if text == "" {
			continue
		}
		if !first {
			b.WriteByte('\n')
			if needsLeadingGap(lastKind, items[i].kind) {
				b.WriteByte('\n')
			}
		}
		b.WriteString(text)
		if items[i].kind == kindHeader {
			b.WriteByte('\n')
		}
		if needsTrailingGap(items[i].kind) {
			b.WriteByte('\n')
		}
		lastKind = items[i].kind
		first = false
	}
	if deferredTodo != nil {
		text := renderCommittedItem(*deferredTodo, opts, expanded, showExpandHint)
		if text != "" {
			if !first {
				b.WriteByte('\n')
				if needsLeadingGap(lastKind, deferredTodo.kind) {
					b.WriteByte('\n')
				}
			}
			b.WriteString(text)
			if needsTrailingGap(deferredTodo.kind) {
				b.WriteByte('\n')
			}
			first = false
		}
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

	// existingContent is the file content read from disk before a write
	// tool overwrites it. Stored so that history re-renders of
	// kindApproval items can show a diff preview for write tools. Empty
	// when the file didn't exist, wasn't readable, or the tool is not a
	// write tool.
	existingContent string

	// todoTotal and todoCompleted track plan progress for kindTodoUpdate
	// items. When todoCompleted == todoTotal (all done), the expanded
	// renderer shows a compact summary instead of the full item list.
	todoTotal     int
	todoCompleted int
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
		if expanded {
			return item.text
		}
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
	tc := item.toolCalls[0]
	var result string
	if item.existingContent != "" && toolrender.IsWriteTool(tc.Name) {
		result = toolrender.RenderApprovalResultWithOldContent(tc, item.action, item.existingContent, opts)
	} else {
		result = toolrender.RenderApprovalResult(tc, item.action, opts)
	}
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

	subject := toolrender.Truncate(toolrender.FirstLine(block.subject), 80)
	header := fmt.Sprintf("%s %s: %s",
		toolrender.BulletGreen("●"), toolrender.LabelBold("Sub-agent"), subject)

	if !expanded {
		return renderSubAgentCollapsed(header, block)
	}
	return renderSubAgentExpanded(header, block, opts)
}

func renderSubAgentCollapsed(header string, block *subAgentBlock) string {
	var suffix string
	switch block.status {
	case agentexecutionv1.SubAgentStatus_SUB_AGENT_FAILED:
		suffix = fmt.Sprintf("✗ Failed (%d tools)", block.toolCount)
	case agentexecutionv1.SubAgentStatus_SUB_AGENT_CANCELLED:
		suffix = fmt.Sprintf("⊘ Cancelled (%d tools)", block.toolCount)
	default:
		suffix = fmt.Sprintf("✓ Done (%d tools)", block.toolCount)
	}
	return header + " " + suffix
}

func renderSubAgentExpanded(header string, block *subAgentBlock, opts toolrender.CompactOptions) string {
	var b strings.Builder
	b.WriteString(header)

	if block.input != "" {
		prompt := toolrender.GutterWrap(toolrender.DimText("Prompt: " + toolrender.Truncate(block.input, 120)))
		b.WriteByte('\n')
		b.WriteString(prompt)
	}

	for _, child := range block.children {
		text := renderCommittedItem(child, opts, true, false)
		if text == "" {
			continue
		}
		guttered := toolrender.GutterWrap(text)
		b.WriteByte('\n')
		b.WriteString(guttered)
	}

	if block.output != "" {
		result := toolrender.GutterWrap(toolrender.DimText("Result: " + toolrender.Truncate(block.output, 120)))
		b.WriteByte('\n')
		b.WriteString(result)
	}

	var footer string
	switch block.status {
	case agentexecutionv1.SubAgentStatus_SUB_AGENT_FAILED:
		footer = fmt.Sprintf("  ✗ Failed (%d tools)", block.toolCount)
	case agentexecutionv1.SubAgentStatus_SUB_AGENT_CANCELLED:
		footer = fmt.Sprintf("  ⊘ Cancelled (%d tools)", block.toolCount)
	default:
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

// triggerReCommit stops the current Bubbletea program, clears the terminal,
// rewrites history directly, and starts a fresh program. No-op when no
// program or factory is active (non-TTY, tests).
func (r *inlineRenderer) triggerReCommit() {
	r.performReCommit()
}

// clearAndHome is the escape sequence that clears the visible screen, moves
// the cursor to row 1 col 1, then erases saved scrollback lines.
const clearAndHome = "\033[2J\033[1;1H\033[3J"

// performReCommit replaces the broken tea.Raw+ClearScreen approach with a
// synchronous program-restart. The old program is stopped, history is
// written directly to the terminal (no Bubbletea involved), and a fresh
// program is started with the necessary state pre-loaded.
func (r *inlineRenderer) performReCommit() {
	if r.cfg.program == nil || r.cfg.programFactory == nil {
		return
	}

	r.cfg.program.Quit()
	r.cfg.program.Wait(2 * time.Second)

	rendered := renderHistoryBatch(
		r.history, r.compactOpts, r.expandMode, r.expandHintEnabled(),
	)
	payload := clearAndHome
	if rendered != "" {
		payload += rendered + "\n"
	}
	fmt.Fprint(r.cfg.status, payload)

	r.cfg.program = r.cfg.programFactory(func(m *inlineBubbleModel) {
		m.currentTask = r.trackedCurrentTask
		m.todoTotal = r.trackedTodoTotal
		m.todoCompleted = r.trackedTodoCompleted
		m.expandMode = r.expandMode
		m.termWidth = termctl.Width(r.cfg.status, 80)
		if r.followUpSendCh != nil {
			m.inputBarMode = inputBarActive
			m.textInputCh = r.followUpSendCh
			m.textInput = newFollowUpTextInput()
			m.textInput.Focus()
		}
		r.transferSubAgentEntries(m)
	})
	if len(r.activeSubAgents) > 0 {
		r.cfg.program.Send(subAgentTickMsg{})
	}
}

// performReCommitWithApproval is like performReCommit but also writes an
// expanded tool view after the history and pre-loads approval state into
// the new program so the approval prompt continues seamlessly.
func (r *inlineRenderer) performReCommitWithApproval(
	expandedView, question string,
	decisionCh chan<- approvalDecision,
	selected int,
) {
	if r.cfg.program == nil || r.cfg.programFactory == nil {
		return
	}

	r.cfg.program.Quit()
	r.cfg.program.Wait(2 * time.Second)

	rendered := renderHistoryBatch(
		r.history, r.compactOpts, r.expandMode, r.expandHintEnabled(),
	)
	payload := clearAndHome
	if rendered != "" {
		payload += rendered + "\n"
	}
	trimmed := strings.TrimRight(expandedView, "\n")
	if trimmed != "" {
		payload += trimmed + "\n"
	}
	fmt.Fprint(r.cfg.status, payload)

	r.cfg.program = r.cfg.programFactory(func(m *inlineBubbleModel) {
		m.currentTask = r.trackedCurrentTask
		m.todoTotal = r.trackedTodoTotal
		m.todoCompleted = r.trackedTodoCompleted
		m.expandMode = r.expandMode
		m.termWidth = termctl.Width(r.cfg.status, 80)
		m.approvalActive = true
		m.approvalContent = question + "\n"
		m.approvalDecisionCh = decisionCh
		m.approvalSelected = selected
		r.transferSubAgentEntries(m)
	})
	if len(r.activeSubAgents) > 0 {
		r.cfg.program.Send(subAgentTickMsg{})
	}
}

// transferSubAgentEntries populates the new Bubbletea model's live sub-agent
// display entries from the renderer's activeSubAgents map. Called inside
// performReCommit and performReCommitWithApproval so that a screen re-draw
// does not cause running sub-agent spinners to vanish.
//
// startedAt from the block is preserved so the elapsed timer continues
// from the real sub-agent start time rather than resetting on every
// re-commit. toolCount is also carried over so the live display stays
// accurate across re-draws.
func (r *inlineRenderer) transferSubAgentEntries(m *inlineBubbleModel) {
	if len(r.activeSubAgents) == 0 {
		return
	}
	for id, block := range r.activeSubAgents {
		m.activeSubAgentEntries = append(m.activeSubAgentEntries, subAgentDisplayEntry{
			id:           id,
			subject:      block.subject,
			spinnerStart: block.startedAt,
			toolCount:    block.toolCount,
		})
	}
}
