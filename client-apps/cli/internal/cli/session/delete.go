package session

import (
	"context"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	sessionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/session/v1"
)

// DeleteFromBackend deletes a session by resource ID.
func DeleteFromBackend(client *stigmer.Client, resourceID string) (*sessionv1.Session, error) {
	if resourceID == "" {
		return nil, errors.New("session ID is required for delete operation")
	}

	ctx := context.Background()

	deleted, err := client.Session.Delete(ctx, resourceID)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete session '%s'", resourceID)
	}

	return deleted, nil
}
