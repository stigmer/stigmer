package identityprovider

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	identityproviderv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/identityprovider/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	"google.golang.org/grpc"
)

// GetFromBackend fetches an identity provider from the backend by reference.
// The reference can be a slug, org/slug, or a resource ID.
func GetFromBackend(conn grpc.ClientConnInterface, orgID, ref string) (*identityproviderv1.IdentityProvider, error) {
	parsed, err := reference.Parse(ref, orgID)
	if err != nil {
		return nil, errors.Wrap(err, "invalid identity provider reference")
	}

	client := identityproviderv1.NewIdentityProviderQueryControllerClient(conn)
	ctx := context.Background()

	var result *identityproviderv1.IdentityProvider

	if parsed.IsID {
		result, err = client.Get(ctx, &apiresource.ApiResourceId{
			Value: parsed.ID,
		})
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get identity provider by ID '%s'", parsed.ID)
		}
	} else {
		result, err = client.GetByReference(ctx, &apiresource.ApiResourceReference{
			Org:  parsed.Org,
			Kind: apiresourcekind.ApiResourceKind_identity_provider,
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
	Conn      grpc.ClientConnInterface
}

// Get fetches an identity provider from the backend using the provided options.
func Get(opts *GetOptions) (*identityproviderv1.IdentityProvider, error) {
	if opts == nil {
		return nil, fmt.Errorf("get options cannot be nil")
	}
	if opts.Conn == nil {
		return nil, fmt.Errorf("gRPC connection cannot be nil")
	}
	if opts.Reference == "" {
		return nil, fmt.Errorf("identity provider reference cannot be empty")
	}
	return GetFromBackend(opts.Conn, opts.OrgID, opts.Reference)
}
