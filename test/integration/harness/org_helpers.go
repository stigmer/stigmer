package harness

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	iampolicyv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/iampolicy/v1"
	identityproviderv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/identityprovider/v1"
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
)

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
