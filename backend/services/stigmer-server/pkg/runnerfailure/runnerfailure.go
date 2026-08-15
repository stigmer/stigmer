// Package runnerfailure classifies runner activity failures at the polyglot
// Temporal boundary.
//
// The TypeScript runner and this Go control plane meet only through Temporal
// failure payloads, so "the runner's worker was shut down mid-activity" has no
// typed representation here — it arrives as one of two message shapes:
//
//  1. the activity's own classification, thrown as CancelledFailure
//     ("Activity cancelled (worker shutdown, not user pause)" — the runner's
//     execute-cursor/execute-deep-agent shutdown branches), which crosses as
//     a canceled failure; and
//  2. the Temporal TS worker's drain failing an activity that could not finish
//     inside the shutdown grace window ("Worker is shutting down and this
//     activity did not complete in time"), which crosses as a plain activity
//     failure — the shape observed live in the 2026-08-08 incident.
//
// Both mean the same thing: infrastructure interrupted the turn; the user did
// nothing. Recognizing them in ONE place keeps two behaviors consistent across
// the agentexecution and workflowexecution workflows (issue #776):
//
//   - status.error carries the honest platform-failure copy instead of raw
//     Temporal internals (the cloud channel decision table and console users
//     both read status.error);
//   - the interruption is treated as recoverable, so the workflow's bounded
//     recovery loop re-invokes from persisted harness/checkpoint state instead
//     of dead-ending the turn (owner ruling on #776).
//
// The substring matching deliberately mirrors the Java control plane's
// extractActivityFailureMessage so all editions key on the same shapes.
package runnerfailure

import (
	"errors"
	"strings"

	"go.temporal.io/sdk/temporal"
)

// WorkerShutdownStatusError is the honest status.error copy for a turn that a
// worker shutdown interrupted. Byte-identical to the copy the runner persists
// from its own shutdown branches and to the Java control plane's mapping, so
// every downstream status.error consumer keys on one string.
const WorkerShutdownStatusError = "Execution interrupted: runner worker was shut down. Retry or resume."

// canceledMarkers identify a worker shutdown inside a CANCELED failure. A
// canceled failure's message is authored by the runner's own classification
// branches (never by agent/tool output), so loose markers are safe here —
// deliberately the same two the Java control plane matches.
var canceledMarkers = []string{"worker shutdown", "shutting down"}

// drainMarker identifies the Temporal TS worker's drain text ("Worker is
// shutting down and this activity did not complete in time") in NON-canceled
// failure types. Those messages can carry agent/tool output, so the match
// anchors on the distinctive leading phrase rather than the loose markers.
const drainMarker = "worker is shutting down"

// IsWorkerShutdown reports whether err (anywhere in its chain) carries a
// runner worker-shutdown shape. Canceled failures are matched loosely (their
// messages are runner-authored); everything else must carry the Temporal
// drain phrase, because the drain shape has crossed the boundary as different
// failure types across SDK versions.
func IsWorkerShutdown(err error) bool {
	for e := err; e != nil; e = errors.Unwrap(e) {
		switch f := e.(type) {
		case *temporal.CanceledError:
			lower := strings.ToLower(f.Error())
			for _, marker := range canceledMarkers {
				if strings.Contains(lower, marker) {
					return true
				}
			}
		case *temporal.ApplicationError:
			if strings.Contains(strings.ToLower(f.Message()), drainMarker) {
				return true
			}
		default:
			if strings.Contains(strings.ToLower(e.Error()), drainMarker) {
				return true
			}
		}
	}
	return false
}
