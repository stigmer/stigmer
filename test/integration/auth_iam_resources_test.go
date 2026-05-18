//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	identityaccountv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/identityaccount/v1"
	identityproviderv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/identityprovider/v1"
	iampolicyv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/iampolicy/v1"
	invitationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/invitation/v1"
	iamv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/v1"
	oauthappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func requireIAMClients(t *testing.T) *harness.Clients {
	t.Helper()
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	return harness.NewClients(grpcConn)
}

// --- IdentityAccount ---

func TestIdentityAccount_WhoAmI(t *testing.T) {
	clients := requireIAMClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	account, err := clients.IdentityAccountQuery.WhoAmI(ctx, &emptypb.Empty{})
	require.NoError(t, err, "whoAmI should succeed for the test identity")

	assert.NotEmpty(t, account.GetMetadata().GetId(), "whoAmI should return an identity with an ID")
	assert.NotEmpty(t, account.GetSpec().GetIdpId(), "whoAmI should return the identity's IDP ID")

	t.Logf("whoAmI: id=%s, idp_id=%s, email=%s",
		account.GetMetadata().GetId(),
		account.GetSpec().GetIdpId(),
		account.GetSpec().GetEmail())
}

func TestIdentityAccount_ProvisionMyAccount_Idempotent(t *testing.T) {
	clients := requireIAMClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// provisionMyAccount is idempotent — calling it again should succeed.
	account, err := clients.IdentityAccountCommand.ProvisionMyAccount(ctx, &emptypb.Empty{})
	require.NoError(t, err, "provisionMyAccount should succeed (idempotent)")
	assert.NotEmpty(t, account.GetMetadata().GetId())

	// Call again to verify idempotency
	account2, err := clients.IdentityAccountCommand.ProvisionMyAccount(ctx, &emptypb.Empty{})
	require.NoError(t, err, "provisionMyAccount should be idempotent")
	assert.Equal(t, account.GetMetadata().GetId(), account2.GetMetadata().GetId(),
		"repeated provisionMyAccount should return the same identity account")
}

// --- IdentityProvider ---

func TestIdentityProvider_CRUD_Lifecycle(t *testing.T) {
	clients := requireIAMClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	jwksServer := harness.StartMockJWKSServer(t, "https://test-idp.example.com/")

	idp := harness.CreateIdentityProvider(t, ctx, clients,
		"Test IdP CRUD",
		jwksServer.JWKSURL,
		[]string{jwksServer.Issuer},
		"stigmer-test-audience",
	)

	assert.NotEmpty(t, idp.GetMetadata().GetId())
	assert.Equal(t, "Test IdP CRUD", idp.GetSpec().GetDisplayName())
	assert.Equal(t, "stigmer-test-audience", idp.GetSpec().GetExpectedAudience())

	// Update
	idp.Spec.DisplayName = "Updated IdP Name"
	updated, err := clients.IdentityProviderCommand.Update(ctx, idp)
	require.NoError(t, err, "update identity provider should succeed")
	assert.Equal(t, "Updated IdP Name", updated.GetSpec().GetDisplayName())

	// Get
	got, err := clients.IdentityProviderQuery.Get(ctx, &apiresource.ApiResourceId{
		Value: idp.GetMetadata().GetId(),
	})
	require.NoError(t, err, "get identity provider should succeed")
	assert.Equal(t, "Updated IdP Name", got.GetSpec().GetDisplayName())
}

func TestIdentityProvider_ListByOrg(t *testing.T) {
	clients := requireIAMClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	jwksServer := harness.StartMockJWKSServer(t, "https://list-idp.example.com/")

	harness.CreateIdentityProvider(t, ctx, clients,
		"Test IdP List",
		jwksServer.JWKSURL,
		[]string{jwksServer.Issuer},
		"stigmer-list-audience",
	)

	list, err := clients.IdentityProviderQuery.ListByOrg(ctx,
		&identityproviderv1.ListIdentityProvidersByOrgInput{Org: harness.TestOrg})
	require.NoError(t, err)
	assert.GreaterOrEqual(t, len(list.GetEntries()), 1,
		"should list at least the identity provider we created")
}

// --- Federated Account Lifecycle ---

func TestIdentityAccount_CreateFederated_Lifecycle(t *testing.T) {
	clients := requireIAMClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	jwksServer := harness.StartMockJWKSServer(t, "https://federated-lifecycle.example.com/")

	idp := harness.CreateIdentityProvider(t, ctx, clients,
		"Federated Lifecycle IdP",
		jwksServer.JWKSURL,
		[]string{jwksServer.Issuer},
		"stigmer-federated-audience",
	)

	idpRef := &apiresource.ApiResourceReference{
		Org:  harness.TestOrg,
		Slug: idp.GetMetadata().GetSlug(),
	}

	// Create a federated account
	created, err := clients.IdentityAccountCommand.CreateFederatedAccount(ctx,
		&identityaccountv1.CreateFederatedAccountInput{
			Org:                  harness.TestOrg,
			IdentityProviderRef:  idpRef,
			ExternalSub:          "ext-sub-12345",
			Email:                "federated@test.stigmer.ai",
			FirstName:            "Federated",
			LastName:             "User",
		})
	require.NoError(t, err, "createFederatedAccount should succeed")
	assert.NotEmpty(t, created.GetMetadata().GetId())
	assert.Equal(t, "federated@test.stigmer.ai", created.GetSpec().GetEmail())

	t.Logf("created federated account: id=%s", created.GetMetadata().GetId())

	// Update the federated account profile
	updated, err := clients.IdentityAccountCommand.UpdateFederatedAccount(ctx,
		&identityaccountv1.UpdateFederatedAccountInput{
			Org:                  harness.TestOrg,
			IdentityProviderRef:  idpRef,
			ExternalSub:          "ext-sub-12345",
			Email:                "updated-federated@test.stigmer.ai",
			FirstName:            "Updated",
			LastName:             "FedUser",
		})
	require.NoError(t, err, "updateFederatedAccount should succeed")
	assert.Equal(t, "updated-federated@test.stigmer.ai", updated.GetSpec().GetEmail())

	// Deprovision (revoke only, don't delete)
	deprovisioned, err := clients.IdentityAccountCommand.DeprovisionFederatedAccount(ctx,
		&identityaccountv1.DeprovisionFederatedAccountInput{
			Org:                  harness.TestOrg,
			IdentityProviderRef:  idpRef,
			ExternalSub:          "ext-sub-12345",
			DeleteAccount:        false,
		})
	require.NoError(t, err, "deprovisionFederatedAccount (revoke-only) should succeed")
	assert.Equal(t, created.GetMetadata().GetId(), deprovisioned.GetMetadata().GetId())
}

// --- IamPolicy ---

func TestIamPolicy_GrantAndRevoke(t *testing.T) {
	if testHarness == nil || !testHarness.FGAEnabled() {
		t.Skip("FGA not enabled — skipping IAM policy test")
	}

	clients := requireIAMClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Get the test identity's account ID
	account, err := clients.IdentityAccountQuery.WhoAmI(ctx, &emptypb.Empty{})
	require.NoError(t, err)
	accountID := account.GetMetadata().GetId()

	policySpec := &iampolicyv1.IamPolicySpec{
		Principal: &iampolicyv1.ApiResourceRef{
			Kind: "identity_account",
			Id:   accountID,
		},
		Resource: &iampolicyv1.ApiResourceRef{
			Kind: "organization",
			Id:   harness.TestOrg,
		},
		Relation: "admin",
	}

	created, err := clients.IamPolicyCommand.Create(ctx, policySpec)
	require.NoError(t, err, "create IAM policy should succeed")
	assert.NotEmpty(t, created.GetMetadata().GetId())

	t.Logf("created IAM policy: id=%s", created.GetMetadata().GetId())

	// Delete the policy (revoke) — uses the same IamPolicySpec as input
	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := clients.IamPolicyCommand.Delete(cleanCtx, policySpec)
		if err != nil {
			t.Logf("warning: failed to clean up IAM policy: %v", err)
		}
	})
}

// --- Invitation ---

func TestInvitation_CRUD_Lifecycle(t *testing.T) {
	clients := requireIAMClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	expiresAt := timestamppb.New(time.Now().Add(24 * time.Hour))

	invitation := &invitationv1.Invitation{
		ApiVersion: "iam.stigmer.ai/v1",
		Kind:       "Invitation",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-invite",
			Org:  harness.TestOrg,
		},
		Spec: &invitationv1.InvitationSpec{
			Role:           iamv1.IamRole_viewer,
			MaxRedemptions: 5,
			ExpiresAt:      expiresAt,
			Label:          "integration test invitation",
		},
	}

	created, err := clients.InvitationCommand.Create(ctx, invitation)
	require.NoError(t, err, "create invitation should succeed")
	assert.NotEmpty(t, created.GetMetadata().GetId())
	assert.Equal(t, "integration test invitation", created.GetSpec().GetLabel())

	t.Logf("created invitation: id=%s", created.GetMetadata().GetId())

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := clients.InvitationCommand.Revoke(cleanCtx, &invitationv1.InvitationId{
			Value: created.GetMetadata().GetId(),
		})
		if err != nil {
			t.Logf("warning: failed to revoke invitation: %v", err)
		}
	})
}

// --- OAuthApp ---

func TestOAuthApp_CRUD_Lifecycle(t *testing.T) {
	clients := requireIAMClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	app := &oauthappv1.OAuthApp{
		ApiVersion: "iam.stigmer.ai/v1",
		Kind:       "OAuthApp",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-oauth-app",
			Org:  harness.TestOrg,
		},
		Spec: &oauthappv1.OAuthAppSpec{
			Provider:         "TestVendor",
			ClientId:         "test-vendor-client-id",
			ClientSecret:     "test-vendor-client-secret",
			AuthorizationUrl: "https://vendor.example.com/oauth/authorize",
			TokenUrl:         "https://vendor.example.com/oauth/token",
			Scopes:           []string{"read", "write"},
		},
	}

	created, err := clients.OAuthAppCommand.Create(ctx, app)
	require.NoError(t, err, "create oauth app should succeed")
	assert.NotEmpty(t, created.GetMetadata().GetId())
	assert.Equal(t, "TestVendor", created.GetSpec().GetProvider())

	t.Logf("created oauth app: id=%s", created.GetMetadata().GetId())

	// Update
	created.Spec.Provider = "UpdatedVendor"
	updated, err := clients.OAuthAppCommand.Update(ctx, created)
	require.NoError(t, err, "update oauth app should succeed")
	assert.Equal(t, "UpdatedVendor", updated.GetSpec().GetProvider())

	// Delete
	deleted, err := clients.OAuthAppCommand.Delete(ctx, &apiresource.ApiResourceDeleteInput{
		ResourceId: created.GetMetadata().GetId(),
	})
	require.NoError(t, err, "delete oauth app should succeed")
	assert.Equal(t, created.GetMetadata().GetId(), deleted.GetMetadata().GetId())
}
