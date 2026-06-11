//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	rpc "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/rpc"
	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
)

const (
	visPrivate = apiresource.ApiResourceVisibility_visibility_private
	visOrg     = apiresource.ApiResourceVisibility_visibility_org
	visPublic  = apiresource.ApiResourceVisibility_visibility_public
)

// TestVisibilityBlueprintEnforcement is the heart of the suite: it proves the
// four blueprint kinds enforce private / org / public visibility identically
// through the real service + OpenFGA, against three distinct callers.
//
// Two assertion primitives are used in tandem (see authorization_visibility_common_test.go):
//   - Get per actor — proves the load+authorize pipeline enforces, not just FGA.
//   - CheckMyPermission — the production self-check, anchored to the caller, for
//     fine-grained can_view / can_execute / can_edit verdicts.
func TestVisibilityBlueprintEnforcement(t *testing.T) {
	requireVisibilityHarness(t)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	actors := newVisibilityActors(t, ctx)
	owner := actors.Owner()
	member := actors.Member()
	stranger := actors.Stranger()

	for _, bk := range blueprintKinds() {
		bk := bk
		t.Run(bk.name, func(t *testing.T) {
			t.Run("private", func(t *testing.T) {
				id := bk.create(t, ctx, owner.Clients)
				require.NoError(t, bk.updateVisibility(ctx, owner.Clients, id, visPrivate))
				requireVisibility(t, ctx, bk, owner.Clients, id, visPrivate)

				// Owner (creator) always sees their own private blueprint.
				owner.RequireCanView(t, ctx, bk.name, id)
				require.NoError(t, bk.get(ctx, owner.Clients, id), "owner Get on private")

				// Private is truly private — even fellow org members are excluded.
				member.RequireCannotView(t, ctx, bk.name, id)
				require.True(t, isAccessDenied(bk.get(ctx, member.Clients, id)), "member Get on private must be denied")

				stranger.RequireCannotView(t, ctx, bk.name, id)
				require.True(t, isAccessDenied(bk.get(ctx, stranger.Clients, id)), "stranger Get on private must be denied")
			})

			t.Run("org", func(t *testing.T) {
				// Blueprints default to visibility_org on create — no update needed,
				// which also asserts the create pipeline writes the org tuple.
				id := bk.create(t, ctx, owner.Clients)
				requireVisibility(t, ctx, bk, owner.Clients, id, visOrg)

				owner.RequireCanView(t, ctx, bk.name, id)
				member.RequireCanView(t, ctx, bk.name, id)
				require.NoError(t, bk.get(ctx, member.Clients, id), "member Get on org-visible")

				stranger.RequireCannotView(t, ctx, bk.name, id)
				require.True(t, isAccessDenied(bk.get(ctx, stranger.Clients, id)), "stranger Get on org-visible must be denied")

				if bk.supportsExecute {
					// "Run what you can read": a member who can view an org
					// blueprint can execute it; a stranger who cannot view cannot.
					member.RequirePermission(t, ctx, bk.name, id, "can_execute", true)
					stranger.RequirePermission(t, ctx, bk.name, id, "can_execute", false)
					// Visibility never confers edit.
					member.RequirePermission(t, ctx, bk.name, id, "can_edit", false)
				}
			})

			t.Run("public", func(t *testing.T) {
				id := bk.create(t, ctx, owner.Clients)
				require.NoError(t, bk.updateVisibility(ctx, owner.Clients, id, visPublic))
				requireVisibility(t, ctx, bk, owner.Clients, id, visPublic)

				// Public is readable by everyone, including a complete outsider —
				// this also asserts the service supplies the allow_public context.
				for _, a := range []*harness.Actor{owner, member, stranger} {
					a.RequireCanView(t, ctx, bk.name, id)
					require.NoErrorf(t, bk.get(ctx, a.Clients, id), "%s Get on public", a.Name)
				}

				if bk.supportsExecute {
					member.RequirePermission(t, ctx, bk.name, id, "can_execute", true)
					stranger.RequirePermission(t, ctx, bk.name, id, "can_execute", true)
					member.RequirePermission(t, ctx, bk.name, id, "can_edit", false)
				}
			})

			// reconciler_transitions exercises the set-diff reconciliation across
			// every level change — the stale-tuple bug class. The org floor (the
			// shared org#member shape) must survive a public->org demotion while
			// the public exposure is removed.
			t.Run("reconciler_transitions", func(t *testing.T) {
				id := bk.create(t, ctx, owner.Clients) // starts org
				member.RequireCanView(t, ctx, bk.name, id)

				// org -> private: member access must be revoked (no stale tuple).
				require.NoError(t, bk.updateVisibility(ctx, owner.Clients, id, visPrivate))
				member.RequireCannotView(t, ctx, bk.name, id)
				stranger.RequireCannotView(t, ctx, bk.name, id)

				// private -> public: both gain access.
				require.NoError(t, bk.updateVisibility(ctx, owner.Clients, id, visPublic))
				member.RequireCanView(t, ctx, bk.name, id)
				stranger.RequireCanView(t, ctx, bk.name, id)

				// public -> org: stranger loses access, member keeps it (org floor).
				require.NoError(t, bk.updateVisibility(ctx, owner.Clients, id, visOrg))
				member.RequireCanView(t, ctx, bk.name, id)
				stranger.RequireCannotView(t, ctx, bk.name, id)

				// org -> private again: both excluded.
				require.NoError(t, bk.updateVisibility(ctx, owner.Clients, id, visPrivate))
				member.RequireCannotView(t, ctx, bk.name, id)
				stranger.RequireCannotView(t, ctx, bk.name, id)
			})

			// listing asserts the FGA-ListObjects-backed Search path filters per
			// caller: an org member's listing includes org-visible blueprints and
			// excludes private ones; an outsider sees neither.
			t.Run("listing", func(t *testing.T) {
				orgID := bk.create(t, ctx, owner.Clients) // org-visible (default)
				privateID := bk.create(t, ctx, owner.Clients)
				require.NoError(t, bk.updateVisibility(ctx, owner.Clients, privateID, visPrivate))

				ownerIDs := searchKindIDs(t, ctx, owner.Clients, bk.searchKind, harness.TestOrg)
				require.Contains(t, ownerIDs, orgID, "owner listing should include org blueprint")
				require.Contains(t, ownerIDs, privateID, "owner listing should include own private blueprint")

				memberIDs := searchKindIDs(t, ctx, member.Clients, bk.searchKind, harness.TestOrg)
				require.Contains(t, memberIDs, orgID, "member listing should include org blueprint")
				require.NotContains(t, memberIDs, privateID, "member listing must exclude private blueprint")

				strangerIDs := searchKindIDs(t, ctx, stranger.Clients, bk.searchKind, harness.TestOrg)
				require.NotContains(t, strangerIDs, orgID, "stranger listing must exclude org blueprint")
				require.NotContains(t, strangerIDs, privateID, "stranger listing must exclude private blueprint")
			})
		})
	}
}

// requireVisibility asserts the persisted visibility level of a blueprint.
func requireVisibility(t *testing.T, ctx context.Context, bk blueprintKind, c *harness.Clients, id string, want apiresource.ApiResourceVisibility) {
	t.Helper()
	got, err := bk.getVisibility(ctx, c, id)
	require.NoError(t, err, "read visibility of %s %s", bk.name, id)
	require.Equalf(t, want, got, "persisted visibility of %s %s", bk.name, id)
}

// searchKindIDs returns the set of resource ids the caller can list for a kind
// in an org, draining pages (newest-first, so freshly created fixtures land on
// the first page). The returned map doubles as a membership set.
func searchKindIDs(t *testing.T, ctx context.Context, c *harness.Clients, kind apiresourcekind.ApiResourceKind, org string) map[string]struct{} {
	t.Helper()
	ids := make(map[string]struct{})
	for page := int32(1); ; page++ {
		resp, err := c.Search.Search(ctx, &searchv1.SearchRequest{
			Kinds: []apiresourcekind.ApiResourceKind{kind},
			Org:   org,
			Page:  &rpc.PageInfo{Num: page, Size: 100},
		})
		require.NoError(t, err, "search %s in %s", kind, org)
		for _, e := range resp.GetEntries() {
			ids[e.GetId()] = struct{}{}
		}
		if page >= resp.GetTotalPages() || len(resp.GetEntries()) == 0 {
			break
		}
	}
	return ids
}
