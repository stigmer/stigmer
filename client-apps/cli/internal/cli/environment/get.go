package environment

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	environmentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	"google.golang.org/grpc"
)

// GetFromBackend fetches an environment from the backend by reference.
func GetFromBackend(conn grpc.ClientConnInterface, orgID, ref string) (*environmentv1.Environment, error) {
	parsed, err := reference.Parse(ref, orgID)
	if err != nil {
		return nil, errors.Wrap(err, "invalid environment reference")
	}

	client := environmentv1.NewEnvironmentQueryControllerClient(conn)
	ctx := context.Background()

	var result *environmentv1.Environment

	if parsed.IsID {
		result, err = client.Get(ctx, &apiresource.ApiResourceId{
			Value: parsed.ID,
		})
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get environment by ID '%s'", parsed.ID)
		}
	} else {
		result, err = client.GetByReference(ctx, &apiresource.ApiResourceReference{
			Org:  parsed.Org,
			Kind: apiresourcekind.ApiResourceKind_environment,
			Slug: parsed.Slug,
		})
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get environment '%s/%s'", parsed.Org, parsed.Slug)
		}
	}

	return result, nil
}

// GetOptions contains options for fetching an environment.
type GetOptions struct {
	Reference string
	OrgID     string
	Conn      grpc.ClientConnInterface
}

// Get fetches an environment from the backend using the provided options.
func Get(opts *GetOptions) (*environmentv1.Environment, error) {
	if opts == nil {
		return nil, fmt.Errorf("get options cannot be nil")
	}
	if opts.Conn == nil {
		return nil, fmt.Errorf("gRPC connection cannot be nil")
	}
	if opts.Reference == "" {
		return nil, fmt.Errorf("environment reference cannot be empty")
	}
	return GetFromBackend(opts.Conn, opts.OrgID, opts.Reference)
}
