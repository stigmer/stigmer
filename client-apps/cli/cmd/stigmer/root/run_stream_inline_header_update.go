package root

import (
	"context"
	"fmt"
	"io"
	"strings"
	"sync/atomic"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/session"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/panel"
	"google.golang.org/grpc"
)

const (
	subjectPollInterval = 2 * time.Second
	subjectPollMaxTries = 15
	subjectPlaceholder  = "–"

	// maxCursorBackLines caps cursor movement to avoid overwriting visible
	// content if the header has scrolled far off screen.
	maxCursorBackLines = 120
)

// subjectUpdater supports in-place updating of the Subject field in the
// session header panel using ANSI cursor movement. It tracks lines written
// after the header via a shared atomic counter so it can cursor-back to
// the correct position for the overwrite. Thread-safe.
type subjectUpdater struct {
	rawWriter     io.Writer     // original writer for direct ANSI output
	lineCounter   *atomic.Int64 // shared with lineCountingWriters
	offsetFromEnd int           // subject line's distance from end of panel
	updated       atomic.Bool
}

// UpdateSubject overwrites the Subject placeholder in the rendered panel
// with the actual subject text. Safe to call from any goroutine.
// No-op if already updated or if the header has scrolled too far off screen.
func (u *subjectUpdater) UpdateSubject(subject string) {
	if u == nil || subject == "" {
		return
	}
	if u.updated.Swap(true) {
		return
	}

	linesBack := int(u.lineCounter.Load()) + u.offsetFromEnd
	if linesBack <= 0 || linesBack > maxCursorBackLines {
		return
	}

	newRow := renderSubjectPanelRow(subject)

	// ANSI: save cursor, move up, clear line, write row, restore cursor.
	fmt.Fprintf(u.rawWriter, "\033[s\033[%dA\r\033[2K%s\033[u", linesBack, newRow)
}

// lineCountingWriter wraps an io.Writer and atomically counts newlines
// written through it. Used to track how many terminal lines have been
// emitted after the session header for cursor repositioning.
type lineCountingWriter struct {
	inner   io.Writer
	counter *atomic.Int64
}

func (w *lineCountingWriter) Write(p []byte) (int, error) {
	n, err := w.inner.Write(p)
	if n > 0 {
		var count int64
		for _, b := range p[:n] {
			if b == '\n' {
				count++
			}
		}
		if count > 0 {
			w.counter.Add(count)
		}
	}
	return n, err
}

// Unwrap returns the underlying writer so termctl functions (IsSupported,
// Width) can discover the real *os.File through the wrapper chain.
func (w *lineCountingWriter) Unwrap() io.Writer {
	return w.inner
}

// renderSubjectPanelRow produces a single panel content row for the Subject
// field, matching the default panel style (bright blue borders). The subject
// text is truncated if it exceeds the available width.
func renderSubjectPanelRow(subject string) string {
	innerWidth := panel.DefaultWidth - 2
	contentWidth := innerWidth - (2 * panel.Padding)

	text := formatHeaderRow("Subject", subject)
	if lipgloss.Width(text) > contentWidth {
		text = text[:contentWidth-1] + "…"
	}

	color := panel.ResolveColor(panel.StyleDefault)
	border := lipgloss.NewStyle().Foreground(color)
	return panel.RenderContentRow(text, contentWidth, border)
}

// subjectLineOffset calculates how many lines below the Subject row
// exist in the rendered panel output (including the empty bottom row,
// bottom border, and the two trailing newlines from renderSessionHeader).
//
// This is the initial value of "lines back" before any streaming output.
func subjectLineOffset(info sessionHeaderInfo) int {
	content := formatSessionHeaderContent(info)
	lines := strings.Split(content, "\n")
	subjectIdx := -1
	for i, line := range lines {
		if strings.HasPrefix(line, "Subject:") {
			subjectIdx = i
			break
		}
	}
	if subjectIdx < 0 {
		return 0
	}
	contentLinesAfter := len(lines) - subjectIdx - 1
	// +4 accounts for: empty row below content, bottom border, two trailing newlines.
	return contentLinesAfter + 4
}

// setupSubjectUpdater creates a subjectUpdater and wraps the data/status
// writers with line counting. Returns the wrapped writers and the updater.
// If the header has no subject slot, returns the original writers and nil.
func setupSubjectUpdater(dataW, statusW io.Writer, info sessionHeaderInfo) (io.Writer, io.Writer, *subjectUpdater) {
	offset := subjectLineOffset(info)
	if offset <= 0 {
		return dataW, statusW, nil
	}

	counter := &atomic.Int64{}
	wrappedData := &lineCountingWriter{inner: dataW, counter: counter}
	wrappedStatus := &lineCountingWriter{inner: statusW, counter: counter}

	updater := &subjectUpdater{
		rawWriter:     statusW,
		lineCounter:   counter,
		offsetFromEnd: offset,
	}
	return wrappedData, wrappedStatus, updater
}

// pollSessionSubject polls the backend for the session's subject in a
// background goroutine. When a meaningful subject arrives (i.e., the
// backend's async title generation has completed), it updates the header
// panel in-place via the subjectUpdater.
func pollSessionSubject(ctx context.Context, conn grpc.ClientConnInterface, sessionID string, updater *subjectUpdater) {
	for i := 0; i < subjectPollMaxTries; i++ {
		select {
		case <-ctx.Done():
			return
		case <-time.After(subjectPollInterval):
		}

		ses, err := session.GetFromBackend(conn, sessionID)
		if err != nil {
			log.Debug().Err(err).Msg("[subject-poll] failed to fetch session")
			continue
		}

		subject := session.ResolvedSubject(ses.GetSpec().GetSubject())
		if subject != "" {
			updater.UpdateSubject(subject)
			return
		}
	}
}
