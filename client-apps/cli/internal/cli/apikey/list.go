package apikey

import (
	"context"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	apikeyv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/iam/apikey/v1"
)

// ListFromBackend returns all API keys for the authenticated user.
// API keys are not search-indexed, so this uses the dedicated FindAll RPC
// instead of the unified SearchService.
func ListFromBackend(client *stigmer.Client) ([]*apikeyv1.ApiKey, error) {
	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	resp, err := client.ApiKey.FindAll(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "failed to list API keys")
	}

	return resp.GetEntries(), nil
}
