package apikey

import (
	"context"
	"time"

	"github.com/pkg/errors"
	apikeyv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/iam/apikey/v1"
	"google.golang.org/grpc"
)

// DeleteOptions contains options for deleting an API key.
type DeleteOptions struct {
	ApiKeyID string
	Conn     grpc.ClientConnInterface
}

// DeleteResult contains the result of a delete operation.
type DeleteResult struct {
	ApiKey *apikeyv1.ApiKey
}

// Delete deletes an API key from the backend.
func Delete(opts *DeleteOptions) (*DeleteResult, error) {
	if opts == nil {
		return nil, errors.New("delete options cannot be nil")
	}
	if opts.Conn == nil {
		return nil, errors.New("gRPC connection cannot be nil")
	}
	if opts.ApiKeyID == "" {
		return nil, errors.New("API key ID cannot be empty")
	}

	deleted, err := deleteFromBackend(opts.Conn, opts.ApiKeyID)
	if err != nil {
		return nil, err
	}

	return &DeleteResult{ApiKey: deleted}, nil
}

func deleteFromBackend(conn grpc.ClientConnInterface, keyID string) (*apikeyv1.ApiKey, error) {
	client := apikeyv1.NewApiKeyCommandControllerClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	deleted, err := client.Delete(ctx, &apikeyv1.ApiKeyId{Value: keyID})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete API key '%s'", keyID)
	}

	return deleted, nil
}
