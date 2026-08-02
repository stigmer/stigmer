//go:build integration

package security

import (
	"context"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/stigmer/stigmer/test/integration/harness"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
)

const (
	testOrg = "test-org"

	bootstrapIdentityAccountID = "security-test-bootstrap-account"
	bootstrapIdpID             = "security-test-bootstrap|auth0"
	bootstrapEmail             = "security-bootstrap@stigmer.ai"

	testAudience = "https://api.stigmer.test"

	// testMcpAudience is the additional audience the hosted MCP server's tokens
	// carry. Auth0 mints these via the RFC 8707 resource parameter, so they are
	// scoped to the MCP resource rather than the primary API audience.
	testMcpAudience = "https://mcp.stigmer.test"
)

var (
	testHarness *harness.TestHarness
	suiteLogger *slog.Logger

	// mockAuth0 serves OIDC discovery and JWKS, replacing Auth0 for the
	// production security chain. JWTs signed by this server are accepted
	// by the Auth0 JwtAuthenticationProvider.
	mockAuth0 *harness.MockJWKSServer

	// mockIdP serves JWKS for a federated IdentityProvider. JWTs signed
	// by this server are validated by FederatedJwtAuthenticationProvider
	// when an IdP is registered with mockIdP.JWKSURL.
	mockIdP *harness.MockJWKSServer

	// bootstrapConn is an authenticated gRPC connection using a mock Auth0
	// JWT. Used for setup operations (creating IdentityProviders, etc.).
	bootstrapConn *grpc.ClientConn

	// identitySeeder writes identity rows directly into the app-postgres
	// store for the pre-auth chicken-and-egg accounts the production
	// security chain must resolve. Seeding happens AFTER service boot
	// (Flyway creates s_iam.identity_account during startup) and before the
	// first authenticated call — subjects are resolved per-request, so that
	// window is exactly right.
	identitySeeder *harness.IdentitySeeder
)

func TestMain(m *testing.M) {
	suiteLogger = slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

	jarPath := harness.FindServiceJar()
	if jarPath == "" {
		suiteLogger.Warn("stigmer-service fat JAR not found — skipping security integration tests",
			"hint", "set STIGMER_SERVICE_JAR or build with bazel in stigmer-cloud")
		os.Exit(0)
	}

	cfg := harness.DefaultConfig()
	cfg.OutputDir = ".test-output-security"

	// The boot budget also absorbs testcontainers-go's image-pull retry
	// backoff, so a slow registry gets headroom instead of killing the run
	// at the context deadline (issue #334).
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()

	var err error
	testHarness, err = harness.Start(ctx, cfg)
	if err != nil {
		suiteLogger.Error("failed to start test infrastructure", "error", err)
		os.Exit(1)
	}

	// --- Mock OIDC server (fake Auth0) ---
	// This must start before the Java service because GrpcSecurityConfigBase
	// performs OIDC discovery during bean initialization.
	mockAuth0, err = harness.NewMockOIDCServer("", testAudience)
	if err != nil {
		suiteLogger.Error("failed to start mock Auth0 OIDC server", "error", err)
		testHarness.Stop(ctx)
		os.Exit(1)
	}
	suiteLogger.Info("mock Auth0 OIDC server started",
		"issuer", mockAuth0.Issuer,
		"jwks", mockAuth0.JWKSURL,
	)

	// --- Mock IdP JWKS server (federated IdentityProvider) ---
	mockIdP, err = harness.NewMockJWKSServer("https://test-federation-idp.example.com")
	if err != nil {
		suiteLogger.Error("failed to start mock IdP JWKS server", "error", err)
		mockAuth0.Close()
		testHarness.Stop(ctx)
		os.Exit(1)
	}
	suiteLogger.Info("mock IdP JWKS server started",
		"issuer", mockIdP.Issuer,
		"jwks", mockIdP.JWKSURL,
	)

	// --- Start Java service in PRODUCTION security mode ---
	logDir := testHarness.LogDir()

	svcCfg := harness.ServiceConfig{
		JarPath:          jarPath,
		AppPGHost:        testHarness.AppPostgres.Host,
		AppPGPort:        testHarness.AppPostgres.Port,
		AppPGDatabase:    testHarness.AppPostgres.Database,
		AppPGUser:        testHarness.AppPostgres.User,
		AppPGPassword:    testHarness.AppPostgres.Password,
		RedisHost:        testHarness.Redis.Host,
		RedisPort:        testHarness.Redis.Port,
		TemporalAddress:  testHarness.Temporal.Address(),
		VaultAddr:        testHarness.OpenBao.Addr,
		VaultToken:       testHarness.OpenBao.RootToken,
		LogDir:           logDir,
		Security:         harness.SecurityModeProduction,
		Auth0IssuerURL:   mockAuth0.Issuer,
		Auth0Audience:    testAudience,
		Auth0McpAudience: testMcpAudience,
		Auth0TokenURL:    mockAuth0.URL + "/oauth/token",
		// Configure a previous signing key so the JWT key-rotation overlap is
		// exercised end-to-end (see jwt_keyrotation_test.go). The primary key
		// keeps minting; tokens signed with the previous key must still verify.
		PreviousJWTSigningKey:   harness.StigmerPreviousJWTSigningKeyBase64,
		PreviousJWTSigningKeyID: "stigmer-signing-key-0",
		// Configure an environment audience so the JWT audience-binding behavior
		// is exercised end-to-end (see jwt_audience_test.go). Lenient mode keeps
		// existing no-aud tokens (e.g. the key-rotation tests) verifying, while a
		// token stamped with another environment's audience is rejected.
		JWTAudience:     harness.StigmerJWTAudience,
		RequireAudience: false,
	}

	if testHarness.OpenFGA != nil {
		svcCfg.OpenFGAAPIURL = testHarness.OpenFGA.HTTPEndpoint
		svcCfg.OpenFGAStoreID = testHarness.OpenFGA.StoreID
		svcCfg.OpenFGAModelID = testHarness.OpenFGA.ModelID
	}

	if testHarness.MinIO != nil {
		svcCfg.MinIOEndpoint = testHarness.MinIO.Endpoint
		svcCfg.MinIOAccessKey = testHarness.MinIO.AccessKey
		svcCfg.MinIOSecretKey = testHarness.MinIO.SecretKey
	}

	svc, err := harness.StartJavaService(ctx, svcCfg, suiteLogger)
	if err != nil {
		suiteLogger.Error("failed to start java service in production security mode", "error", err)
		testHarness.Stop(ctx)
		os.Exit(1)
	}
	testHarness.Service = svc

	suiteLogger.Info("java service started in production security mode",
		"grpc", svc.GRPCAddress(),
		"auth0_issuer", mockAuth0.Issuer,
	)

	// --- Seed the bootstrap identity in the app-postgres store ---
	// This must run after service boot (Flyway creates the table during
	// startup) and before the first authenticated call (the interceptor
	// chain resolves JWT subjects per-request). The machine account identity
	// (idpId "{AUTH0_CLIENT_ID}@clients" = the subject of the JWT minted via
	// the mock OAuth token endpoint) is NOT seeded here: the service's own
	// BootstrapIdentitySeeder creates it at startup with the well-known id
	// "machine" (T06 — the same code path production and fresh installs
	// run). Only the human bootstrap account remains a genuine pre-auth
	// chicken-and-egg.
	identitySeeder = harness.NewIdentitySeeder(testHarness.AppPostgres)
	err = identitySeeder.SeedIdentityAccount(ctx, harness.SeedIdentityAccountInput{
		ID:        bootstrapIdentityAccountID,
		IdpID:     bootstrapIdpID,
		Email:     bootstrapEmail,
		Name:      "Security Test Bootstrap",
		FirstName: "Security",
		LastName:  "Bootstrap",
	})
	if err != nil {
		suiteLogger.Error("failed to seed bootstrap identity", "error", err)
		testHarness.Stop(ctx)
		os.Exit(1)
	}
	suiteLogger.Info("seeded bootstrap identity account",
		"id", bootstrapIdentityAccountID,
		"idp_id", bootstrapIdpID,
	)

	// --- Seed FGA tuples for the bootstrap user ---
	// The machine account's operator grant is NOT seeded here:
	// BootstrapIdentitySeeder writes it at startup, and OpenFGA's raw Write API
	// rejects duplicate tuples with a 400. The human bootstrap user still needs
	// operator permissions to create IdentityProviders and PlatformClients.
	if testHarness.OpenFGA != nil {
		tuples := []harness.RelationshipTuple{
			{
				User:     "identity_account:" + bootstrapIdentityAccountID,
				Relation: "operator",
				Object:   "platform:stigmer",
			},
			{
				User:     "identity_account:" + bootstrapIdentityAccountID,
				Relation: "owner",
				Object:   "organization:" + testOrg,
			},
		}
		if fgaErr := testHarness.OpenFGA.WriteTuples(ctx, tuples); fgaErr != nil {
			suiteLogger.Error("failed to seed FGA tuples", "error", fgaErr)
			testHarness.Stop(ctx)
			os.Exit(1)
		}
		suiteLogger.Info("seeded FGA tuples for bootstrap user")
	}

	// --- Create bootstrap authenticated connection ---
	bootstrapToken, err := mockAuth0.SignJWT(bootstrapIdpID, testAudience, nil)
	if err != nil {
		suiteLogger.Error("failed to sign bootstrap JWT", "error", err)
		testHarness.Stop(ctx)
		os.Exit(1)
	}

	bootstrapConn, err = grpc.NewClient(
		svc.GRPCAddress(),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithUnaryInterceptor(bearerUnaryInterceptor(bootstrapToken)),
		grpc.WithStreamInterceptor(bearerStreamInterceptor(bootstrapToken)),
	)
	if err != nil {
		suiteLogger.Error("failed to create bootstrap gRPC connection", "error", err)
		testHarness.Stop(ctx)
		os.Exit(1)
	}

	suiteLogger.Info("security integration test suite ready",
		"grpc_address", svc.GRPCAddress(),
		"security_mode", "production",
		"log_dir", logDir,
	)

	code := m.Run()

	bootstrapConn.Close()
	mockIdP.Close()
	mockAuth0.Close()
	testHarness.Stop(context.Background())
	os.Exit(code)
}

// bearerUnaryInterceptor attaches a Bearer token to every unary RPC.
func bearerUnaryInterceptor(token string) grpc.UnaryClientInterceptor {
	return func(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
		ctx = appendBearerMetadata(ctx, token)
		return invoker(ctx, method, req, reply, cc, opts...)
	}
}

// bearerStreamInterceptor attaches a Bearer token to every streaming RPC.
func bearerStreamInterceptor(token string) grpc.StreamClientInterceptor {
	return func(ctx context.Context, desc *grpc.StreamDesc, cc *grpc.ClientConn, method string, streamer grpc.Streamer, opts ...grpc.CallOption) (grpc.ClientStream, error) {
		ctx = appendBearerMetadata(ctx, token)
		return streamer(ctx, desc, cc, method, opts...)
	}
}

func appendBearerMetadata(ctx context.Context, token string) context.Context {
	return metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+token)
}
