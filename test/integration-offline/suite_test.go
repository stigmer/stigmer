//go:build integration

package offline

import (
	"context"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/stigmer/stigmer/test/integration/harness"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

var (
	testHarness            *harness.TestHarness
	grpcConn               *grpc.ClientConn
	suiteLogger            *slog.Logger
	mcpTestServerBinary    string
	mcpServerStigmerLaunch harness.StigmerMcpLaunch
)

func TestMain(m *testing.M) {
	suiteLogger = slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

	jarPath := harness.FindServiceJar()
	if jarPath == "" {
		suiteLogger.Warn("stigmer-service fat JAR not found — skipping offline integration tests",
			"hint", "set STIGMER_SERVICE_JAR or build with bazel in stigmer-cloud")
		os.Exit(0)
	}

	cfg := harness.DefaultConfig()
	outputDir := os.Getenv("INTEGRATION_TEST_OUTPUT_DIR")
	if outputDir != "" {
		cfg.OutputDir = outputDir
	} else {
		cfg.OutputDir = ".test-output-offline"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	var err error
	testHarness, err = harness.Start(ctx, cfg)
	if err != nil {
		suiteLogger.Error("failed to start test infrastructure", "error", err)
		os.Exit(1)
	}

	logDir := testHarness.LogDir()

	// Session-based routing so each test can route activities to its own
	// runner (with MockLLMProxyServer) via AddSession/AddWorkflowExecution.
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
		LogDir:          logDir,

		ActivityRouting:         "session",
		WorkflowActivityRouting: "execution",
		DefaultExecutionTarget:  "local",
		SandboxType:             "noop",
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

	if testHarness.OpenFGA != nil {
		if err := harness.SeedBaseFGATuples(ctx, testHarness.OpenFGA); err != nil {
			suiteLogger.Error("failed to seed FGA tuples", "error", err)
			grpcConn.Close()
			testHarness.Stop(ctx)
			os.Exit(1)
		}
	}

	if err := harness.ProvisionTestBillingAccount(ctx, grpcConn, harness.TestOrg, "offline-test-seed-credits"); err != nil {
		suiteLogger.Warn("failed to provision test billing account — some tests may fail", "error", err)
	}

	if err := harness.SeedDefaultAgent(ctx, grpcConn); err != nil {
		suiteLogger.Warn("failed to seed default agent", "error", err)
	} else {
		suiteLogger.Info("default agent seeded")
	}

	mcpBinary, mcpErr := harness.BuildTestMcpServer(cfg.OutputDir)
	if mcpErr != nil {
		suiteLogger.Warn("failed to build test MCP server — MCP tests will be skipped", "error", mcpErr)
	} else {
		mcpTestServerBinary = mcpBinary
		suiteLogger.Info("built test MCP server", "path", mcpBinary)
	}

	stigmerMcpLaunch, stigmerMcpErr := harness.ResolveStigmerMcpLaunch()
	if stigmerMcpErr != nil {
		suiteLogger.Warn("failed to resolve mcp-server-stigmer launch — workflow architect tests will be skipped", "error", stigmerMcpErr)
	} else {
		mcpServerStigmerLaunch = stigmerMcpLaunch
		suiteLogger.Info("resolved mcp-server-stigmer launch", "command", stigmerMcpLaunch.Command, "args", stigmerMcpLaunch.Args)
	}

	suiteLogger.Info("offline suite ready",
		"grpc_address", svc.GRPCAddress(),
		"activity_routing", "session",
		"workflow_activity_routing", "execution",
		"mcp_binary", mcpTestServerBinary != "",
		"log_dir", logDir,
	)

	code := m.Run()

	grpcConn.Close()
	testHarness.Stop(context.Background())
	os.Exit(code)
}
