package session

import (
	"context"

	"github.com/pkg/errors"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"google.golang.org/grpc"
)

// DeleteFromBackend deletes a session by resource ID via gRPC.
func DeleteFromBackend(conn grpc.ClientConnInterface, resourceID string) (*sessionv1.Session, error) {
	if resourceID == "" {
		return nil, errors.New("session ID is required for delete operation")
	}

	client := sessionv1.NewSessionCommandControllerClient(conn)
	ctx := context.Background()

	deleted, err := client.Delete(ctx, &sessionv1.SessionId{
		Value: resourceID,
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete session '%s'", resourceID)
	}

	return deleted, nil
}
