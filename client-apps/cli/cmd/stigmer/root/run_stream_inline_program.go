package root

import (
	"fmt"
	"io"
	"sync/atomic"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/rs/zerolog/log"
)

// managedProgram wraps a Bubbletea *tea.Program with lifecycle awareness.
// When the underlying program exits (cleanly or via error), subsequent
// Println calls degrade gracefully to direct writes on the fallback writer,
// and Send calls become no-ops. This prevents the rendering pipeline from
// going dark when the program dies unexpectedly (e.g., terminal resize
// edge case in Bubbletea v2 inline mode).
//
// The wrapper is transparent to call sites: Println, Send, Quit, and Wait
// have the same signatures as *tea.Program. The only observable difference
// is degraded rendering quality when dead — text still appears, but without
// Bubbletea's row tracking and transient View() region.
type managedProgram struct {
	p        *tea.Program
	dead     atomic.Bool
	fallback io.Writer
}

// newManagedProgram creates a managed wrapper around a Bubbletea program.
// The fallback writer receives direct output when the program dies.
// The caller must start the program via runAndMonitor.
func newManagedProgram(p *tea.Program, fallback io.Writer) *managedProgram {
	return &managedProgram{p: p, fallback: fallback}
}

// runAndMonitor starts the program in a goroutine and marks the wrapper
// as dead when Run returns. Errors are logged at warn level — a dead
// program is non-fatal (rendering degrades to direct writes).
func (mp *managedProgram) runAndMonitor() {
	go func() {
		_, err := mp.p.Run()
		if err != nil {
			log.Warn().Err(err).Msg("bubbletea inline program exited with error — degrading to direct writes")
		}
		mp.dead.Store(true)
	}()
}

// Println commits text to terminal scrollback above the Bubbletea View().
// When the program is dead, falls back to a direct write on the fallback
// writer with a trailing newline (matching tea.Program.Println behavior).
func (mp *managedProgram) Println(args ...interface{}) {
	if mp.dead.Load() {
		fmt.Fprintln(mp.fallback, args...)
		return
	}
	mp.p.Println(args...)
}

// Send delivers a message to the Bubbletea program's message loop.
// When the program is dead, the message is silently dropped — transient
// UI updates (spinners, streaming partials, sub-agent badges) are
// irrelevant in the degraded direct-write mode.
func (mp *managedProgram) Send(msg tea.Msg) {
	if mp.dead.Load() {
		return
	}
	mp.p.Send(msg)
}

// Quit sends a quit command to the program. No-op when already dead.
func (mp *managedProgram) Quit() {
	if mp.dead.Load() {
		return
	}
	mp.p.Quit()
}

// Wait blocks until the program exits or the timeout expires. If the
// timeout fires before the program exits, the wrapper is marked dead
// and Wait returns — the caller can continue safely (the orphaned
// program goroutine will eventually exit on its own).
func (mp *managedProgram) Wait(timeout time.Duration) {
	if mp.dead.Load() {
		return
	}

	done := make(chan struct{})
	go func() {
		mp.p.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(timeout):
		log.Warn().Dur("timeout", timeout).Msg("bubbletea program did not exit within timeout — marking dead")
		mp.dead.Store(true)
	}
}

// IsAlive reports whether the underlying program is still running.
func (mp *managedProgram) IsAlive() bool {
	return !mp.dead.Load()
}
