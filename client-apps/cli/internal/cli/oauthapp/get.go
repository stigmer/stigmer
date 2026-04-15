package oauthapp

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	oauthappv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/iam/oauthapp/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	"google.golang.org/grpc"
)

// GetFromBackend fetches an OAuth app from the backend by reference.
func GetFromBackend(conn grpc.ClientConnInterface, orgID, ref string) (*oauthappv1.OAuthApp, error) {
	parsed, err := reference.Parse(ref, orgID)
	if err != nil {
		return nil, errors.Wrap(err, "invalid oauth app reference")
	}

	client := oauthappv1.NewOAuthAppQueryControllerClient(conn)
	ctx := context.Background()

	var result *oauthappv1.OAuthApp

	if parsed.IsID {
		result, err = client.Get(ctx, &apiresource.ApiResourceId{
			Value: parsed.ID,
		})
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get oauth app by ID '%s'", parsed.ID)
		}
	} else {
		result, err = client.GetByReference(ctx, &apiresource.ApiResourceReference{
			Org:  parsed.Org,
			Kind: apiresourcekind.ApiResourceKind_oauth_app,
			Slug: parsed.Slug,
		})
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get oauth app '%s/%s'", parsed.Org, parsed.Slug)
		}
	}

	return result, nil
}

// GetOptions contains options for fetching an OAuth app.
type GetOptions struct {
	Reference string
	OrgID     string
	Conn      grpc.ClientConnInterface
}

// Get fetches an OAuth app from the backend using the provided options.
func Get(opts *GetOptions) (*oauthappv1.OAuthApp, error) {
	if opts == nil {
		return nil, fmt.Errorf("get options cannot be nil")
	}
	if opts.Conn == nil {
		return nil, fmt.Errorf("gRPC connection cannot be nil")
	}
	if opts.Reference == "" {
		return nil, fmt.Errorf("oauth app reference cannot be empty")
	}
	return GetFromBackend(opts.Conn, opts.OrgID, opts.Reference)
}
