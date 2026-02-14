// Package spinner provides a lightweight terminal activity indicator.
//
// It animates on a single line using ANSI escape codes and is safe to use
// alongside fmt.Println and Bubbletea programs. The spinner runs in a
// background goroutine and displays elapsed time next to the label.
//
// Usage:
//
//	s := spinner.New(os.Stdout)
//	s.Start("Waiting for agent...")
//	// ... do work ...
//	s.Stop()  // clears the spinner line
//
// Non-TTY environments (pipes, CI) produce no output.
package spinner

import (
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
)

// frames are the braille-dot animation characters. This is the standard
// CLI spinner pattern used by ora, npm, cargo, and others.
var frames = []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}

// frameInterval controls how often the spinner frame advances.
const frameInterval = 80 * time.Millisecond

// Spinner is a lightweight terminal activity indicator that animates on a
// single line. It is safe for concurrent use — Start, Stop, and Update may
// be called from any goroutine.
type Spinner struct {
	w     io.Writer
	mu    sync.Mutex
	label string
	start time.Time
	stop  chan struct{}
	done  chan struct{}
	active bool
}

// New creates a Spinner that writes to w. Pass os.Stdout for normal use
// or a bytes.Buffer for testing.
func New(w io.Writer) *Spinner {
	return &Spinner{w: w}
}

// Start begins the spinner animation with the given label. If the output
// is not a terminal, Start is a no-op. Calling Start while already active
// is equivalent to calling Update.
func (s *Spinner) Start(label string) {
	if !display.IsTerminal() {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.active {
		// Already running — just update the label
		s.label = label
		return
	}

	s.label = label
	s.start = time.Now()
	s.stop = make(chan struct{})
	s.done = make(chan struct{})
	s.active = true

	go s.run()
}

// Update changes the spinner label without restarting the animation or
// resetting elapsed time. Safe to call when not active (no-op).
func (s *Spinner) Update(label string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.label = label
}

// Stop clears the spinner line and waits for the animation goroutine to
// exit. Calling Stop when not active is a no-op.
func (s *Spinner) Stop() {
	s.mu.Lock()
	if !s.active {
		s.mu.Unlock()
		return
	}

	close(s.stop)
	s.active = false
	s.mu.Unlock()

	// Wait for goroutine to finish before clearing the line
	<-s.done
	s.clearLine()
}

// IsActive returns true if the spinner is currently animating.
func (s *Spinner) IsActive() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.active
}

// run is the animation loop that runs in a background goroutine.
func (s *Spinner) run() {
	defer close(s.done)

	ticker := time.NewTicker(frameInterval)
	defer ticker.Stop()

	frame := 0
	for {
		select {
		case <-s.stop:
			return
		case <-ticker.C:
			s.mu.Lock()
			label := s.label
			elapsed := time.Since(s.start)
			s.mu.Unlock()

			s.renderFrame(frames[frame%len(frames)], label, elapsed)
			frame++
		}
	}
}

// renderFrame writes a single spinner frame to the writer, overwriting the
// current line. The format is: "⠹ Label... (3s)"
func (s *Spinner) renderFrame(frame, label string, elapsed time.Duration) {
	elapsedStr := formatElapsed(elapsed)
	line := fmt.Sprintf("\r%s %s %s", frame, label, elapsedStr)
	fmt.Fprint(s.w, line)
}

// clearLine erases the current line by writing carriage return + ANSI clear.
func (s *Spinner) clearLine() {
	fmt.Fprint(s.w, "\r\033[K")
}

// formatElapsed returns a human-readable elapsed time string in parentheses.
func formatElapsed(d time.Duration) string {
	secs := int(d.Seconds())
	if secs < 1 {
		return ""
	}

	if secs < 60 {
		return fmt.Sprintf("(%ds)", secs)
	}

	mins := secs / 60
	remainSecs := secs % 60
	return fmt.Sprintf("(%dm%ds)", mins, remainSecs)
}
