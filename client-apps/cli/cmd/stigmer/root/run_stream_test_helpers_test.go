package root

import "github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"

// feedEvents pushes events into the channel and closes it. Used by tests
// that exercise the JSON and plain text rendering paths.
func feedEvents(events chan<- executiontui.Event, evts ...executiontui.Event) {
	for _, e := range evts {
		events <- e
	}
	close(events)
}
