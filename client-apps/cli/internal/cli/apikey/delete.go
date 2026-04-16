package apikey

import (
	"context"
	"time"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	apikeyv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/iam/apikey/v1"
)

// DeleteOptions contains options for deleting an API key.
type DeleteOptions struct {
	ApiKeyID string
	Client   *stigmer.Client
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
	if opts.Client == nil {
		return nil, errors.New("client cannot be nil")
	}
	if opts.ApiKeyID == "" {
		return nil, errors.New("API key ID cannot be empty")
	}

	deleted, err := deleteFromBackend(opts.Client, opts.ApiKeyID)
	if err != nil {
		return nil, err
	}

	return &DeleteResult{ApiKey: deleted}, nil
}

func deleteFromBackend(client *stigmer.Client, keyID string) (*apikeyv1.ApiKey, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	deleted, err := client.ApiKey.Delete(ctx, keyID)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete API key '%s'", keyID)
	}

	return deleted, nil
}
