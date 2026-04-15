package root

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"

	stigmer "github.com/stigmer/stigmer/sdk/go"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/session"
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
func pollSessionSubject(ctx context.Context, client *stigmer.Client, sessionID string, ch chan<- string) {
	for attempt := 0; attempt < subjectPollMaxTries; attempt++ {
		select {
		case <-ctx.Done():
			return
		case <-time.After(subjectPollInterval):
		}

		ses, err := session.GetFromBackend(client, sessionID)
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

// recentSessionsFetchPageSize is the page size passed to session.List when
// fetching recent sessions for the welcome header. Slightly larger than
// maxRecentSessions to account for filtering out the current session.
const recentSessionsFetchPageSize = 5

// fetchRecentSessions lists recent sessions from the backend, filters out
// the current session, and sends up to maxRecentSessions entries on ch.
// On any failure the channel is closed without sending — the header renders
// gracefully without the recent sessions section.
func fetchRecentSessions(client *stigmer.Client, currentSessionID string, ch chan<- []recentSession) {
	defer close(ch)

	result, err := session.List(&session.ListOptions{
		Client:   client,
		PageSize: recentSessionsFetchPageSize,
	})
	if err != nil {
		log.Debug().Err(err).Msg("recent sessions: failed to list sessions")
		return
	}

	var sessions []recentSession
	for _, ses := range result.GetEntries() {
		id := ses.GetMetadata().GetId()
		if id == currentSessionID {
			continue
		}

		subject := session.ResolvedSubject(ses.GetSpec().GetSubject())

		var createdAt time.Time
		if audit := ses.GetStatus().GetAudit().GetSpecAudit(); audit != nil && audit.GetCreatedAt() != nil {
			createdAt = audit.GetCreatedAt().AsTime()
		}

		sessions = append(sessions, recentSession{
			SessionID: id,
			Subject:   subject,
			CreatedAt: createdAt,
		})

		if len(sessions) >= maxRecentSessions {
			break
		}
	}

	if len(sessions) > 0 {
		ch <- sessions
	}
}
