// Package session provides CLI utilities for managing Session resources.
package session

import (
	"context"
	"fmt"
	"time"

	"github.com/pkg/errors"
	sessionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	"google.golang.org/grpc"
)

const (
	// DefaultTimeout is the default context timeout for session operations.
	DefaultTimeout = 30 * time.Second

	// PendingSubject is the sentinel value the backend writes when a session is
	// auto-created. A Temporal activity replaces it asynchronously with an
	// LLM-generated title derived from the first user message. Until that
	// happens — or if the activity fails permanently — the sentinel must not
	// be surfaced to users as a meaningful label.
	PendingSubject = "Auto-created session"
)

// ResolvedSubject returns the session's subject when it carries a meaningful
// value, or an empty string while it still holds the backend sentinel.
// All display paths should call this before rendering a session subject so
// that the sentinel is never shown in the UI.
func ResolvedSubject(subject string) string {
	if subject == PendingSubject {
		return ""
	}
	return subject
}

// GetFromBackend fetches a session from the backend by ID.
func GetFromBackend(conn grpc.ClientConnInterface, sessionID string) (*sessionv1.Session, error) {
	if !reference.IsSessionID(sessionID) {
		return nil, fmt.Errorf("invalid session ID format: %s (expected ses-xxx or ses_xxx)", sessionID)
	}

	client := sessionv1.NewSessionQueryControllerClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()

	result, err := client.Get(ctx, &sessionv1.SessionId{
		Value: sessionID,
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to get session '%s'", sessionID)
	}

	return result, nil
}
