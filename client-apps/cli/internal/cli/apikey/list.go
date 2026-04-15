package apikey

import (
	"context"

	"github.com/pkg/errors"
	apikeyv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/iam/apikey/v1"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/emptypb"
)

// ListFromBackend returns all API keys for the authenticated user.
// API keys are not search-indexed, so this uses the dedicated FindAll RPC
// instead of the unified SearchService.
func ListFromBackend(conn grpc.ClientConnInterface) ([]*apikeyv1.ApiKey, error) {
	client := apikeyv1.NewApiKeyQueryControllerClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	resp, err := client.FindAll(ctx, &emptypb.Empty{})
	if err != nil {
		return nil, errors.Wrap(err, "failed to list API keys")
	}

	return resp.GetEntries(), nil
}
