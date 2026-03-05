package root

import "time"

// thinkingIdleDelay is the duration of inactivity (no events received) before
// the thinking spinner appears. Matches the TUI's idleThreshold to provide a
// consistent "is it working?" signal across both rendering modes.
const thinkingIdleDelay = 2 * time.Second

// startThinkingSpinner activates the spinner via Bubbletea if the renderer is
// in a state where thinking feedback is appropriate. When a Bubbletea program
// is running, a spinnerStartMsg is sent so the model's View() renders the
// animated spinner. When no program is present (non-TTY, tests), this is a
// no-op — non-TTY environments intentionally have no spinner.
func (r *inlineRenderer) startThinkingSpinner() {
	if !r.thinkingAllowed() {
		return
	}
	if r.cfg.program != nil {
		r.cfg.program.Send(spinnerStartMsg{label: "Thinking..."})
	}
}

// stopThinkingSpinner deactivates the spinner via Bubbletea. A spinnerStopMsg
// causes the model's View() to return "" on the next render cycle, clearing
// the spinner line. Must be called before processing any event to prevent
// spinner output from interleaving with event rendering.
//
// The stop is asynchronous — queued in Bubbletea's message channel. This is
// safe because all subsequent status output also flows through the same
// program (via Println), preserving ordering within Bubbletea's render cycle.
func (r *inlineRenderer) stopThinkingSpinner() {
	if r.cfg.program != nil {
		r.cfg.program.Send(spinnerStopMsg{})
	}
}

// resetThinkTimer conditionally resets the idle timer based on current state.
// When thinking is allowed, the timer is reset to thinkingIdleDelay. When any
// blocking condition is active (AI streaming, tool streaming, approval pending,
// or phase is not in_progress), the timer is stopped to prevent the spinner
// from appearing during those states.
func (r *inlineRenderer) resetThinkTimer() {
	if !r.thinkingAllowed() {
		r.thinkTimer.Stop()
		return
	}
	r.thinkTimer.Reset(thinkingIdleDelay)
}

// thinkingAllowed reports whether the renderer is in a state where showing
// the thinking spinner is appropriate. Returns true only when:
//   - Execution is actively running (phase is "in_progress")
//   - No AI content is being streamed to stdout
//   - No tool content is being streamed (pre- or post-approval)
//   - No approval prompt is pending user input
func (r *inlineRenderer) thinkingAllowed() bool {
	if r.phase != "in_progress" {
		return false
	}
	if r.inAIStream {
		return false
	}
	if r.activeStreamToolID != "" {
		return false
	}
	if r.waitingApproval != nil {
		return false
	}
	return true
}
