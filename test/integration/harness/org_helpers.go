package harness

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	iampolicyv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/iampolicy/v1"
	identityproviderv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/identityprovider/v1"
	iamv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/v1"
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
)

// StandaloneOrg is a provisioned peer tenant: a self-managed organization
// with no linkage to TestOrg whatsoever — no shared IdentityProvider, no
// managed_org edge. Its actors hold roles ONLY in this org. This is the
// fixture for cross-org boundary tests (external-org AgentShares, decision
// 013), where TestOrg plays the resource-owning org and this org plays the
// counterpart tenant.
type StandaloneOrg struct {
	// OrgID is the organization's id (organizations use slug as id).
	OrgID string
	// Admin holds the admin role on this org — and, per the T10 create bar,
	// organization.can_create_agent_share. It holds nothing in TestOrg.
	Admin *Actor
	// Member holds the member role on this org: enough to satisfy the
	// organization#member userset, NOT enough to create agent shares.
	Member *Actor
}

// CreateStandaloneOrg provisions a peer tenant end-to-end through the real
// RPC pipeline: a self-managed organization (the create pipeline makes the
// synthetic owner its FGA owner, authorizing all subsequent fixture steps),
// a funded billing account (guest chat is gated on the org's balance
// synchronously, so an unfunded org would fail closed for the wrong
// reason), and JIT-provisioned admin + member actors whose roles are scoped
// to this org alone. Everything goes through production RPCs — no direct
// FGA or database writes.
func CreateStandaloneOrg(t *testing.T, ctx context.Context, ownerConn grpc.ClientConnInterface, grpcAddr string) *StandaloneOrg {
	t.Helper()
	owner := NewClients(ownerConn)

	slug := "peer-org-" + uuid.New().String()[:8]
	org, err := owner.OrganizationCommand.Create(ctx, &organizationv1.Organization{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Organization",
		Metadata:   &apiresource.ApiResourceMetadata{Name: slug},
		Spec:       &organizationv1.OrganizationSpec{},
	})
	require.NoError(t, err, "create standalone peer org")
	orgID := org.GetMetadata().GetId()
	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := owner.OrganizationCommand.Delete(cleanCtx, &organizationv1.OrganizationId{Value: orgID}); err != nil {
			t.Logf("warning: failed to clean up standalone org %s: %v", orgID, err)
		}
	})

	// The org id doubles as the idempotency-key discriminator: per-run
	// unique, so a gotestsum root-test rerun re-provisions a fresh org and
	// its credit seed is never deduplicated against the previous attempt.
	require.NoError(t,
		ProvisionTestBillingAccount(ctx, ownerConn, orgID, "standalone-org-seed-"+orgID),
		"fund the standalone org's billing account")

	// Roles are granted through the real IamPolicy pipeline as the org's
	// owner rather than the PlatformClient auto-grant: the auto-grant runs
	// as the service machine account, which holds can_grant_access only on
	// TestOrg (seeded) — in a fresh org it would fail and leave the actor
	// role-less. The explicit grant is CreatePlatformManagedOrg's
	// established pattern.
	admin := MintActorInOrg(t, ctx, ownerConn, grpcAddr, orgID, "peer-admin",
		false, iamv1.IamRole_iam_role_unspecified)
	grantOrgRole(t, ctx, owner, orgID, admin, "admin")

	member := MintActorInOrg(t, ctx, ownerConn, grpcAddr, orgID, "peer-member",
		false, iamv1.IamRole_iam_role_unspecified)
	grantOrgRole(t, ctx, owner, orgID, member, "member")

	return &StandaloneOrg{
		OrgID:  orgID,
		Admin:  admin,
		Member: member,
	}
}

// grantOrgRole grants the actor a role on the org through the real
// IamPolicy pipeline (revoked on cleanup). granter must hold
// can_grant_access on the org — the synthetic owner does, as its creator.
func grantOrgRole(t *testing.T, ctx context.Context, granter *Clients, orgID string, actor *Actor, relation string) {
	t.Helper()
	GrantOrgRole(t, ctx, granter, orgID, actor.AccountID, actor.Name, relation)
}

// GrantOrgRole grants an identity account a role on the org through the real
// IamPolicy pipeline — the storage-neutral front door: the create handler
// persists the policy mirror via the active persistence adapter AND writes the
// FGA tuple, exactly as production grants do. Revoked on cleanup. granter must
// hold can_grant_access on the org (the synthetic owner does, as its creator);
// label names the grantee in failure output.
func GrantOrgRole(t *testing.T, ctx context.Context, granter *Clients, orgID, accountID, label, relation string) {
	t.Helper()
	policy := &iampolicyv1.IamPolicySpec{
		Principal: &iampolicyv1.ApiResourceRef{Kind: "identity_account", Id: accountID},
		Resource:  &iampolicyv1.ApiResourceRef{Kind: "organization", Id: orgID},
		Relation:  relation,
	}
	_, err := granter.IamPolicyCommand.Create(ctx, policy)
	require.NoError(t, err, "grant %s role on org %s to %s", relation, orgID, label)
	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := granter.IamPolicyCommand.Delete(cleanCtx, policy); err != nil {
			t.Logf("warning: failed to revoke %s role on org %s: %v", relation, orgID, err)
		}
	})
}

// PlatformManagedOrg is a provisioned cross-tenant fixture for platform
// visibility E2E: a child organization linked to TestOrg's IdentityProvider via
// the managed_org FGA edge, plus a member of that child org.
type PlatformManagedOrg struct {
	// OrgID is the child organization's id (organizations use slug as id).
	OrgID string
	// IdentityProvider is the IdP that TestOrg operates. The child org is one of
	// its managed orgs, and platform-visible blueprints fan out through it.
	IdentityProvider *identityproviderv1.IdentityProvider
	// Member is a member of the child org — a platform_user of the IdP, and
	// therefore entitled to every platform-visible blueprint TestOrg shares.
	Member *Actor
}

// CreatePlatformManagedOrg provisions a platform-managed tenant end-to-end
// through the real RPC pipeline:
//
//  1. registers an IdentityProvider in TestOrg,
//  2. creates a platform_managed child org referencing that IdP (the create
//     pipeline writes the identity_provider#managed_org tuple),
//  3. JIT-provisions a user in the child org via a PlatformClient, and
//  4. grants that user the member role on the child org so it resolves as a
//     platform_user (member from managed_org).
//
// Everything is established through production RPCs — no direct FGA writes. The
// synthetic owner owns TestOrg (hence its IdP) and becomes owner of the new
// child org, so it is authorized for every step. The managed_org edge and the
// platform_viewer chain — the actual feature under test — are exercised by the
// real service.
func CreatePlatformManagedOrg(t *testing.T, ctx context.Context, ownerConn grpc.ClientConnInterface, grpcAddr string) *PlatformManagedOrg {
	t.Helper()
	owner := NewClients(ownerConn)

	// 1. IdP in TestOrg. JWKS reachability validation is disabled in test mode,
	//    but a mock JWKS server keeps the IdP record production-faithful.
	jwks := StartMockJWKSServer(t, "https://platform-idp-"+uuid.New().String()[:8]+".example.com/")
	idp := CreateIdentityProvider(t, ctx, owner,
		"Platform IdP", jwks.JWKSURL, []string{jwks.Issuer}, "stigmer-platform-audience")

	// 2. platform_managed child org referencing the IdP.
	childSlug := "child-org-" + uuid.New().String()[:8]
	childOrg, err := owner.OrganizationCommand.Create(ctx, &organizationv1.Organization{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Organization",
		Metadata:   &apiresource.ApiResourceMetadata{Name: childSlug},
		Spec: &organizationv1.OrganizationSpec{
			ManagementMode: organizationv1.ManagementMode_platform_managed,
			IdentityProviderRef: &apiresource.ApiResourceReference{
				Org:  TestOrg,
				Slug: idp.GetMetadata().GetSlug(),
			},
			ExternalOrgId: "ext-" + childSlug,
		},
	})
	require.NoError(t, err, "create platform-managed child org")
	childOrgID := childOrg.GetMetadata().GetId()
	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := owner.OrganizationCommand.Delete(cleanCtx, &organizationv1.OrganizationId{Value: childOrgID}); err != nil {
			t.Logf("warning: failed to clean up child org %s: %v", childOrgID, err)
		}
	})

	// 3. JIT-provision a user in the child org via a PlatformClient scoped there.
	creds := CreatePlatformClient(t, ctx, owner, WithPlatformClientOrg(childOrgID), WithAutoProvision(true))
	userID := "child-user-" + uuid.New().String()[:8]
	token := MintUserToken(t, ctx, owner, creds, userID)
	accountID := accountIDFromToken(t, token)

	// 4. Grant member on the child org through the real IamPolicy pipeline so the
	//    user satisfies organization:<child>#member, the userset platform_user
	//    resolves through (member from managed_org).
	memberPolicy := &iampolicyv1.IamPolicySpec{
		Principal: &iampolicyv1.ApiResourceRef{Kind: "identity_account", Id: accountID},
		Resource:  &iampolicyv1.ApiResourceRef{Kind: "organization", Id: childOrgID},
		Relation:  "member",
	}
	_, err = owner.IamPolicyCommand.Create(ctx, memberPolicy)
	require.NoError(t, err, "grant member role on child org")
	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := owner.IamPolicyCommand.Delete(cleanCtx, memberPolicy); err != nil {
			t.Logf("warning: failed to revoke child-org membership: %v", err)
		}
	})

	conn := GRPCConnWithBearer(t, grpcAddr, token)
	return &PlatformManagedOrg{
		OrgID:            childOrgID,
		IdentityProvider: idp,
		Member: &Actor{
			Name:      "child-org-member",
			AccountID: accountID,
			Clients:   NewClients(conn),
		},
	}
}
