package root

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"strings"

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
		phase, exitErr = renderInline(ctx, cfg)
		if followUpFn == nil || !isFollowUpEligible(phase, exitErr) {
			return latestExecID, phase, exitErr
		}

		input, err := readFollowUpInput(cfg.status)
		if err != nil || input == "" {
			return latestExecID, phase, exitErr
		}

		// Erase the follow-up prompt UI (separator + prompt + hint + the
		// blank line the cursor advanced to after Enter) and replace it with
		// the styled user message block. On non-TTY writers this is a no-op.
		if termctl.IsSupported(cfg.status) {
			termctl.EraseLines(cfg.status, followUpPromptRows)
		}
		fmt.Fprintf(cfg.status, "%s\n\n", formatHumanMessage(input))
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

// readFollowUpInput renders a three-section input prompt to the status writer
// and reads one line of input from stdin. The layout:
//
//	────────────────────────────────────────
//	  enter send · ctrl+c exit
//	> [cursor]
//
// The hint sits above the prompt so Enter's terminal echo doesn't overwrite
// it. No cursor repositioning is needed -- the cursor is naturally on the
// prompt line ready for input.
//
// Returns the trimmed input, or empty string on EOF (Ctrl+D) or blank input
// (just Enter). All prompt output goes to stderr so stdout remains clean for
// piping.
func readFollowUpInput(status io.Writer) (string, error) {
	sep := systemMsgStyle.Render(strings.Repeat("─", followUpSepWidth))
	hint := followUpHintStyle.Render("  enter send · ctrl+c exit")
	marker := promptStyle.Render(">")

	fmt.Fprintf(status, "\n%s\n%s\n%s ", sep, hint, marker)

	scanner := bufio.NewScanner(os.Stdin)
	if !scanner.Scan() {
		if err := scanner.Err(); err != nil {
			return "", err
		}
		return "", nil
	}
	return strings.TrimSpace(scanner.Text()), nil
}

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
