package clioutput

import "io"

// OutputFormat controls how a CommandResult is presented to the user.
type OutputFormat string

const (
	FormatHuman OutputFormat = "human"
	FormatJSON  OutputFormat = "json"
	FormatQuiet OutputFormat = "quiet"
)

// Renderer formats a CommandResult for output.
//
// Implementations decide where and how each piece is rendered:
//   - HumanRenderer: colored, structured text to stderr
//   - JSONRenderer: machine-readable JSON data to stdout, status to stderr
//   - QuietRenderer: status line only to stderr
type Renderer interface {
	Render(result *CommandResult)
}

// NewRenderer creates a Renderer for the given format.
//
// stdout carries data output (used by JSONRenderer for structured data).
// stderr carries decorative/status output (used by all renderers).
func NewRenderer(format OutputFormat, stdout, stderr io.Writer) Renderer {
	switch format {
	case FormatJSON:
		return &JSONRenderer{DataOut: stdout, StatusOut: stderr}
	case FormatQuiet:
		return &QuietRenderer{Out: stderr}
	default:
		return &HumanRenderer{Out: stderr}
	}
}
