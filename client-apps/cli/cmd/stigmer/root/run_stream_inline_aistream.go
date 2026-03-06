package root

import (
	"fmt"
	"strings"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
)

// ---------------------------------------------------------------------------
// AI message rendering
//
// When a Bubbletea program is active, AI text is routed entirely through
// Bubbletea: complete lines are committed to scrollback via program.Println,
// and the partial (incomplete) line is shown live in View() via
// aiStreamPartialMsg. This keeps Bubbletea's cursor tracking in sync and
// eliminates the class of bugs caused by mixing direct stdout writes with
// Bubbletea's ANSI cursor management.
//
// When stdout is piped or redirected (dataIsTTY == false), AI text is also
// written to stdout for pipe consumers. Piped stdout does not share the
// terminal cursor, so these writes are safe.
//
// When no Bubbletea program is running (non-TTY, tests, CI), AI text goes
// directly to the data writer (stdout) as before.
// ---------------------------------------------------------------------------

func (r *inlineRenderer) renderAIStreamStart(e executiontui.AIStreamStartEvent) {
	r.finishAIStreamIfNeeded()

	prefix := r.agentPrefix(e.SubAgentID)
	r.streamedBytes = len(e.Content)
	r.inAIStream = true

	if r.cfg.program != nil {
		r.aiStreamPrefix = prefix
		r.aiStreamBuffer = ""
		if len(e.Content) > 0 {
			r.aiStreamBuffer = e.Content
			r.commitAIStreamLines()
		}
		r.cfg.program.Send(aiStreamPartialMsg{
			partial: r.aiStreamPrefix + r.aiStreamBuffer,
		})
		if !r.dataIsTTY {
			fmt.Fprint(r.cfg.data, prefix)
			if len(e.Content) > 0 {
				fmt.Fprint(r.cfg.data, e.Content)
			}
			r.flushData()
		}
		return
	}

	fmt.Fprint(r.cfg.data, prefix)
	if len(e.Content) > 0 {
		fmt.Fprint(r.cfg.data, e.Content)
	}
	r.flushData()
}

func (r *inlineRenderer) renderAIStreamDelta(e executiontui.AIStreamDeltaEvent) {
	if !r.inAIStream {
		return
	}
	if len(e.Content) <= r.streamedBytes {
		return
	}
	newBytes := e.Content[r.streamedBytes:]
	r.streamedBytes = len(e.Content)

	if r.cfg.program != nil {
		r.aiStreamBuffer += newBytes
		r.commitAIStreamLines()
		r.cfg.program.Send(aiStreamPartialMsg{
			partial: r.aiStreamPrefix + r.aiStreamBuffer,
		})
		if !r.dataIsTTY {
			fmt.Fprint(r.cfg.data, newBytes)
			r.flushData()
		}
		return
	}

	fmt.Fprint(r.cfg.data, newBytes)
	r.flushData()
}

func (r *inlineRenderer) renderAIStreamEnd(e executiontui.AIStreamEndEvent) {
	if !r.inAIStream {
		r.streamedBytes = 0
		if e.Content != "" {
			r.recordAIMessage(e.Content, e.SubAgentID)
		}
		return
	}

	remaining := ""
	if len(e.Content) > r.streamedBytes {
		remaining = e.Content[r.streamedBytes:]
	}

	if r.cfg.program != nil {
		if remaining != "" {
			r.aiStreamBuffer += remaining
			r.commitAIStreamLines()
		}
		if r.aiStreamBuffer != "" {
			line := r.aiStreamBuffer
			if r.aiStreamPrefix != "" {
				line = r.aiStreamPrefix + line
			}
			r.cfg.program.Println(line)
		}
		r.cfg.program.Println("")
		r.cfg.program.Send(aiStreamHideMsg{})
		r.aiStreamBuffer = ""
		r.aiStreamPrefix = ""

		if !r.dataIsTTY {
			if remaining != "" {
				fmt.Fprint(r.cfg.data, remaining)
			}
			fmt.Fprint(r.cfg.data, "\n\n")
			r.flushData()
		}
	} else {
		if remaining != "" {
			fmt.Fprint(r.cfg.data, remaining)
		}
		fmt.Fprint(r.cfg.data, "\n\n")
		r.flushData()
	}

	r.inAIStream = false
	r.streamedBytes = 0
	r.recordAIMessage(e.Content, e.SubAgentID)
}

func (r *inlineRenderer) renderAIMessage(e executiontui.AIMessageEvent) {
	r.finishAIStreamIfNeeded()
	if e.Content == "" {
		return
	}

	prefix := r.agentPrefix(e.SubAgentID)
	text := prefix + formatNonTUIAIText(e.Content)

	if r.cfg.program != nil {
		r.cfg.program.Println(text)
		r.cfg.program.Println("")
		if !r.dataIsTTY {
			fmt.Fprintf(r.cfg.data, "%s\n\n", text)
			r.flushData()
		}
	} else {
		fmt.Fprintf(r.cfg.data, "%s\n\n", text)
		r.flushData()
	}

	r.recordAIMessage(e.Content, e.SubAgentID)
}

// finishAIStreamIfNeeded closes an in-progress AI stream when a non-AI
// event arrives mid-stream. Commits any buffered partial line and a
// paragraph gap through Bubbletea (when active) or stdout (fallback).
func (r *inlineRenderer) finishAIStreamIfNeeded() {
	if !r.inAIStream {
		return
	}

	if r.cfg.program != nil {
		if r.aiStreamBuffer != "" {
			line := r.aiStreamBuffer
			if r.aiStreamPrefix != "" {
				line = r.aiStreamPrefix + line
			}
			r.cfg.program.Println(line)
		}
		r.cfg.program.Println("")
		r.cfg.program.Send(aiStreamHideMsg{})
		r.aiStreamBuffer = ""
		r.aiStreamPrefix = ""

		if !r.dataIsTTY {
			fmt.Fprint(r.cfg.data, "\n\n")
			r.flushData()
		}
	} else {
		fmt.Fprint(r.cfg.data, "\n\n")
		r.flushData()
	}

	r.inAIStream = false
	r.streamedBytes = 0
}

// commitAIStreamLines scans the AI stream buffer for complete lines
// (terminated by \n) and commits each one to terminal scrollback via
// program.Println. The bullet prefix is applied to the first line only.
// The remaining partial line stays in the buffer for View() display.
func (r *inlineRenderer) commitAIStreamLines() {
	for {
		idx := strings.IndexByte(r.aiStreamBuffer, '\n')
		if idx < 0 {
			return
		}
		line := r.aiStreamBuffer[:idx]
		if r.aiStreamPrefix != "" {
			line = r.aiStreamPrefix + line
			r.aiStreamPrefix = ""
		}
		r.cfg.program.Println(line)
		r.aiStreamBuffer = r.aiStreamBuffer[idx+1:]
	}
}

// agentPrefix returns the AI message prefix, adjusted for sub-agent context.
// Main-agent messages get a plain bullet marker. Sub-agent messages are
// rendered separately with gutter wrapping and do not need a prefix.
func (r *inlineRenderer) agentPrefix(subAgentID string) string {
	if subAgentID != "" {
		return ""
	}
	return "● "
}

// recordAIMessage appends a kindAIMessage to history. The text is pre-formatted
// with prefix and markdown rendering so it looks correct when replayed to stderr
// via tea.Println during re-commit.
func (r *inlineRenderer) recordAIMessage(content string, subAgentID string) {
	prefix := r.agentPrefix(subAgentID)
	text := prefix + formatNonTUIAIText(content)
	r.history = append(r.history, committedItem{
		kind:       kindAIMessage,
		text:       text,
		subAgentID: subAgentID,
	})
}
