package apikey

import (
	"context"
	"time"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	apikeyv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/iam/apikey/v1"
)

const defaultTimeout = 10 * time.Second

// GetFromBackend fetches an API key by its ID.
func GetFromBackend(client *stigmer.Client, ref string) (*apikeyv1.ApiKey, error) {
	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	apiKey, err := client.ApiKey.Get(ctx, ref)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to get API key '%s'", ref)
	}

	return apiKey, nil
}
