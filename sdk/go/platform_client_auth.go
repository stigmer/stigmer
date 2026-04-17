package stigmer

import (
	"context"
	"fmt"
	"time"

	"github.com/stigmer/stigmer/sdk/go/internal/gen"
	"github.com/stigmer/stigmer/sdk/go/internal/transport"
	platformclientv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/iam/platformclient/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
)

// PlatformClientAuth mints Stigmer-signed user JWTs from a platform
// builder's backend. It is NOT a general-purpose Stigmer client — use
// [NewClient] with [WithAPIKey] for resource management.
//
// The returned tokens are passed to the React SDK's StigmerProvider via
// the getAccessToken callback to authenticate browser-based API calls.
type PlatformClientAuth struct {
	tokenClient platformclientv1.PlatformClientTokenControllerClient
	clientID    string
	clientSecret string
	conn        *grpc.ClientConn
}

// PlatformClientAuthOption configures a [PlatformClientAuth].
type PlatformClientAuthOption func(*platformClientAuthConfig)

type platformClientAuthConfig struct {
	target       string
	clientID     string
	clientSecret string
	insecure     bool
}

// WithPlatformClientCredentials sets the client_id and client_secret for
// authenticating with the Stigmer API. Both values are required.
func WithPlatformClientCredentials(clientID, clientSecret string) PlatformClientAuthOption {
	return func(c *platformClientAuthConfig) {
		c.clientID = clientID
		c.clientSecret = clientSecret
	}
}

// WithPlatformClientBaseURL sets the gRPC target address (host:port).
// Defaults to api.stigmer.ai:443.
func WithPlatformClientBaseURL(target string) PlatformClientAuthOption {
	return func(c *platformClientAuthConfig) {
		c.target = target
	}
}

// WithPlatformClientInsecure disables TLS. Use only for local development.
func WithPlatformClientInsecure() PlatformClientAuthOption {
	return func(c *platformClientAuthConfig) {
		c.insecure = true
	}
}

// MintUserTokenInput holds the user identity for minting a Stigmer JWT.
type MintUserTokenInput struct {
	// Platform's stable user identifier. Becomes the JWT sub claim.
	UserID string

	// User's email address. Used for profile enrichment during JIT provisioning.
	UserEmail string

	// User's display name. Used for profile enrichment during JIT provisioning.
	UserName string

	// Organization to scope the token to. When empty, defaults to the
	// PlatformClient's owning organization.
	OrgID string
}

// MintUserTokenResult contains the Stigmer-signed JWT and its metadata.
type MintUserTokenResult struct {
	// Stigmer-signed JWT for browser-based API authentication.
	AccessToken string

	// Token type. Always "Bearer".
	TokenType string

	// Token lifetime in seconds from issuance.
	ExpiresIn int32

	// Absolute expiration time, computed from ExpiresIn at call time.
	ExpiresAt time.Time
}

// NewPlatformClientAuth creates a PlatformClient token-minting helper.
//
// This is the recommended way to mint Stigmer user JWTs from a Go backend.
// The returned tokens are passed to the React SDK's StigmerProvider via
// the getAccessToken callback.
//
//	auth, err := stigmer.NewPlatformClientAuth(
//	    stigmer.WithPlatformClientCredentials(clientID, clientSecret),
//	    stigmer.WithPlatformClientBaseURL("api.stigmer.ai:443"),
//	)
//	if err != nil {
//	    log.Fatal(err)
//	}
//	defer auth.Close()
//
//	result, err := auth.MintUserToken(ctx, &stigmer.MintUserTokenInput{
//	    UserID:    "user-123",
//	    UserEmail: "jane@acme.com",
//	    UserName:  "Jane Doe",
//	})
func NewPlatformClientAuth(opts ...PlatformClientAuthOption) (*PlatformClientAuth, error) {
	cfg := platformClientAuthConfig{
		target: defaultTarget,
	}
	for _, opt := range opts {
		opt(&cfg)
	}

	if cfg.clientID == "" {
		return nil, fmt.Errorf("stigmer: clientID is required — find it in the Stigmer Console under IAM > Platform Clients")
	}
	if cfg.clientSecret == "" {
		return nil, fmt.Errorf("stigmer: clientSecret is required — the secret is shown once at creation time. If lost, rotate via the Console or CLI")
	}

	conn, err := transport.Dial(transport.Config{
		Target:   cfg.target,
		Insecure: cfg.insecure,
	})
	if err != nil {
		return nil, fmt.Errorf("stigmer: failed to connect: %w", err)
	}

	return &PlatformClientAuth{
		tokenClient:  platformclientv1.NewPlatformClientTokenControllerClient(conn),
		clientID:     cfg.clientID,
		clientSecret: cfg.clientSecret,
		conn:         conn,
	}, nil
}

// MintUserToken mints a user-scoped JWT for browser-based access to
// Stigmer resources.
//
// The platform builder's backend calls this with the authenticated user's
// identity. Stigmer validates the PlatformClient credentials, optionally
// JIT-provisions the user's identity account, and returns a signed JWT.
func (a *PlatformClientAuth) MintUserToken(ctx context.Context, input *MintUserTokenInput) (*MintUserTokenResult, error) {
	if input.UserID == "" {
		return nil, &gen.Error{
			Code:     gen.CodeInvalidArgument,
			Message:  "mintUserToken: userID is required — this is the platform's stable identifier for the user",
			GRPCCode: codes.InvalidArgument,
		}
	}

	resp, err := a.tokenClient.MintUserToken(ctx, &platformclientv1.MintUserTokenRequest{
		ClientId:     a.clientID,
		ClientSecret: a.clientSecret,
		UserId:       input.UserID,
		UserEmail:    input.UserEmail,
		UserName:     input.UserName,
		OrgId:        input.OrgID,
	})
	if err != nil {
		return nil, gen.WrapErr(err)
	}

	return &MintUserTokenResult{
		AccessToken: resp.GetAccessToken(),
		TokenType:   resp.GetTokenType(),
		ExpiresIn:   resp.GetExpiresIn(),
		ExpiresAt:   time.Now().Add(time.Duration(resp.GetExpiresIn()) * time.Second),
	}, nil
}

// Close releases the underlying gRPC connection.
func (a *PlatformClientAuth) Close() error {
	if a.conn != nil {
		return a.conn.Close()
	}
	return nil
}
