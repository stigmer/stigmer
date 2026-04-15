package environment

import (
	"context"

	"github.com/pkg/errors"
	environmentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"google.golang.org/grpc"
)

// DeleteFromBackend deletes an environment by resource ID via gRPC.
func DeleteFromBackend(conn grpc.ClientConnInterface, resourceID string) (*environmentv1.Environment, error) {
	if resourceID == "" {
		return nil, errors.New("environment ID is required for delete operation")
	}

	client := environmentv1.NewEnvironmentCommandControllerClient(conn)
	ctx := context.Background()

	deleted, err := client.Delete(ctx, &apiresource.ApiResourceDeleteInput{
		ResourceId: resourceID,
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete environment '%s'", resourceID)
	}

	return deleted, nil
}
