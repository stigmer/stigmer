package identityprovider

import (
	"context"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	identityproviderv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/iam/identityprovider/v1"
	"google.golang.org/grpc"
)

// DeleteFromBackend deletes an identity provider by resource ID via gRPC.
func DeleteFromBackend(conn grpc.ClientConnInterface, resourceID string) (*identityproviderv1.IdentityProvider, error) {
	if resourceID == "" {
		return nil, errors.New("identity provider ID is required for delete operation")
	}

	client := identityproviderv1.NewIdentityProviderCommandControllerClient(conn)
	ctx := context.Background()

	deleted, err := client.Delete(ctx, &apiresource.ApiResourceDeleteInput{
		ResourceId: resourceID,
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete identity provider '%s'", resourceID)
	}

	return deleted, nil
}
