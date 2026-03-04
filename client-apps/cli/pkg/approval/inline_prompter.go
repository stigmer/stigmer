package approval

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/termctl"
	"golang.org/x/term"
)

// menuLines is the fixed number of terminal rows the prompt menu occupies:
// 3 option lines + 1 hint line.
const menuLines = 4

// inlineChoices maps cursor index to action and display label.
var inlineChoices = []struct {
	action Action
	label  string
}{
	{ActionApprove, "Yes"},
	{ActionSkip, "Skip"},
	{ActionReject, "Reject"},
}

// InlinePrompter implements Prompter using raw terminal mode for precise
// keystroke control and line counting. It is designed for the inline CLI
// renderer where exact row counts are required for cursor-controlled
// collapse after the user makes a decision.
//
// The prompter accepts an io.Reader (input) and io.Writer (output) via
// the constructor — no os.Stdin/os.Stderr references. Tests inject
// bytes.Buffer for both.
type InlinePrompter struct {
	in  io.Reader
	out io.Writer
	fd  int // terminal fd for raw mode; -1 when not a terminal

	kr *keyReader // lazy-initialized on first interactive prompt
}

// NewInlinePrompter creates a prompter for inline-mode approval prompts.
// in is the keystroke source (typically os.Stdin), out is the menu render
// target (typically os.Stderr).
func NewInlinePrompter(in io.Reader, out io.Writer) *InlinePrompter {
	fd := -1
	if f, ok := in.(*os.File); ok && term.IsTerminal(int(f.Fd())) {
		fd = int(f.Fd())
	}
	return &InlinePrompter{in: in, out: out, fd: fd}
}

// Prompt implements the Prompter interface. It delegates to
// PromptWithLineCount and discards the line count.
func (p *InlinePrompter) Prompt(ctx context.Context, opts Options) (*Decision, error) {
	decision, _, err := p.PromptWithLineCount(ctx, opts)
	return decision, err
}

// PromptWithLineCount displays an interactive approval menu and returns
// the user's decision along with the exact number of terminal rows the
// menu occupied. The line count enables the caller (Phase 3.3) to erase
// the menu using termctl.EraseLines after the decision.
//
// Non-interactive fast path: when NonInteractive is true, DefaultAction
// is set, or the input is not a terminal, the decision is returned
// immediately with lineCount 0 (nothing was rendered).
func (p *InlinePrompter) PromptWithLineCount(ctx context.Context, opts Options) (*Decision, int, error) {
	if opts.NonInteractive {
		return handleNonInteractiveInline(opts)
	}
	if p.fd < 0 {
		return handleNonInteractiveInline(opts)
	}

	p.ensureKeyReader()
	p.kr.drain()

	oldState, err := term.MakeRaw(p.fd)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to enter raw terminal mode: %w", err)
	}
	defer term.Restore(p.fd, oldState)

	selected := 0
	menu := renderMenu(selected)
	fmt.Fprint(p.out, menu)

	for {
		key, err := p.kr.readKey(ctx)
		if err != nil {
			return nil, menuLines, err
		}

		switch key {
		case keyUp:
			if selected > 0 {
				selected--
				rerenderMenu(p.out, selected)
			}
		case keyDown:
			if selected < len(inlineChoices)-1 {
				selected++
				rerenderMenu(p.out, selected)
			}
		case keyEnter:
			return &Decision{Action: inlineChoices[selected].action}, menuLines, nil
		case keyOne:
			return &Decision{Action: ActionApprove}, menuLines, nil
		case keyTwo:
			return &Decision{Action: ActionSkip}, menuLines, nil
		case keyThree:
			return &Decision{Action: ActionReject}, menuLines, nil
		case keyEsc, keyCtrlC:
			return nil, menuLines, ErrSessionExit
		}
	}
}

func (p *InlinePrompter) ensureKeyReader() {
	if p.kr == nil {
		p.kr = newKeyReader(p.in)
	}
}

func handleNonInteractiveInline(opts Options) (*Decision, int, error) {
	if opts.DefaultAction == ActionUnspecified {
		return nil, 0, ErrNonInteractiveNoDefault
	}
	return &Decision{Action: opts.DefaultAction}, 0, nil
}

// renderMenu builds the 4-line vertical menu string for the given
// selection index. The output has no trailing newline — the caller
// writes it as-is and tracks the line count via the menuLines constant.
func renderMenu(selected int) string {
	var b strings.Builder
	for i, choice := range inlineChoices {
		if i == selected {
			b.WriteString(selectedStyle.Render(fmt.Sprintf("  > %s", choice.label)))
		} else {
			b.WriteString(unselectedStyle.Render(fmt.Sprintf("    %s", choice.label)))
		}
		b.WriteString("\r\n")
	}
	b.WriteString(hintStyle.Render("  ↑↓/1-3 select · esc/ctrl+c exit"))
	return b.String()
}

// rerenderMenu erases the current menu and redraws it with the updated
// selection. Uses termctl.EraseLines for precise cursor control.
func rerenderMenu(w io.Writer, selected int) {
	termctl.EraseLines(w, menuLines)
	fmt.Fprint(w, renderMenu(selected))
}

var (
	selectedStyle   = lipgloss.NewStyle().Bold(true)
	unselectedStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
	hintStyle       = lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Italic(true)
)
