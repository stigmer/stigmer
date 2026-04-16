package environment

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	environmentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/environment/v1"
)

// GetFromBackend fetches an environment from the backend by reference.
func GetFromBackend(client *stigmer.Client, orgID, ref string) (*environmentv1.Environment, error) {
	parsed, err := reference.Parse(ref, orgID)
	if err != nil {
		return nil, errors.Wrap(err, "invalid environment reference")
	}

	ctx := context.Background()

	var result *environmentv1.Environment

	if parsed.IsID {
		result, err = client.Environment.Get(ctx, parsed.ID)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get environment by ID '%s'", parsed.ID)
		}
	} else {
		result, err = client.Environment.GetByReference(ctx, stigmer.ResourceRef{
			Org:  parsed.Org,
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
	Client    *stigmer.Client
}

// Get fetches an environment from the backend using the provided options.
func Get(opts *GetOptions) (*environmentv1.Environment, error) {
	if opts == nil {
		return nil, fmt.Errorf("get options cannot be nil")
	}
	if opts.Client == nil {
		return nil, fmt.Errorf("client cannot be nil")
	}
	if opts.Reference == "" {
		return nil, fmt.Errorf("environment reference cannot be empty")
	}
	return GetFromBackend(opts.Client, opts.OrgID, opts.Reference)
}
