package clioutput

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"strings"

	"golang.org/x/term"
)

// Confirmer asks the user for a yes/no confirmation.
//
// Implementations control the behavior:
//   - InteractiveConfirmer: reads from a terminal with a y/N prompt
//   - AlwaysYesConfirmer: always confirms (for --force flag)
type Confirmer interface {
	Confirm(prompt string) (bool, error)
}

// InteractiveConfirmer prompts on a terminal and reads the answer.
//
// Safety: if In is not a terminal (piped/redirected), Confirm returns
// false without prompting. This prevents accidental destructive operations
// in non-interactive scripts; use AlwaysYesConfirmer (--force) instead.
type InteractiveConfirmer struct {
	In  *os.File
	Out io.Writer
}

// NewInteractiveConfirmer creates a confirmer that reads from stdin
// and writes prompts to the given writer (typically stderr).
func NewInteractiveConfirmer(out io.Writer) *InteractiveConfirmer {
	return &InteractiveConfirmer{
		In:  os.Stdin,
		Out: out,
	}
}

func (c *InteractiveConfirmer) Confirm(prompt string) (bool, error) {
	if !term.IsTerminal(int(c.In.Fd())) {
		return false, nil
	}

	fmt.Fprintf(c.Out, "%s ", prompt)

	reader := bufio.NewReader(c.In)
	line, err := reader.ReadString('\n')
	if err != nil {
		return false, fmt.Errorf("failed to read confirmation input: %w", err)
	}

	answer := strings.TrimSpace(line)
	return answer == "y" || answer == "Y", nil
}

// AlwaysYesConfirmer unconditionally confirms.
// Use this when the --force flag is set.
type AlwaysYesConfirmer struct{}

func (AlwaysYesConfirmer) Confirm(string) (bool, error) {
	return true, nil
}

// NewConfirmer returns the appropriate Confirmer based on the force flag.
// When force is true, confirmation is skipped. Otherwise, an interactive
// prompt is used (writing to promptOut, typically stderr).
func NewConfirmer(force bool, promptOut io.Writer) Confirmer {
	if force {
		return AlwaysYesConfirmer{}
	}
	return NewInteractiveConfirmer(promptOut)
}
