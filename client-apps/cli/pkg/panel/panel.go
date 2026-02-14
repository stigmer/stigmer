// Package panel provides a reusable box-drawing panel renderer for terminal output.
//
// Panels are rendered as static styled text using lipgloss — no terminal interaction
// or Bubbletea dependency. The caller composes the content; the panel just draws the frame.
//
// Usage:
//
//	output := panel.Render("Tool: delete_file\nPath: /etc/hosts", panel.Options{
//	    Title: "APPROVAL REQUIRED",
//	    Style: panel.StyleWarning,
//	})
//	fmt.Println(output)
package panel

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// PanelStyle controls the border and title color of the panel.
type PanelStyle int

const (
	// StyleDefault renders the panel with a neutral blue border.
	StyleDefault PanelStyle = iota
	// StyleWarning renders the panel with a yellow border.
	StyleWarning
	// StyleError renders the panel with a red border.
	StyleError
	// StyleSuccess renders the panel with a green border.
	StyleSuccess
)

// Options configures panel rendering.
type Options struct {
	// Title is displayed inline with the top border.
	// If empty, the top border is a plain line.
	Title string

	// Width is the total panel width including border characters.
	// If zero or negative, DefaultWidth is used.
	Width int

	// Style controls border and title colors.
	Style PanelStyle
}

// DefaultWidth is used when Options.Width is not specified.
const DefaultWidth = 70

// padding is the horizontal space between the border and content on each side.
const padding = 2

// Render draws a bordered box panel around the given content.
//
// The panel includes a top border (with optional inline title), padded content
// lines, and a bottom border. Long content lines are automatically wrapped at
// word boundaries to fit within the panel width; words that are individually
// wider than the content area are hard-broken so the right border is never
// pushed beyond the panel width.
//
// Example output with title:
//
//	╭─ TITLE ────────────────────╮
//	│                            │
//	│  Some content here         │
//	│                            │
//	╰────────────────────────────╯
func Render(content string, opts Options) string {
	width := opts.Width
	if width <= 0 {
		width = DefaultWidth
	}

	color := resolveColor(opts.Style)
	border := lipgloss.NewStyle().Foreground(color)
	title := lipgloss.NewStyle().Foreground(color).Bold(true)

	// innerWidth is the space between the two vertical border characters.
	innerWidth := width - 2

	// contentWidth is the space available for text after subtracting padding.
	contentWidth := innerWidth - (2 * padding)

	var b strings.Builder

	// Top border with optional title
	b.WriteString(renderTopBorder(opts.Title, innerWidth, border, title))
	b.WriteByte('\n')

	// Blank line above content
	b.WriteString(renderEmptyRow(innerWidth, border))
	b.WriteByte('\n')

	// Content lines — wrap long lines to fit within the panel.
	for _, line := range strings.Split(content, "\n") {
		for _, wrapped := range wrapLine(line, contentWidth) {
			b.WriteString(renderContentRow(wrapped, contentWidth, border))
			b.WriteByte('\n')
		}
	}

	// Blank line below content
	b.WriteString(renderEmptyRow(innerWidth, border))
	b.WriteByte('\n')

	// Bottom border
	b.WriteString(border.Render("╰" + strings.Repeat("─", innerWidth) + "╯"))

	return b.String()
}

// renderTopBorder builds the top border line.
//
// Without title: ╭──────────────────────╮
// With title:    ╭─ TITLE ──────────────╮
func renderTopBorder(text string, innerWidth int, border, title lipgloss.Style) string {
	if text == "" {
		return border.Render("╭" + strings.Repeat("─", innerWidth) + "╮")
	}

	titleText := " " + text + " "
	titleVisualWidth := lipgloss.Width(titleText)

	// Fill remaining width with dashes after the title.
	dashesAfter := innerWidth - 1 - titleVisualWidth
	if dashesAfter < 0 {
		dashesAfter = 0
	}

	return border.Render("╭─") +
		title.Render(titleText) +
		border.Render(strings.Repeat("─", dashesAfter)+"╮")
}

// renderEmptyRow draws a row with only border and whitespace.
func renderEmptyRow(innerWidth int, border lipgloss.Style) string {
	return border.Render("│") + strings.Repeat(" ", innerWidth) + border.Render("│")
}

// renderContentRow draws a row with content between padded borders.
//
// If the content's visual width exceeds contentWidth, no right-padding is
// applied. The content will extend to (or slightly beyond) the right border.
func renderContentRow(text string, contentWidth int, border lipgloss.Style) string {
	visWidth := lipgloss.Width(text)
	rightPad := contentWidth - visWidth
	if rightPad < 0 {
		rightPad = 0
	}

	pad := strings.Repeat(" ", padding)
	return border.Render("│") + pad + text + strings.Repeat(" ", rightPad) + pad + border.Render("│")
}

// resolveColor maps a PanelStyle to a lipgloss terminal color.
func resolveColor(style PanelStyle) lipgloss.TerminalColor {
	switch style {
	case StyleWarning:
		return lipgloss.Color("11") // Bright yellow
	case StyleError:
		return lipgloss.Color("9") // Bright red
	case StyleSuccess:
		return lipgloss.Color("10") // Bright green
	default:
		return lipgloss.Color("12") // Bright blue
	}
}
