package identityprovider

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	identityproviderv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/iam/identityprovider/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
)

// GetFromBackend fetches an identity provider from the backend by reference.
// The reference can be a slug, org/slug, or a resource ID.
func GetFromBackend(client *stigmer.Client, orgID, ref string) (*identityproviderv1.IdentityProvider, error) {
	parsed, err := reference.Parse(ref, orgID)
	if err != nil {
		return nil, errors.Wrap(err, "invalid identity provider reference")
	}

	ctx := context.Background()

	var result *identityproviderv1.IdentityProvider

	if parsed.IsID {
		result, err = client.IdentityProvider.Get(ctx, parsed.ID)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get identity provider by ID '%s'", parsed.ID)
		}
	} else {
		result, err = client.IdentityProvider.GetByReference(ctx, stigmer.ResourceRef{
			Org:  parsed.Org,
			Slug: parsed.Slug,
		})
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get identity provider '%s/%s'", parsed.Org, parsed.Slug)
		}
	}

	return result, nil
}

// GetOptions contains options for fetching an identity provider.
type GetOptions struct {
	Reference string
	OrgID     string
	Client    *stigmer.Client
}

// Get fetches an identity provider from the backend using the provided options.
func Get(opts *GetOptions) (*identityproviderv1.IdentityProvider, error) {
	if opts == nil {
		return nil, fmt.Errorf("get options cannot be nil")
	}
	if opts.Client == nil {
		return nil, fmt.Errorf("client cannot be nil")
	}
	if opts.Reference == "" {
		return nil, fmt.Errorf("identity provider reference cannot be empty")
	}
	return GetFromBackend(opts.Client, opts.OrgID, opts.Reference)
}
