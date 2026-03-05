package root

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"strings"

	tea "charm.land/bubbletea/v2"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/termctl"
)

// runInlineFollowUpLoop wraps renderInline in a conversational loop. After
// each execution completes, it prompts the user for a follow-up message and
// creates a new execution within the same session. The loop exits when:
//   - followUpFn is nil (no session, single-shot execution)
//   - The execution ended in a non-eligible phase (cancelled, error)
//   - The user submits empty input (Enter or Ctrl+D)
//   - The follow-up creation fails
//
// Returns the latest execution ID, final phase, and exit error so the caller
// can fetch the correct execution for the epilogue summary.
func runInlineFollowUpLoop(
	ctx context.Context,
	cfg inlineRenderConfig,
	followUpFn executiontui.FollowUpFn,
	executionID string,
) (latestExecID string, phase string, exitErr string) {
	latestExecID = executionID

	for {
		var history []committedItem
		phase, exitErr, history = renderInline(ctx, cfg)
		if followUpFn == nil || !isFollowUpEligible(phase, exitErr) {
			return latestExecID, phase, exitErr
		}

		input, err := promptFollowUp(cfg.program, cfg.status, cfg.cancelCh)
		if err != nil || input == "" {
			return latestExecID, phase, exitErr
		}

		history = append(history, committedItem{
			kind: kindHumanMessage,
			text: formatHumanMessage(input),
		})
		cfg.initialHistory = history
		cfg.suppressHumanEcho = true

		result, err := followUpFn(input)
		if err != nil {
			fmt.Fprintf(cfg.status, "Error: follow-up failed: %s\n", err)
			return latestExecID, phase, exitErr
		}

		latestExecID = result.ExecutionID
		cfg.events = result.Events
		cfg.approvalResponses = result.ApprovalResponses
		if result.CancelFn != nil {
			fn := result.CancelFn
			cfg.cancelExecFn = func() { _ = fn() }
		}
	}
}

// promptFollowUp renders the follow-up prompt, reads user input, erases the
// prompt, and commits the styled human message. Returns the trimmed input and
// any error. When program is non-nil, rendering and erasure are handled by
// Bubbletea's View(); otherwise, direct stderr writes with EraseLines.
//
// When cancelCh is non-nil, Bubbletea owns stdin and text input is collected
// through the model's handleTextInputKey. When nil, input is read directly
// from os.Stdin via readStdinLine.
func promptFollowUp(program *tea.Program, status io.Writer, cancelCh <-chan struct{}) (string, error) {
	if program != nil {
		if cancelCh != nil {
			return promptFollowUpViaChannel(program)
		}
		return promptFollowUpViaKeyReader(program)
	}
	return promptFollowUpDirect(status)
}

// promptFollowUpViaChannel renders the prompt and reads input through the
// Bubbletea model when it owns stdin. Sends textInputStartMsg with a prompt
// and channel, blocks until the model delivers input on Enter.
func promptFollowUpViaChannel(program *tea.Program) (string, error) {
	inputCh := make(chan string, 1)

	program.Send(textInputStartMsg{
		prompt:  formatFollowUpPrompt(),
		inputCh: inputCh,
	})

	input := strings.TrimSpace(<-inputCh)

	if input == "" {
		program.Send(textInputHideMsg{})
		return "", nil
	}

	styledMsg := fmt.Sprintf("%s\n\n", formatHumanMessage(input))
	program.Send(textInputHideMsg{styledMessage: styledMsg})
	return input, nil
}

// promptFollowUpViaKeyReader renders the prompt via Bubbletea's View(), reads
// a line from stdin via readStdinLine, then hides the prompt and commits the
// styled human message. Legacy path when Bubbletea doesn't own stdin.
func promptFollowUpViaKeyReader(program *tea.Program) (string, error) {
	program.Send(followUpShowMsg{content: formatFollowUpPrompt()})

	input, err := readStdinLine()
	if err != nil || input == "" {
		program.Send(followUpHideMsg{})
		return input, err
	}

	styledMsg := fmt.Sprintf("%s\n\n", formatHumanMessage(input))
	program.Send(followUpHideMsg{styledMessage: styledMsg})
	return input, nil
}

// promptFollowUpDirect renders the prompt directly to the status writer,
// reads a line from stdin, erases the prompt via EraseLines, and writes the
// styled human message. This is the fallback path when Bubbletea is not
// available (non-TTY, CI, tests).
func promptFollowUpDirect(status io.Writer) (string, error) {
	input, err := readFollowUpInputDirect(status)
	if err != nil || input == "" {
		return input, err
	}

	if termctl.IsSupported(status) {
		termctl.EraseLines(status, followUpPromptRows)
	}
	fmt.Fprintf(status, "%s\n\n", formatHumanMessage(input))
	return input, nil
}

// ---------------------------------------------------------------------------
// Prompt rendering and stdin reading
// ---------------------------------------------------------------------------

// formatFollowUpPrompt builds the follow-up prompt string for Bubbletea's
// View(). The layout matches readFollowUpInputDirect's direct-write output:
//
//	[blank line]
//	────────────────────────────────────────
//	  enter send · ctrl+c exit
//	> [cursor]
//
// The trailing space after ">" positions the cursor for user input.
func formatFollowUpPrompt() string {
	sep := systemMsgStyle.Render(strings.Repeat("─", followUpSepWidth))
	hint := followUpHintStyle.Render("  enter send · ctrl+c exit")
	marker := promptStyle.Render(">")
	return fmt.Sprintf("\n%s\n%s\n%s ", sep, hint, marker)
}

// readStdinLine reads one line from os.Stdin and returns the trimmed text.
// Returns empty string on EOF (Ctrl+D) or blank input (bare Enter).
func readStdinLine() (string, error) {
	scanner := bufio.NewScanner(os.Stdin)
	if !scanner.Scan() {
		if err := scanner.Err(); err != nil {
			return "", err
		}
		return "", nil
	}
	return strings.TrimSpace(scanner.Text()), nil
}

// readFollowUpInputDirect renders the follow-up prompt to the status writer
// and reads one line from stdin. Used by the direct-write fallback path when
// Bubbletea is not available.
func readFollowUpInputDirect(status io.Writer) (string, error) {
	fmt.Fprint(status, formatFollowUpPrompt())
	return readStdinLine()
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

// isFollowUpEligible reports whether the execution outcome allows a follow-up
// message. Returns true for "completed" and "failed" phases with no exit error.
// Failed executions allow corrective follow-up (matching TUI behavior where
// the user can recover from failures by sending corrective instructions).
// Cancelled executions, stream errors, and unknown phases exit immediately.
func isFollowUpEligible(phase, exitErr string) bool {
	if exitErr != "" {
		return false
	}
	return phase == "completed" || phase == "failed"
}
