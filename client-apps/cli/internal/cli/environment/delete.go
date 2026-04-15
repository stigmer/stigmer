package environment

import (
	"context"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	environmentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/environment/v1"
)

// DeleteFromBackend deletes an environment by resource ID via the SDK.
func DeleteFromBackend(client *stigmer.Client, resourceID string) (*environmentv1.Environment, error) {
	if resourceID == "" {
		return nil, errors.New("environment ID is required for delete operation")
	}

	ctx := context.Background()

	deleted, err := client.Environment.Delete(ctx, &stigmer.DeleteResourceInput{
		ResourceID: resourceID,
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete environment '%s'", resourceID)
	}

	return deleted, nil
}
