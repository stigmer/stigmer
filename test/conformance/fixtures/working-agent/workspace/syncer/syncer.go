// Package syncer runs the order sync loop.
package syncer

import "time"

// DefaultMaxAttempts is how many times a failed sync is retried when the
// configuration does not set sync.retry.max_attempts.
const DefaultMaxAttempts = 5

// DefaultInterval is how often the sync runs when the configuration does not
// set sync.interval.
const DefaultInterval = 5 * time.Minute

// Settings are the sync loop's resolved settings.
type Settings struct {
	Interval    time.Duration
	MaxAttempts int
	Backoff     time.Duration
	Timeout     time.Duration
}
