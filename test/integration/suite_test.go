//go:build integration

package integration

import (
	"context"
	"fmt"
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
	mcpServerStigmerBinary string
	otelShutdown           func(context.Context) error
)

func TestMain(m *testing.M) {
	suiteLogger = slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

	jarPath := harness.FindServiceJar()
	if jarPath == "" {
		suiteLogger.Warn("stigmer-service fat JAR not found — skipping integration tests",
			"hint", "set STIGMER_SERVICE_JAR or build with bazel in stigmer-cloud")
		os.Exit(0)
	}

	cfg := harness.DefaultConfig()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	var err error
	testHarness, err = harness.Start(ctx, cfg)
	if err != nil {
		suiteLogger.Error("failed to start test infrastructure", "error", err)
		os.Exit(1)
	}

	if testHarness.OTelEnabled() {
		shutdown, otelErr := harness.InitTracing(ctx, testHarness.Jaeger.OTLPAddress)
		if otelErr != nil {
			suiteLogger.Error("failed to initialize OTel tracing", "error", otelErr)
			testHarness.Stop(ctx)
			os.Exit(1)
		}
		otelShutdown = shutdown
		suiteLogger.Info("otel tracing initialized", "jaeger_otlp", testHarness.Jaeger.OTLPAddress)
	}

	logDir := testHarness.LogDir()

	anthropicKey := os.Getenv("ANTHROPIC_API_KEY")

	cursorKey := os.Getenv("CURSOR_API_KEY")

	svcCfg := harness.ServiceConfig{
		JarPath:         jarPath,
		MongoHost:       testHarness.Mongo.Host,
		MongoPort:       testHarness.Mongo.Port,
		RedisHost:       testHarness.Redis.Host,
		RedisPort:       testHarness.Redis.Port,
		TemporalAddress: testHarness.Temporal.Address(),
		AnthropicAPIKey: anthropicKey,
		CursorAPIKey:    cursorKey,
		LogDir:          logDir,
	}
	if testHarness.OTelEnabled() {
		svcCfg.OTLPEndpoint = testHarness.Jaeger.OTLPEndpoint
	}

	if testHarness.OpenFGA != nil {
		svcCfg.OpenFGAAPIURL = testHarness.OpenFGA.HTTPEndpoint
		svcCfg.OpenFGAStoreID = testHarness.OpenFGA.StoreID
		svcCfg.OpenFGAModelID = testHarness.OpenFGA.ModelID
		suiteLogger.Info("FGA enabled for Java service",
			"api_url", svcCfg.OpenFGAAPIURL,
			"store_id", svcCfg.OpenFGAStoreID,
			"model_id", svcCfg.OpenFGAModelID,
		)
	}

	if testHarness.MinIO != nil {
		svcCfg.MinIOEndpoint = testHarness.MinIO.Endpoint
		svcCfg.MinIOAccessKey = testHarness.MinIO.AccessKey
		svcCfg.MinIOSecretKey = testHarness.MinIO.SecretKey
		suiteLogger.Info("MinIO enabled for Java service", "endpoint", svcCfg.MinIOEndpoint)
	}

	svc, err := harness.StartJavaService(ctx, svcCfg, suiteLogger)
	if err != nil {
		suiteLogger.Error("failed to start java service", "error", err)
		testHarness.Stop(ctx)
		os.Exit(1)
	}
	testHarness.Service = svc

	grpcDialOpts := []grpc.DialOption{
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	}
	if testHarness.OTelEnabled() {
		grpcDialOpts = append(grpcDialOpts, harness.OTelGRPCDialOptions()...)
	}

	grpcConn, err = grpc.NewClient(
		svc.GRPCAddress(),
		grpcDialOpts...,
	)
	if err != nil {
		suiteLogger.Error("failed to create gRPC connection", "error", err)
		testHarness.Stop(ctx)
		os.Exit(1)
	}

	// Start unified runner on the global task queue.
	// It registers all activities: ExecuteCursor, ExecuteDeepAgent,
	// workflow engine tasks, MCP activities.
	//
	// PathRoutingProxy mirrors production path-based routing (Caddy/Istio):
	//   /aiserver.v1* -> Netty BiDi proxy (h2c)
	//   everything else -> Tomcat HTTP
	pathProxy, err := harness.NewPathRoutingProxy(svc.HTTPAddress(), svc.BiDiProxyAddress())
	if err != nil {
		suiteLogger.Error("failed to start path routing proxy", "error", err)
		testHarness.Stop(ctx)
		os.Exit(1)
	}
	defer pathProxy.Close()

	unifiedCfg := harness.UnifiedRunnerConfig{
		StigmerServiceAddress: svc.GRPCAddress(),
		TemporalAddress:       testHarness.Temporal.Address(),
		LogDir:                logDir,
		CursorAPIKey:          cursorKey,
		ProxyEndpoint:         pathProxy.Address(),
	}
	if testHarness.OTelEnabled() {
		unifiedCfg.OTLPEndpoint = testHarness.Jaeger.OTLPAddress
	}

	unifiedRunner, err := harness.StartUnifiedRunnerStatic(
		ctx, unifiedCfg, "stigmer_runner", suiteLogger,
	)
	if err != nil {
		suiteLogger.Warn("unified runner failed to start — execution tests will be skipped", "error", err)
	} else {
		testHarness.UnifiedRunner = unifiedRunner
	}

	if testHarness.OpenFGA != nil {
		if err := harness.SeedBaseFGATuples(ctx, testHarness.OpenFGA); err != nil {
			suiteLogger.Error("failed to seed FGA tuples", "error", err)
			testHarness.Stop(ctx)
			os.Exit(1)
		}
		suiteLogger.Info("FGA base tuples seeded")
	}

	if err := harness.ProvisionTestBillingAccount(ctx, grpcConn, "integration-test-seed-credits"); err != nil {
		suiteLogger.Warn("failed to provision test billing account — agent_call tests may fail", "error", err)
	}

	mongoURI := fmt.Sprintf("mongodb://%s:%s", testHarness.Mongo.Host, testHarness.Mongo.Port)
	if err := harness.SeedBillingPolicies(ctx, mongoURI, "stigmer_test"); err != nil {
		suiteLogger.Warn("failed to seed billing policies — billable_cost_micros may be zero", "error", err)
	}

	if err := harness.SeedDefaultAgent(ctx, grpcConn); err != nil {
		suiteLogger.Warn("failed to seed default agent — tests requiring a default agent may fail", "error", err)
	} else {
		suiteLogger.Info("default agent seeded")
	}

	mcpBinary, mcpErr := harness.BuildTestMcpServer(cfg.OutputDir)
	if mcpErr != nil {
		suiteLogger.Warn("failed to build test MCP server — MCP/HITL tests will be skipped", "error", mcpErr)
	} else {
		mcpTestServerBinary = mcpBinary
		suiteLogger.Info("built test MCP server", "path", mcpBinary)
	}

	stigmerMcpBinary, stigmerMcpErr := harness.BuildMcpServerStigmer(cfg.OutputDir)
	if stigmerMcpErr != nil {
		suiteLogger.Warn("failed to build mcp-server-stigmer — workflow architect tests will be skipped", "error", stigmerMcpErr)
	} else {
		mcpServerStigmerBinary = stigmerMcpBinary
		suiteLogger.Info("built mcp-server-stigmer", "path", stigmerMcpBinary)
	}

	suiteLogger.Info("suite infrastructure ready",
		"grpc_address", svc.GRPCAddress(),
		"mongo", fmt.Sprintf("%s:%s", testHarness.Mongo.Host, testHarness.Mongo.Port),
		"temporal", testHarness.Temporal.Address(),
		"unified_runner", testHarness.UnifiedRunner != nil,
		"log_dir", logDir,
	)

	code := m.Run()

	if otelShutdown != nil {
		if err := otelShutdown(context.Background()); err != nil {
			suiteLogger.Warn("otel shutdown error", "error", err)
		}
	}

	grpcConn.Close()
	testHarness.Stop(context.Background())
	os.Exit(code)
}
