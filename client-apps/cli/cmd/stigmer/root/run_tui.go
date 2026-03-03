package root

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"

	tea "github.com/charmbracelet/bubbletea"
	"golang.org/x/term"
)

// runTUIWithProtection wraps tea.Program.Run with panic recovery and signal
// handling so the terminal is always restored to a usable state.
//
// Panic recovery: a defer/recover catches any panic inside the Bubbletea
// event loop and restores the terminal using a three-tier strategy before
// converting the panic into a returned error.
//
// Signal handling: SIGTERM and SIGHUP are intercepted while the TUI is
// running. Both invoke p.Kill() to immediately stop the program and
// restore terminal state, bypassing the event loop (which may be stuck).
//
// This function is the single protection layer for all alt-screen TUI
// invocations. Non-alt-screen Bubbletea programs (progress spinners,
// approval prompts) are not wrapped because they cause only minor
// terminal damage on crash (recoverable with the Unix `reset` command).
func runTUIWithProtection(p *tea.Program) (model tea.Model, err error) {
	fd := int(os.Stdin.Fd())
	origState, _ := term.GetState(fd)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGHUP)

	done := make(chan struct{})
	go func() {
		select {
		case <-sigCh:
			p.Kill()
		case <-done:
		}
		signal.Stop(sigCh)
	}()

	defer func() {
		close(done)

		if r := recover(); r != nil {
			restoreTerminal(p, fd, origState)
			err = fmt.Errorf("unexpected TUI crash: %v — your terminal has been restored; if it still looks wrong, run: stigmer fix", r)
		}
	}()

	return p.Run()
}

// restoreTerminal applies a three-tier terminal restoration strategy.
//
// Tier 1: Bubbletea's own RestoreTerminal — it knows exactly what
// terminal modifications it made (raw mode, alt-screen, cursor state).
// Guarded with recover() because RestoreTerminal panics if the program
// was never fully initialized (e.g., crash during Run() setup).
//
// Tier 2: Restore the original terminal state captured before the TUI
// started. This catches anything Bubbletea's restore misses.
//
// Tier 3: Write raw ANSI escape sequences to stderr as a final fallback.
// This works even when the Go terminal manipulation functions fail.
func restoreTerminal(p *tea.Program, fd int, origState *term.State) {
	func() {
		defer func() { recover() }()
		_ = p.RestoreTerminal()
	}()

	if origState != nil {
		_ = term.Restore(fd, origState)
	}

	fmt.Fprint(os.Stderr, "\033[?1049l\033[?25h\033[0m")
}
