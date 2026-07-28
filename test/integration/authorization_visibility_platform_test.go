//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
)

// TestVisibilityPlatformCrossTenant is the cross-tenant E2E for platform
// visibility — the multi-tenant sharing model — exercised through the real
// service + OpenFGA across organization boundaries.
//
// Setup (all via production RPCs; see harness.CreatePlatformManagedOrg):
// TestOrg operates an IdentityProvider and a platform-managed child org whose
// member is therefore a platform_user. A blueprint TestOrg marks
// visibility_platform fans out to that IdP's platform_user userset, so the
// child-org member inherits access — including to the blueprint's default
// instance (via default_of) — while a true outsider stays locked out.
func TestVisibilityPlatformCrossTenant(t *testing.T) {
	requireVisibilityHarness(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	actors := newVisibilityActors(t, ctx)
	owner := actors.Owner()
	stranger := actors.Stranger()

	// Provision the cross-tenant fixture: IdP in TestOrg + managed child org + a
	// member of that child org (a platform_user of the IdP).
	pmo := harness.CreatePlatformManagedOrg(t, ctx, grpcConn, testHarness.Service.GRPCAddress())
	childMember := pmo.Member

	for _, bk := range blueprintKinds() {
		bk := bk
		t.Run(bk.name, func(t *testing.T) {
			id := bk.create(t, ctx, owner.Clients)
			require.NoError(t, bk.updateVisibility(ctx, owner.Clients, id, visPlatform))
			requireVisibility(t, ctx, bk, owner.Clients, id, visPlatform)

			// The child-org member is a platform_user and inherits viewer through
			// the IdP — the full platform_user -> platform_viewer chain.
			childMember.RequireCanView(t, ctx, bk.name, id)
			require.NoError(t, bk.get(ctx, childMember.Clients, id), "child-org member Get on platform blueprint")

			// The owning org's own members must still see it (the org floor that
			// platform/public visibility carries for blueprints).
			actors.Member().RequireCanView(t, ctx, bk.name, id)

			if bk.supportsExecute {
				childMember.RequirePermission(t, ctx, bk.name, id, "can_execute", true)
			}

			// The default instance inherits platform reachability structurally.
			if bk.defaultInstanceID != nil && bk.instanceKindName != "" {
				instID, ok, err := bk.defaultInstanceID(ctx, owner.Clients, id)
				require.NoError(t, err, "read default instance id")
				require.True(t, ok, "%s should have a default instance", bk.name)
				childMember.RequireCanView(t, ctx, bk.instanceKindName, instID)
			}

			// Listing: the child-org catalog (scoped to the child org) surfaces the
			// platform blueprint even though it lives in TestOrg — the deliberate
			// org-filter carve-out for visibility_platform in the search query store.
			childIDs := searchKindIDs(t, ctx, childMember.Clients, bk.searchKind, pmo.OrgID)
			require.Contains(t, childIDs, id, "child-org listing should surface the platform blueprint")

			// A true outsider — provisioned but in no managed org — is fully denied.
			stranger.RequireCannotView(t, ctx, bk.name, id)
			require.True(t, isAccessDenied(bk.get(ctx, stranger.Clients, id)), "stranger Get on platform blueprint must be denied")
			if bk.supportsExecute {
				stranger.RequirePermission(t, ctx, bk.name, id, "can_execute", false)
			}
			strangerIDs := searchKindIDs(t, ctx, stranger.Clients, bk.searchKind, pmo.OrgID)
			require.NotContains(t, strangerIDs, id, "outsider listing must not surface the platform blueprint")
		})
	}

	// Negative: platform visibility on a blueprint owned by an org that operates
	// NO IdentityProvider is rejected — there is no platform_user userset to
	// anchor the grant to, so persisting it would be an unenforceable lie.
	t.Run("no_idp_rejected", func(t *testing.T) {
		orgID := createSelfManagedOrg(t, ctx, owner.Clients)

		agent, err := owner.Clients.AgentCommand.Create(ctx, &agentv1.Agent{
			ApiVersion: harness.TestAPIVersion,
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: uniqueVisibilityName("vis-noidp-agent"),
				Org:  orgID,
			},
			Spec: &agentv1.AgentSpec{
				Description:  "Agent in an IdP-less org",
				Instructions: "You are a test agent.",
			},
		})
		require.NoError(t, err, "create agent in self-managed org")

		_, err = owner.Clients.AgentCommand.UpdateVisibility(ctx, &apiresource.UpdateVisibilityInput{
			ResourceId: agent.GetMetadata().GetId(),
			Visibility: visPlatform,
		})
		requireStatusCode(t, err, codes.InvalidArgument,
			"platform visibility must be rejected for an org with no IdentityProvider")
	})
}

// createSelfManagedOrg creates a fresh self-managed organization owned by the
// caller (no IdentityProvider) and registers cleanup. Used to assert that
// platform visibility is rejected without an IdP.
func createSelfManagedOrg(t *testing.T, ctx context.Context, c *harness.Clients) string {
	t.Helper()
	slug := uniqueVisibilityName("noidp-org")
	org, err := c.OrganizationCommand.Create(ctx, &organizationv1.Organization{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Organization",
		Metadata:   &apiresource.ApiResourceMetadata{Name: slug},
		Spec:       &organizationv1.OrganizationSpec{ManagementMode: organizationv1.ManagementMode_self_managed},
	})
	require.NoError(t, err, "create self-managed org")
	orgID := org.GetMetadata().GetId()
	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := c.OrganizationCommand.Delete(cleanCtx, &organizationv1.OrganizationId{Value: orgID}); err != nil {
			t.Logf("warning: failed to clean up org %s: %v", orgID, err)
		}
	})
	return orgID
}
