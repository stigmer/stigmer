//go:build integration

package security

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
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

	// mongoSeeder provides direct MongoDB access for pre-seeding identity
	// documents before the Java service resolves them.
	mongoSeeder *harness.MongoSeeder
)

func TestMain(m *testing.M) {
	suiteLogger = slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

	jarPath := findServiceJar()
	if jarPath == "" {
		suiteLogger.Warn("stigmer-service fat JAR not found — skipping security integration tests",
			"hint", "set STIGMER_SERVICE_JAR or build with bazel in stigmer-cloud")
		os.Exit(0)
	}

	cfg := harness.DefaultConfig()
	cfg.OutputDir = ".test-output-security"

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
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

	// --- Seed bootstrap identity in MongoDB ---
	mongoURI := fmt.Sprintf("mongodb://%s:%s", testHarness.Mongo.Host, testHarness.Mongo.Port)
	mongoSeeder, err = harness.NewMongoSeeder(ctx, mongoURI, "stigmer_test")
	if err != nil {
		suiteLogger.Error("failed to create mongo seeder", "error", err)
		testHarness.Stop(ctx)
		os.Exit(1)
	}

	err = mongoSeeder.SeedIdentityAccount(ctx, harness.SeedIdentityAccountInput{
		ID:        bootstrapIdentityAccountID,
		IdpID:     bootstrapIdpID,
		Email:     bootstrapEmail,
		Name:      "Security Test Bootstrap",
		FirstName: "Security",
		LastName:  "Bootstrap",
	})
	if err != nil {
		suiteLogger.Error("failed to seed bootstrap identity", "error", err)
		mongoSeeder.Close(ctx)
		testHarness.Stop(ctx)
		os.Exit(1)
	}
	suiteLogger.Info("seeded bootstrap identity account",
		"id", bootstrapIdentityAccountID,
		"idp_id", bootstrapIdpID,
	)

	// --- Start Java service in PRODUCTION security mode ---
	logDir := testHarness.LogDir()

	svcCfg := harness.ServiceConfig{
		JarPath:         jarPath,
		MongoHost:       testHarness.Mongo.Host,
		MongoPort:       testHarness.Mongo.Port,
		RedisHost:       testHarness.Redis.Host,
		RedisPort:       testHarness.Redis.Port,
		TemporalAddress: testHarness.Temporal.Address(),
		LogDir:          logDir,
		Security:        harness.SecurityModeProduction,
		Auth0IssuerURL:  mockAuth0.Issuer,
		Auth0Audience:   testAudience,
		Auth0TokenURL:   mockAuth0.URL + "/oauth/token",
	}

	if testHarness.MinIO != nil {
		svcCfg.MinIOEndpoint = testHarness.MinIO.Endpoint
		svcCfg.MinIOAccessKey = testHarness.MinIO.AccessKey
		svcCfg.MinIOSecretKey = testHarness.MinIO.SecretKey
	}

	svc, err := harness.StartJavaService(ctx, svcCfg, suiteLogger)
	if err != nil {
		suiteLogger.Error("failed to start java service in production security mode", "error", err)
		mongoSeeder.Close(ctx)
		testHarness.Stop(ctx)
		os.Exit(1)
	}
	testHarness.Service = svc

	suiteLogger.Info("java service started in production security mode",
		"grpc", svc.GRPCAddress(),
		"auth0_issuer", mockAuth0.Issuer,
	)

	// --- Create bootstrap authenticated connection ---
	bootstrapToken, err := mockAuth0.SignJWT(bootstrapIdpID, testAudience, nil)
	if err != nil {
		suiteLogger.Error("failed to sign bootstrap JWT", "error", err)
		mongoSeeder.Close(ctx)
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
		mongoSeeder.Close(ctx)
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
	mongoSeeder.Close(context.Background())
	testHarness.Stop(context.Background())
	os.Exit(code)
}

func findServiceJar() string {
	if jar := os.Getenv("STIGMER_SERVICE_JAR"); jar != "" {
		return jar
	}
	candidates := []string{
		"../../../stigmer-cloud/bazel-bin/backend/services/stigmer-service/stigmer_service_fatjar.jar",
	}
	for _, c := range candidates {
		abs, err := filepath.Abs(c)
		if err != nil {
			continue
		}
		if _, err := os.Stat(abs); err == nil {
			return abs
		}
	}
	return ""
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

