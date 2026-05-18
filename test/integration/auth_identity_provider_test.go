//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	identityaccountv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/identityaccount/v1"
	identityproviderv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/identityprovider/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Resource CRUD (works with current STIGMER_SECURITY_MODE=test) ---

func TestIdentityProvider_Create_ReturnsResource(t *testing.T) {
	clients := requireIAMClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	jwksServer := harness.StartMockJWKSServer(t, "https://test-create-idp.example.com")

	idp := harness.CreateIdentityProvider(t, ctx, clients,
		"Create Test IdP",
		jwksServer.JWKSURL,
		[]string{jwksServer.Issuer},
		"stigmer-create-test",
	)

	assert.NotEmpty(t, idp.GetMetadata().GetId())
	assert.NotEmpty(t, idp.GetMetadata().GetSlug())
	assert.Equal(t, "Create Test IdP", idp.GetSpec().GetDisplayName())
	assert.Equal(t, jwksServer.JWKSURL, idp.GetSpec().GetJwksUri())
	assert.Equal(t, []string{jwksServer.Issuer}, idp.GetSpec().GetAllowedIssuers())
	assert.Equal(t, "stigmer-create-test", idp.GetSpec().GetExpectedAudience())
}

func TestIdentityProvider_Update_ModifiesDisplayName(t *testing.T) {
	clients := requireIAMClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	jwksServer := harness.StartMockJWKSServer(t, "https://test-update-idp.example.com/")

	idp := harness.CreateIdentityProvider(t, ctx, clients,
		"Original Name",
		jwksServer.JWKSURL,
		[]string{jwksServer.Issuer},
		"stigmer-update-test",
	)

	idp.Spec.DisplayName = "Updated Display Name"
	updated, err := clients.IdentityProviderCommand.Update(ctx, idp)
	require.NoError(t, err)
	assert.Equal(t, "Updated Display Name", updated.GetSpec().GetDisplayName())
}

func TestIdentityProvider_Delete_RemovesResource(t *testing.T) {
	clients := requireIAMClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	jwksServer := harness.StartMockJWKSServer(t, "https://test-delete-idp.example.com/")

	idp := &identityproviderv1.IdentityProvider{
		ApiVersion: "iam.stigmer.ai/v1",
		Kind:       "IdentityProvider",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "delete-test-idp",
			Org:  harness.TestOrg,
		},
		Spec: &identityproviderv1.IdentityProviderSpec{
			DisplayName:      "Delete Test IdP",
			JwksUri:          jwksServer.JWKSURL,
			AllowedIssuers:   []string{jwksServer.Issuer},
			ExpectedAudience: "stigmer-delete-test",
		},
	}

	created, err := clients.IdentityProviderCommand.Create(ctx, idp)
	require.NoError(t, err)

	_, err = clients.IdentityProviderCommand.Delete(ctx, &apiresource.ApiResourceDeleteInput{
		ResourceId: created.GetMetadata().GetId(),
	})
	require.NoError(t, err, "delete should succeed")

	// Verify it's gone
	_, err = clients.IdentityProviderQuery.Get(ctx, &apiresource.ApiResourceId{
		Value: created.GetMetadata().GetId(),
	})
	assert.Error(t, err, "get after delete should fail")
}

func TestIdentityProvider_Apply_CreateOrUpdate(t *testing.T) {
	clients := requireIAMClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	jwksServer := harness.StartMockJWKSServer(t, "https://test-apply-idp.example.com/")

	idp := &identityproviderv1.IdentityProvider{
		ApiVersion: "iam.stigmer.ai/v1",
		Kind:       "IdentityProvider",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "apply-test-idp",
			Org:  harness.TestOrg,
		},
		Spec: &identityproviderv1.IdentityProviderSpec{
			DisplayName:      "Apply Test IdP",
			JwksUri:          jwksServer.JWKSURL,
			AllowedIssuers:   []string{jwksServer.Issuer},
			ExpectedAudience: "stigmer-apply-test",
		},
	}

	// First apply — should create
	applied, err := clients.IdentityProviderCommand.Apply(ctx, idp)
	require.NoError(t, err, "first apply should create the resource")
	assert.NotEmpty(t, applied.GetMetadata().GetId())

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = clients.IdentityProviderCommand.Delete(cleanCtx, &apiresource.ApiResourceDeleteInput{
			ResourceId: applied.GetMetadata().GetId(),
		})
	})

	// Second apply with updated display name — should update
	applied.Spec.DisplayName = "Applied Updated Name"
	reapplied, err := clients.IdentityProviderCommand.Apply(ctx, applied)
	require.NoError(t, err, "second apply should update the resource")
	assert.Equal(t, "Applied Updated Name", reapplied.GetSpec().GetDisplayName())
	assert.Equal(t, applied.GetMetadata().GetId(), reapplied.GetMetadata().GetId(),
		"apply should preserve the resource ID")
}

// --- JIT Provisioning Configuration ---

func TestIdentityProvider_JITConfig_AutoProvision(t *testing.T) {
	clients := requireIAMClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	jwksServer := harness.StartMockJWKSServer(t, "https://test-jit-idp.example.com/")

	idp := &identityproviderv1.IdentityProvider{
		ApiVersion: "iam.stigmer.ai/v1",
		Kind:       "IdentityProvider",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "jit-config-test-idp",
			Org:  harness.TestOrg,
		},
		Spec: &identityproviderv1.IdentityProviderSpec{
			DisplayName:           "JIT Config Test",
			JwksUri:               jwksServer.JWKSURL,
			AllowedIssuers:        []string{jwksServer.Issuer},
			ExpectedAudience:      "stigmer-jit-test",
			AutoProvisionAccounts: true,
			AutoGrantOnOrg:        true,
		},
	}

	created, err := clients.IdentityProviderCommand.Create(ctx, idp)
	require.NoError(t, err)

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = clients.IdentityProviderCommand.Delete(cleanCtx, &apiresource.ApiResourceDeleteInput{
			ResourceId: created.GetMetadata().GetId(),
		})
	})

	assert.True(t, created.GetSpec().GetAutoProvisionAccounts(),
		"auto_provision_accounts should be persisted")
	assert.True(t, created.GetSpec().GetAutoGrantOnOrg(),
		"auto_grant_on_org should be persisted")
}

// --- Federated Account via IdP ---

func TestIdentityProvider_FederatedAccount_ManualProvision(t *testing.T) {
	clients := requireIAMClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	jwksServer := harness.StartMockJWKSServer(t, "https://test-fed-idp.example.com/")

	idp := harness.CreateIdentityProvider(t, ctx, clients,
		"Manual Provision IdP",
		jwksServer.JWKSURL,
		[]string{jwksServer.Issuer},
		"stigmer-fed-test",
	)

	idpRef := &apiresource.ApiResourceReference{
		Org:  harness.TestOrg,
		Slug: idp.GetMetadata().GetSlug(),
	}

	// Manually provision a federated account
	account, err := clients.IdentityAccountCommand.CreateFederatedAccount(ctx,
		&identityaccountv1.CreateFederatedAccountInput{
			Org:                 harness.TestOrg,
			IdentityProviderRef: idpRef,
			ExternalSub:         "manual-sub-001",
			Email:               "manual@test-fed.example.com",
			FirstName:           "Manual",
			LastName:            "FedUser",
		})
	require.NoError(t, err)
	assert.NotEmpty(t, account.GetMetadata().GetId())
	assert.Equal(t, "manual@test-fed.example.com", account.GetSpec().GetEmail())

	// Look up by external sub
	found, err := clients.IdentityAccountQuery.GetByExternalSub(ctx,
		&identityaccountv1.ExternalSubLookup{
			Org:                 harness.TestOrg,
			IdentityProviderRef: idpRef,
			ExternalSub:         "manual-sub-001",
		})
	require.NoError(t, err)
	assert.Equal(t, account.GetMetadata().GetId(), found.GetMetadata().GetId(),
		"lookup by external sub should find the same account")
}

// --- JWT Validation Tests (require service config change) ---
//
// The tests below document the expected behavior for JWT validation when
// the Java service runs with real JWKS validation instead of
// STIGMER_SECURITY_MODE=test.
//
// They are currently placeholders that verify the mock JWKS infrastructure
// works correctly. Full end-to-end JWT validation tests require either:
//   - Option B: Running the service with a test JWKS endpoint, or
//   - A dedicated auth-mode test configuration
//
// See the plan's "Key Design Decision Needed" section.

func TestMockJWKS_SignAndVerifyLocally(t *testing.T) {
	jwksServer := harness.StartMockJWKSServer(t, "https://mock-verify.example.com/")

	token, err := jwksServer.SignJWT("test-subject", "test-audience", nil)
	require.NoError(t, err)
	assert.NotEmpty(t, token)

	// Verify the token has 3 parts (header.payload.signature)
	parts := len(splitJWT(token))
	assert.Equal(t, 3, parts, "signed JWT should have 3 segments")

	// Sign an expired token
	expiredToken, err := jwksServer.SignExpiredJWT("test-subject", "test-audience")
	require.NoError(t, err)
	assert.NotEmpty(t, expiredToken)

	// Sign with extra claims
	tokenWithClaims, err := jwksServer.SignJWT("test-subject", "test-audience", map[string]any{
		"org_id": "tenant-123",
		"email":  "user@example.com",
	})
	require.NoError(t, err)
	assert.NotEmpty(t, tokenWithClaims)
}

func splitJWT(token string) []string {
	var parts []string
	start := 0
	for i := 0; i < len(token); i++ {
		if token[i] == '.' {
			parts = append(parts, token[start:i])
			start = i + 1
		}
	}
	parts = append(parts, token[start:])
	return parts
}
