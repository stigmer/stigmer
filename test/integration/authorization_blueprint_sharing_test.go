//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	iampolicyv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/iampolicy/v1"
)

// This suite is the blueprint companion to
// authorization_workflow_execution_sharing_test.go. Blueprints (agent / skill /
// mcp_server / workflow) are SHARED resources that declare
// grantable_roles [owner, viewer] in the registry and expose
// can_grant_access / can_view_access in their FGA models. The unified "Manage
// access" dialog surfaces explicit per-teammate grants on every one of them; this
// test proves that axis end-to-end through the real service + OpenFGA, so the
// frontend unification rests on a guarded contract rather than an assumption.
//
// Before this work the agent / skill / mcp_server blueprints had no sharing UI at
// all — only a visibility dial — so this is the regression guard for the exact
// asymmetry that triggered the unification: a user could broaden visibility but
// never grant a single teammate access.
//
// The privacy boundary under test is the explicit grant, so each blueprint is
// forced to PRIVATE first; blueprints default to ORG on create, which would let a
// teammate view by org membership and mask the grant's effect.

func TestBlueprintPerPrincipalSharing(t *testing.T) {
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
			id := bk.create(t, ctx, owner.Clients)

			// Force PRIVATE so the only path to a teammate viewing it is an
			// explicit grant — not org-membership inheritance.
			require.NoError(t, bk.updateVisibility(ctx, owner.Clients, id,
				apiresource.ApiResourceVisibility_visibility_private),
				"owner makes the %s private", bk.name)

			// Baseline: owner sees it; teammate and outsider do not.
			owner.RequireCanView(t, ctx, bk.name, id)
			member.RequireCannotView(t, ctx, bk.name, id)
			stranger.RequireCannotView(t, ctx, bk.name, id)

			// Regression guard: owner can enumerate the access list. This
			// requires can_view_access on the kind — its absence is what would
			// make the Manage access People section fail with "unauthorized to
			// view resource access".
			access, err := owner.Clients.IamPolicyQuery.ListResourceAccessByPrincipal(ctx,
				&iampolicyv1.ListResourceAccessInput{
					Resource: &iampolicyv1.ApiResourceRef{Kind: bk.name, Id: id},
				})
			require.NoError(t, err, "owner must be able to view the %s access list", bk.name)
			require.False(t, principalHasAccess(access, member.AccountID),
				"member must not appear in the %s access list before grant", bk.name)

			// A non-grantee must NOT be able to read the access list.
			_, err = member.Clients.IamPolicyQuery.ListResourceAccessByPrincipal(ctx,
				&iampolicyv1.ListResourceAccessInput{
					Resource: &iampolicyv1.ApiResourceRef{Kind: bk.name, Id: id},
				})
			require.True(t, isAccessDenied(err),
				"member without access must be denied the %s access list", bk.name)

			// Grant viewer to the member (the dialog's "Add people" action).
			grantViewer(t, ctx, owner.Clients, bk.name, id, member.AccountID)

			// The grantee can now view it and appears in the list; the outsider
			// remains shut out.
			member.RequireCanView(t, ctx, bk.name, id)
			require.NoError(t, bk.get(ctx, member.Clients, id),
				"granted member Get on the %s", bk.name)
			stranger.RequireCannotView(t, ctx, bk.name, id)

			access, err = owner.Clients.IamPolicyQuery.ListResourceAccessByPrincipal(ctx,
				&iampolicyv1.ListResourceAccessInput{
					Resource: &iampolicyv1.ApiResourceRef{Kind: bk.name, Id: id},
				})
			require.NoError(t, err, "owner re-reads the %s access list after granting", bk.name)
			require.True(t, principalHasAccess(access, member.AccountID),
				"member must appear in the %s access list after being granted viewer", bk.name)

			// Revoking restores privacy — the share is a reversible grant.
			revokeViewer(t, ctx, owner.Clients, bk.name, id, member.AccountID)
			member.RequireCannotView(t, ctx, bk.name, id)
		})
	}
}
