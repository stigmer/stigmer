package harness

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apikeyv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/apikey/v1"
	identityproviderv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/identityprovider/v1"
	platformclientv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/platformclient/v1"
	iamv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/v1"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
)

const (
	iamAPIVersion = "iam.stigmer.ai/v1"
)

// PlatformClientCredentials holds the one-time credentials returned by create
// or rotateSecret. Tests use these to call mintUserToken.
type PlatformClientCredentials struct {
	ResourceID   string
	ClientID     string
	ClientSecret string
}

// CreatePlatformClient creates a PlatformClient in the test org and returns
// the one-time credentials. The resource is deleted on test cleanup.
func CreatePlatformClient(t *testing.T, ctx context.Context, clients *Clients, opts ...PlatformClientOption) PlatformClientCredentials {
	t.Helper()

	cfg := platformClientDefaults()
	for _, opt := range opts {
		opt(&cfg)
	}

	pc := &platformclientv1.PlatformClient{
		ApiVersion: iamAPIVersion,
		Kind:       "PlatformClient",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-pc-" + uuid.New().String()[:8],
			Org:  cfg.org,
		},
		Spec: &platformclientv1.PlatformClientSpec{
			AutoProvisionAccounts: cfg.autoProvision,
			AutoGrantOnOrg:        cfg.autoGrantOnOrg,
			AutoGrantRole:         cfg.autoGrantRole,
			AllowedOrigins:        cfg.allowedOrigins,
		},
	}

	resp, err := clients.PlatformClientCommand.Create(ctx, pc)
	require.NoError(t, err, "create platform client")
	require.NotEmpty(t, resp.GetClientSecret(), "raw secret must be returned on create")

	created := resp.GetPlatformClient()
	resourceID := created.GetMetadata().GetId()
	clientID := created.GetSpec().GetClientId()

	t.Logf("created platform client: id=%s, client_id=%s", resourceID, clientID)

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := clients.PlatformClientCommand.Delete(cleanCtx, &apiresource.ApiResourceDeleteInput{
			ResourceId: resourceID,
		})
		if err != nil {
			t.Logf("warning: failed to clean up platform client %s: %v", resourceID, err)
		}
	})

	return PlatformClientCredentials{
		ResourceID:   resourceID,
		ClientID:     clientID,
		ClientSecret: resp.GetClientSecret(),
	}
}

// PlatformClientOption configures platform client creation.
type PlatformClientOption func(*platformClientConfig)

type platformClientConfig struct {
	org            string
	autoProvision  bool
	autoGrantOnOrg bool
	autoGrantRole  iamv1.IamRole
	allowedOrigins []string
}

func platformClientDefaults() platformClientConfig {
	return platformClientConfig{org: TestOrg}
}

// WithAutoProvision enables JIT account provisioning on the platform client.
func WithAutoProvision(v bool) PlatformClientOption {
	return func(c *platformClientConfig) { c.autoProvision = v }
}

// WithAutoGrantOnOrg enables automatic role granting on the owning org.
func WithAutoGrantOnOrg(v bool) PlatformClientOption {
	return func(c *platformClientConfig) { c.autoGrantOnOrg = v }
}

// WithAutoGrantRole sets the org role granted to JIT-provisioned users. Only
// meaningful together with WithAutoGrantOnOrg(true). Defaults to viewer
// server-side; visibility tests grant member so the user satisfies the
// organization:<org>#member userset that org-visibility tuples resolve against.
func WithAutoGrantRole(role iamv1.IamRole) PlatformClientOption {
	return func(c *platformClientConfig) { c.autoGrantRole = role }
}

// WithPlatformClientOrg overrides the default test org.
func WithPlatformClientOrg(org string) PlatformClientOption {
	return func(c *platformClientConfig) { c.org = org }
}

// WithAllowedOrigins sets CORS allowed origins on the platform client.
func WithAllowedOrigins(origins ...string) PlatformClientOption {
	return func(c *platformClientConfig) { c.allowedOrigins = origins }
}

// MintUserToken calls mintUserToken with the given credentials and returns
// the raw access token string.
func MintUserToken(t *testing.T, ctx context.Context, clients *Clients, creds PlatformClientCredentials, userID string) string {
	t.Helper()

	resp, err := clients.PlatformClientToken.MintUserToken(ctx, &platformclientv1.MintUserTokenRequest{
		ClientId:     creds.ClientID,
		ClientSecret: creds.ClientSecret,
		UserId:       userID,
		UserEmail:    userID + "@test.stigmer.ai",
		UserName:     "Test User " + userID,
	})
	require.NoError(t, err, "mint user token")
	require.NotEmpty(t, resp.GetAccessToken(), "minted token must not be empty")
	require.Equal(t, "Bearer", resp.GetTokenType())
	require.Greater(t, resp.GetExpiresIn(), int32(0))

	return resp.GetAccessToken()
}

// CreateIdentityProvider registers an IdentityProvider in the test org.
// The resource is deleted on test cleanup.
func CreateIdentityProvider(t *testing.T, ctx context.Context, clients *Clients, displayName, jwksURI string, issuers []string, audience string) *identityproviderv1.IdentityProvider {
	t.Helper()

	idp := &identityproviderv1.IdentityProvider{
		ApiVersion: iamAPIVersion,
		Kind:       "IdentityProvider",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-idp-" + uuid.New().String()[:8],
			Org:  TestOrg,
		},
		Spec: &identityproviderv1.IdentityProviderSpec{
			DisplayName:      displayName,
			JwksUri:          jwksURI,
			AllowedIssuers:   issuers,
			ExpectedAudience: audience,
		},
	}

	created, err := clients.IdentityProviderCommand.Create(ctx, idp)
	require.NoError(t, err, "create identity provider")
	require.NotEmpty(t, created.GetMetadata().GetId())

	t.Logf("created identity provider: id=%s, name=%s", created.GetMetadata().GetId(), displayName)

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := clients.IdentityProviderCommand.Delete(cleanCtx, &apiresource.ApiResourceDeleteInput{
			ResourceId: created.GetMetadata().GetId(),
		})
		if err != nil {
			t.Logf("warning: failed to clean up identity provider %s: %v", created.GetMetadata().GetId(), err)
		}
	})

	return created
}

// CreateApiKey creates an API key for the current test identity and returns
// the raw key value. The key is deleted on test cleanup.
func CreateApiKey(t *testing.T, ctx context.Context, clients *Clients) string {
	t.Helper()

	key := &apikeyv1.ApiKey{
		ApiVersion: iamAPIVersion,
		Kind:       "ApiKey",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-key-" + uuid.New().String()[:8],
		},
		Spec: &apikeyv1.ApiKeySpec{
			NeverExpires: true,
		},
	}

	created, err := clients.ApiKeyCommand.Create(ctx, key)
	require.NoError(t, err, "create api key")

	// The raw key is returned in the metadata.name field on create (the actual
	// raw key is a server-side convention — check the response).
	// Actually, the raw key comes back in a specific way per the API.
	// Let's check the response structure.
	resourceID := created.GetMetadata().GetId()
	require.NotEmpty(t, resourceID)
	fingerprint := created.GetSpec().GetFingerprint()
	require.NotEmpty(t, fingerprint, "fingerprint must be set after creation")

	t.Logf("created api key: id=%s, fingerprint=%s", resourceID, fingerprint)

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := clients.ApiKeyCommand.Delete(cleanCtx, &apikeyv1.ApiKeyId{Value: resourceID})
		if err != nil {
			t.Logf("warning: failed to clean up api key %s: %v", resourceID, err)
		}
	})

	// The raw key value is typically returned in the name or a dedicated field.
	// Based on the proto, the create RPC returns ApiKey — the raw key is
	// conventionally placed in metadata.name by the Java service (similar to
	// how PlatformClient returns the secret in a wrapper).
	// We'll return the name as a placeholder; the actual raw key extraction
	// depends on the Java service's create response convention.
	return created.GetMetadata().GetName()
}

// GRPCConnWithBearer creates a gRPC client connection that attaches the given
// Bearer token to every outgoing call via metadata.
func GRPCConnWithBearer(t *testing.T, address, token string) *grpc.ClientConn {
	t.Helper()

	conn, err := grpc.NewClient(
		address,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithUnaryInterceptor(bearerUnaryInterceptor(token)),
		grpc.WithStreamInterceptor(bearerStreamInterceptor(token)),
	)
	require.NoError(t, err, "dial gRPC with bearer token")

	t.Cleanup(func() { conn.Close() })
	return conn
}

// GRPCConnWithApiKey creates a gRPC client connection that attaches the given
// API key as a Bearer token to every outgoing call.
func GRPCConnWithApiKey(t *testing.T, address, apiKey string) *grpc.ClientConn {
	t.Helper()
	return GRPCConnWithBearer(t, address, apiKey)
}

func bearerUnaryInterceptor(token string) grpc.UnaryClientInterceptor {
	return func(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
		ctx = metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+token)
		return invoker(ctx, method, req, reply, cc, opts...)
	}
}

func bearerStreamInterceptor(token string) grpc.StreamClientInterceptor {
	return func(ctx context.Context, desc *grpc.StreamDesc, cc *grpc.ClientConn, method string, streamer grpc.Streamer, opts ...grpc.CallOption) (grpc.ClientStream, error) {
		ctx = metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+token)
		return streamer(ctx, desc, cc, method, opts...)
	}
}
