package approval

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/termctl"
	"golang.org/x/term"
)

// menuLines is the fixed number of terminal rows the prompt menu occupies:
// 4 option lines + 1 hint line.
const menuLines = 5

// inlineChoices maps cursor index to action and display label.
var inlineChoices = []struct {
	action Action
	label  string
}{
	{ActionApprove, "Approve"},
	{ActionApproveAll, "Approve & don't ask again"},
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
	menu := RenderMenu(selected, false)
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
			return &Decision{Action: ActionApproveAll}, menuLines, nil
		case keyThree:
			return &Decision{Action: ActionSkip}, menuLines, nil
		case keyFour:
			return &Decision{Action: ActionReject}, menuLines, nil
		case keyEsc, keyCtrlC:
			return nil, menuLines, ErrSessionExit
		}
	}
}

// PromptKeyOnly reads approval keystrokes without rendering the menu.
// The caller is responsible for visual output (typically via Bubbletea's
// View()). On arrow key changes, onSelect is called with the new
// selection index so the caller can update the visual state.
//
// Returns the user's decision on Enter/number-key, or an error on
// Esc/Ctrl+C/context cancellation.
//
// Non-interactive fast path: when NonInteractive is true, DefaultAction
// is set, or the input is not a terminal, the decision is returned
// immediately without reading any keys or calling onSelect.
func (p *InlinePrompter) PromptKeyOnly(ctx context.Context, opts Options, onSelect func(int)) (*Decision, error) {
	if opts.NonInteractive {
		d, _, err := handleNonInteractiveInline(opts)
		return d, err
	}
	if p.fd < 0 {
		d, _, err := handleNonInteractiveInline(opts)
		return d, err
	}

	p.ensureKeyReader()
	p.kr.drain()

	oldState, err := term.MakeRaw(p.fd)
	if err != nil {
		return nil, fmt.Errorf("failed to enter raw terminal mode: %w", err)
	}
	defer term.Restore(p.fd, oldState)

	selected := 0
	for {
		key, err := p.kr.readKey(ctx)
		if err != nil {
			return nil, err
		}

		switch key {
		case keyUp:
			if selected > 0 {
				selected--
				onSelect(selected)
			}
		case keyDown:
			if selected < len(inlineChoices)-1 {
				selected++
				onSelect(selected)
			}
		case keyEnter:
			return &Decision{Action: inlineChoices[selected].action}, nil
		case keyOne:
			return &Decision{Action: ActionApprove}, nil
		case keyTwo:
			return &Decision{Action: ActionApproveAll}, nil
		case keyThree:
			return &Decision{Action: ActionSkip}, nil
		case keyFour:
			return &Decision{Action: ActionReject}, nil
		case keyEsc, keyCtrlC:
			return nil, ErrSessionExit
		}
	}
}

func (p *InlinePrompter) ensureKeyReader() {
	if p.kr == nil {
		p.kr = newKeyReader(p.in)
	}
}

func handleNonInteractiveInline(opts Options) (*Decision, int, error) {
	d, err := resolveNonInteractive(opts)
	return d, 0, err
}

// RenderMenu builds the 4-line vertical menu string for the given
// selection index. When forView is true, lines are separated by \n
// (correct for Bubbletea's View() which handles raw-mode translation).
// When false, lines use \r\n for direct terminal writes in raw mode.
func RenderMenu(selected int, forView bool) string {
	lineEnd := "\r\n"
	if forView {
		lineEnd = "\n"
	}

	var b strings.Builder
	for i, choice := range inlineChoices {
		if i == selected {
			b.WriteString(selectedStyle.Render(fmt.Sprintf("  ▸ %s", choice.label)))
		} else {
			b.WriteString(unselectedStyle.Render(fmt.Sprintf("    %s", choice.label)))
		}
		b.WriteString(lineEnd)
	}
	b.WriteString(hintStyle.Render("  ↑↓/1-4 select · esc/ctrl+c exit"))
	return b.String()
}

// rerenderMenu erases the current menu and redraws it with the updated
// selection. Uses termctl.EraseLines for precise cursor control.
// Used by PromptWithLineCount (the legacy direct-write path).
func rerenderMenu(w io.Writer, selected int) {
	termctl.EraseLines(w, menuLines)
	fmt.Fprint(w, RenderMenu(selected, false))
}

var (
	selectedStyle   = lipgloss.NewStyle().Bold(true)
	unselectedStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
	hintStyle       = lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Italic(true)
)
