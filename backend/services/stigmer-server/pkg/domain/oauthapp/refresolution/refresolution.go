// Package refresolution owns the OSS semantics of resolving an
// `oauth_app_ref` (an ApiResourceReference on McpServerAuth) to a stored
// OAuthApp — the defaultinstance pattern: one small package holds a
// cross-domain semantic so its consumers cannot drift apart.
//
// Every question of the form "which OAuthApp does this ref mean?" must go
// through Resolve. Its consumers, which previously carried three divergent
// hand-rolled answers (stigmer/stigmer#584):
//
//   - the OAuth initiate path and the read-path oauth_status enricher
//     (mcpserver controller) — the app the user signs in against;
//   - the token-refresh path (mcpserver controller) — the client secret
//     used to refresh; MUST be the app initiate selected, or refresh runs
//     against the wrong vendor credentials;
//   - the OAuthApp delete guard (oauthapp controller) — deletion is blocked
//     exactly when some server's ref RESOLVES to the app being deleted, so
//     a resolvable connection can never be severed silently.
//
// # Resolution semantics
//
// OSS has a flat OAuthApp store — there is no org-override chain like the
// cloud's OAuthAppResolutionService, so the ref is the whole resolution
// (DD-019). Matching is by slug, with the ref's org as a preference rather
// than a gate:
//
//  1. An exact (org, slug) match wins. Uniqueness is guaranteed by the
//     create pipeline's duplicate check.
//  2. Otherwise a slug-only match is honored when it is UNIQUE. This is
//     what lets a self-hosted deployment satisfy seedpack refs pinned to
//     `org: stigmer` (the hosted platform's org, which stays pinned so
//     cloud resolution remains deterministic) with an OAuthApp applied in
//     the user's own org (stigmer/stigmer#584).
//  3. Two or more slug matches with no exact hit resolve to nothing, with
//     a WARN naming the candidate orgs: ambiguity is never silently
//     collapsed into a credential pick. Pin the ref's org (or delete the
//     duplicate app) to break the tie.
//
// Returns (nil, nil) when nothing resolves; callers own the severity of
// that outcome (initiate refuses NOT_FOUND, the enricher skips, token
// refresh errors, the delete guard treats it as unreferenced).
package refresolution

import (
	"context"

	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	oauthappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// Resolve returns the OAuthApp the ref means under the package's resolution
// semantics (exact org+slug match, else unique slug-only match, else nil).
// A ref without a slug resolves to nothing — an McpServerAuth with no
// (or an empty) oauth_app_ref is the DCR/manual-token arm, not a lookup.
func Resolve(
	ctx context.Context,
	s store.Store,
	ref *apiresource.ApiResourceReference,
) (*oauthappv1.OAuthApp, error) {
	if ref.GetSlug() == "" {
		return nil, nil
	}

	oauthApps, err := s.ListResources(ctx, apiresourcekind.ApiResourceKind_oauth_app)
	if err != nil {
		return nil, err
	}

	// Collect-then-decide: a single pass gathers every slug match so the
	// outcome depends only on the store's contents, never on its iteration
	// order (the previous first-match-wins scan was nondeterministic when
	// a slug existed in several orgs).
	var slugMatches []*oauthappv1.OAuthApp
	for _, data := range oauthApps {
		app := &oauthappv1.OAuthApp{}
		if err := proto.Unmarshal(data, app); err != nil {
			continue
		}
		if app.GetMetadata().GetSlug() != ref.GetSlug() {
			continue
		}
		if ref.GetOrg() != "" && app.GetMetadata().GetOrg() == ref.GetOrg() {
			return app, nil // exact match: unique by the create duplicate check
		}
		slugMatches = append(slugMatches, app)
	}

	switch len(slugMatches) {
	case 0:
		return nil, nil
	case 1:
		return slugMatches[0], nil
	default:
		orgs := make([]string, len(slugMatches))
		for i, app := range slugMatches {
			orgs[i] = app.GetMetadata().GetOrg()
		}
		log.Warn().
			Str("oauth_app_slug", ref.GetSlug()).
			Str("ref_org", ref.GetOrg()).
			Strs("candidate_orgs", orgs).
			Msg("oauth_app_ref is ambiguous (slug exists in several orgs, none matching the ref); refusing to pick — pin the ref's org to resolve")
		return nil, nil
	}
}
