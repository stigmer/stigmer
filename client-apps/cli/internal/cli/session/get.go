// Package session provides CLI utilities for managing Session resources.
package session

import (
	"context"
	"fmt"
	"time"

	"github.com/pkg/errors"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	"google.golang.org/grpc"
)

const (
	// DefaultTimeout is the default context timeout for session operations.
	DefaultTimeout = 30 * time.Second
)

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
