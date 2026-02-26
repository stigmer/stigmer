package clioutput

import (
	"io"

	"github.com/fatih/color"
)

// QuietRenderer outputs only the status line, suppressing all sections and hints.
// Useful for scripting where only pass/fail matters.
type QuietRenderer struct {
	Out io.Writer
}

func (q *QuietRenderer) Render(result *CommandResult) {
	var icon string
	var colorAttr []color.Attribute

	switch result.Status {
	case StatusSuccess:
		icon = "✓"
		colorAttr = []color.Attribute{color.FgGreen, color.Bold}
	case StatusWarning:
		icon = "⚠"
		colorAttr = []color.Attribute{color.FgYellow, color.Bold}
	case StatusError:
		icon = "✗"
		colorAttr = []color.Attribute{color.FgRed, color.Bold}
	}

	c := color.New(colorAttr...)
	c.Fprintf(q.Out, "%s %s\n", icon, result.Message)
}
