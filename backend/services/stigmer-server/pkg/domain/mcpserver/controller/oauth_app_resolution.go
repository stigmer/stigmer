package mcpserver

import (
	"context"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	oauthappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// resolveOAuthAppByRef resolves the OAuthApp an McpServer's
// spec.auth.oauth_app_ref points to: matched by slug, with org as an
// additional filter only when the ref carries one. OSS has a flat OAuthApp
// store — there is no org-override resolution chain like the cloud's
// OAuthAppResolutionService, so the ref IS the whole resolution.
//
// Both the OAuth initiate path and the read-path oauth_status enricher must
// select the same OAuthApp for a given ref, so they share this one lookup.
//
// Returns (nil, nil) when no stored OAuthApp matches; callers own the
// severity of that outcome (initiate refuses NOT_FOUND, the enricher skips).
func resolveOAuthAppByRef(
	ctx context.Context,
	s store.Store,
	ref *apiresource.ApiResourceReference,
) (*oauthappv1.OAuthApp, error) {
	oauthApps, err := s.ListResources(ctx, apiresourcekind.ApiResourceKind_oauth_app)
	if err != nil {
		return nil, err
	}

	for _, data := range oauthApps {
		app := &oauthappv1.OAuthApp{}
		if err := proto.Unmarshal(data, app); err != nil {
			continue
		}
		if app.GetMetadata().GetSlug() == ref.GetSlug() &&
			(ref.GetOrg() == "" || app.GetMetadata().GetOrg() == ref.GetOrg()) {
			return app, nil
		}
	}

	return nil, nil
}
