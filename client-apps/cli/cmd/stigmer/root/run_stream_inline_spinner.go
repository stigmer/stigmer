package root

import "time"

// thinkingIdleDelay is the duration of inactivity (no events received) before
// the thinking spinner appears. Matches the TUI's idleThreshold to provide a
// consistent "is it working?" signal across both rendering modes.
const thinkingIdleDelay = 2 * time.Second

// startThinkingSpinner activates the spinner on stderr if the renderer is in
// a state where thinking feedback is appropriate. The spinner animates on a
// single line using carriage-return overwriting and is cleared by Stop()
// before any event output.
func (r *inlineRenderer) startThinkingSpinner() {
	if !r.thinkingAllowed() {
		return
	}
	r.spinner.Start("Thinking...")
}

// stopThinkingSpinner clears the spinner line if it is currently active.
// Must be called before writing any event output to stderr to prevent the
// spinner text from interleaving with event rendering. spinner.Stop() is
// synchronous — it waits for the animation goroutine to exit and clears
// the line before returning.
func (r *inlineRenderer) stopThinkingSpinner() {
	r.spinner.Stop()
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
