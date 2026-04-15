package identityprovider

import (
	"context"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	identityproviderv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/iam/identityprovider/v1"
)

// DeleteFromBackend deletes an identity provider by resource ID via the SDK.
func DeleteFromBackend(client *stigmer.Client, resourceID string) (*identityproviderv1.IdentityProvider, error) {
	if resourceID == "" {
		return nil, errors.New("identity provider ID is required for delete operation")
	}

	ctx := context.Background()

	deleted, err := client.IdentityProvider.Delete(ctx, &stigmer.DeleteResourceInput{
		ResourceID: resourceID,
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete identity provider '%s'", resourceID)
	}

	return deleted, nil
}
