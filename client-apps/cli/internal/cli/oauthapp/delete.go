package oauthapp

import (
	"context"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	oauthappv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/iam/oauthapp/v1"
	"google.golang.org/grpc"
)

// DeleteFromBackend deletes an OAuth app by resource ID via gRPC.
func DeleteFromBackend(conn grpc.ClientConnInterface, resourceID string) (*oauthappv1.OAuthApp, error) {
	if resourceID == "" {
		return nil, errors.New("oauth app ID is required for delete operation")
	}

	client := oauthappv1.NewOAuthAppCommandControllerClient(conn)
	ctx := context.Background()

	deleted, err := client.Delete(ctx, &apiresource.ApiResourceDeleteInput{
		ResourceId: resourceID,
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete oauth app '%s'", resourceID)
	}

	return deleted, nil
}
