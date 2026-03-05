package root

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/session"
	"google.golang.org/grpc"
)

const (
	subjectPollInterval = 3 * time.Second
	subjectPollMaxTries = 10
)

// pollSessionSubject polls the backend until the session subject is resolved
// (no longer the "Auto-created session" sentinel). On success, the resolved
// subject is sent on ch. The goroutine exits silently when:
//   - The subject resolves (sent on ch)
//   - The context is cancelled
//   - maxTries is exhausted
//   - The session fetch fails with a non-transient error
//
// Errors are logged at debug level since a missing subject is cosmetic —
// the session continues to function without it.
func pollSessionSubject(ctx context.Context, conn grpc.ClientConnInterface, sessionID string, ch chan<- string) {
	for attempt := 0; attempt < subjectPollMaxTries; attempt++ {
		select {
		case <-ctx.Done():
			return
		case <-time.After(subjectPollInterval):
		}

		ses, err := session.GetFromBackend(conn, sessionID)
		if err != nil {
			log.Debug().Err(err).
				Str("session_id", sessionID).
				Int("attempt", attempt+1).
				Msg("subject poll: failed to fetch session")
			continue
		}

		subject := session.ResolvedSubject(ses.GetSpec().GetSubject())
		if subject != "" {
			select {
			case ch <- subject:
			case <-ctx.Done():
			}
			return
		}
	}
}
