//go:build integration

package sessionrouting

import (
	"context"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/stigmer/stigmer/test/integration/harness"
	"go.temporal.io/sdk/client"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

var (
	testHarness    *harness.TestHarness
	grpcConn       *grpc.ClientConn
	temporalClient client.Client
	suiteLogger    *slog.Logger
	cursorKey      string
)

func TestMain(m *testing.M) {
	suiteLogger = slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

	jarPath := harness.FindServiceJar()
	if jarPath == "" {
		suiteLogger.Warn("stigmer-service fat JAR not found — skipping session routing integration tests",
			"hint", "set STIGMER_SERVICE_JAR or build with bazel in stigmer-cloud")
		os.Exit(0)
	}

	cfg := harness.DefaultConfig()
	outputDir := os.Getenv("INTEGRATION_TEST_OUTPUT_DIR")
	if outputDir != "" {
		cfg.OutputDir = outputDir
	} else {
		cfg.OutputDir = ".test-output-session-routing"
	}

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

	logDir := testHarness.LogDir()

	cursorKey = os.Getenv("CURSOR_API_KEY")

	svcCfg := harness.ServiceConfig{
		JarPath:         jarPath,
		AppPGHost:       testHarness.AppPostgres.Host,
		AppPGPort:       testHarness.AppPostgres.Port,
		AppPGDatabase:   testHarness.AppPostgres.Database,
		AppPGUser:       testHarness.AppPostgres.User,
		AppPGPassword:   testHarness.AppPostgres.Password,
		RedisHost:       testHarness.Redis.Host,
		RedisPort:       testHarness.Redis.Port,
		TemporalAddress: testHarness.Temporal.Address(),
		VaultAddr:       testHarness.OpenBao.Addr,
		VaultToken:      testHarness.OpenBao.RootToken,
		CursorAPIKey:    cursorKey,
		LogDir:          logDir,

		// Session routing: all activities dispatch to session:{id} queues.
		ActivityRouting:        "session",
		DefaultExecutionTarget: "local",
		SandboxType:            "noop",
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
		suiteLogger.Error("failed to start java service", "error", err)
		testHarness.Stop(ctx)
		os.Exit(1)
	}
	testHarness.Service = svc

	grpcConn, err = grpc.NewClient(
		svc.GRPCAddress(),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		suiteLogger.Error("failed to create gRPC connection", "error", err)
		testHarness.Stop(ctx)
		os.Exit(1)
	}

	temporalClient, err = testHarness.Temporal.Client()
	if err != nil {
		suiteLogger.Error("failed to create Temporal client", "error", err)
		grpcConn.Close()
		testHarness.Stop(ctx)
		os.Exit(1)
	}

	if testHarness.OpenFGA != nil {
		if err := harness.SeedBaseFGATuples(ctx, testHarness.OpenFGA); err != nil {
			suiteLogger.Error("failed to seed FGA tuples", "error", err)
			temporalClient.Close()
			grpcConn.Close()
			testHarness.Stop(ctx)
			os.Exit(1)
		}
	}

	if err := harness.ProvisionTestBillingAccount(ctx, grpcConn, harness.TestOrg, "session-routing-test-seed-credits"); err != nil {
		suiteLogger.Warn("failed to provision test billing account", "error", err)
	}

	if err := harness.SeedDefaultAgent(ctx, grpcConn); err != nil {
		suiteLogger.Warn("failed to seed default agent", "error", err)
	} else {
		suiteLogger.Info("default agent seeded")
	}

	suiteLogger.Info("session routing suite ready",
		"grpc_address", svc.GRPCAddress(),
		"activity_routing", "session",
		"cursor_key_available", cursorKey != "",
		"log_dir", logDir,
	)

	code := m.Run()

	temporalClient.Close()
	grpcConn.Close()
	testHarness.Stop(context.Background())
	os.Exit(code)
}
