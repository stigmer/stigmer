package oauthapp

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	oauthappv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/iam/oauthapp/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
)

// GetFromBackend fetches an OAuth app from the backend by reference.
func GetFromBackend(client *stigmer.Client, orgID, ref string) (*oauthappv1.OAuthApp, error) {
	parsed, err := reference.Parse(ref, orgID)
	if err != nil {
		return nil, errors.Wrap(err, "invalid oauth app reference")
	}

	ctx := context.Background()

	var result *oauthappv1.OAuthApp

	if parsed.IsID {
		result, err = client.OAuthApp.Get(ctx, parsed.ID)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get oauth app by ID '%s'", parsed.ID)
		}
	} else {
		result, err = client.OAuthApp.GetByReference(ctx, stigmer.ResourceRef{
			Org:  parsed.Org,
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
	Client    *stigmer.Client
}

// Get fetches an OAuth app from the backend using the provided options.
func Get(opts *GetOptions) (*oauthappv1.OAuthApp, error) {
	if opts == nil {
		return nil, fmt.Errorf("get options cannot be nil")
	}
	if opts.Client == nil {
		return nil, fmt.Errorf("client cannot be nil")
	}
	if opts.Reference == "" {
		return nil, fmt.Errorf("oauth app reference cannot be empty")
	}
	return GetFromBackend(opts.Client, opts.OrgID, opts.Reference)
}
