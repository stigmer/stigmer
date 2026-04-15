package apikey

import (
	"context"
	"time"

	"github.com/pkg/errors"
	apikeyv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/iam/apikey/v1"
	"google.golang.org/grpc"
)

const defaultTimeout = 10 * time.Second

// GetFromBackend fetches an API key by its ID.
func GetFromBackend(conn grpc.ClientConnInterface, ref string) (*apikeyv1.ApiKey, error) {
	client := apikeyv1.NewApiKeyQueryControllerClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	apiKey, err := client.Get(ctx, &apikeyv1.ApiKeyId{Value: ref})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to get API key '%s'", ref)
	}

	return apiKey, nil
}
