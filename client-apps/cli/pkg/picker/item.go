// Package picker provides a generic, interactive resource picker for terminal
// environments. It renders a search input with a scrollable result list,
// powered by Bubbletea. The picker is domain-agnostic: callers supply a
// search function and receive the selected item back.
package picker

// Item represents a single selectable entry in the picker list.
// Callers construct items from their domain objects (agents, sessions, etc.)
// and receive the selected item back after the user makes a choice.
type Item struct {
	// ID is an opaque identifier returned to the caller on selection.
	ID string

	// Title is the primary display text rendered in bold (e.g. "acme/deploy-staging").
	Title string

	// Subtitle is secondary text rendered dimmed below/after the title
	// (e.g. agent description or agent slug for sessions).
	Subtitle string

	// Meta is right-aligned metadata (e.g. "2 hours ago"). May be empty.
	Meta string
}
