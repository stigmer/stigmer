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
	mcpServerStigmerLaunch harness.StigmerMcpLaunch
	otelShutdown           func(context.Context) error
	// mockWhatsAppGraph stands in for graph.facebook.com so the WhatsApp
	// install flow and outbound sends run for real without leaving the
	// machine (channel-conversations T03 Sitting 2's front-door tests).
	mockWhatsAppGraph *harness.MockWhatsAppGraph
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
	cursorAdminKey := os.Getenv("CURSOR_ADMIN_KEY")

	mockWhatsAppGraph = harness.StartMockWhatsAppGraph()
	defer mockWhatsAppGraph.Close()

	svcCfg := harness.ServiceConfig{
		JarPath:              jarPath,
		RedisHost:            testHarness.Redis.Host,
		RedisPort:            testHarness.Redis.Port,
		TemporalAddress:      testHarness.Temporal.Address(),
		AnthropicAPIKey:      anthropicKey,
		WhatsAppGraphBaseURL: mockWhatsAppGraph.BaseURL(),
		LogDir:               logDir,
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

	if testHarness.Postgres != nil {
		svcCfg.RecordsPGHost = testHarness.Postgres.Host
		svcCfg.RecordsPGPort = testHarness.Postgres.Port
		svcCfg.RecordsPGDatabase = testHarness.Postgres.Database
		svcCfg.RecordsPGUser = testHarness.Postgres.User
		svcCfg.RecordsPGPassword = testHarness.Postgres.Password
		suiteLogger.Info("records Postgres enabled for Java service",
			"host", svcCfg.RecordsPGHost, "port", svcCfg.RecordsPGPort)
	}

	// The application's system of record: Flyway migrates this database
	// during service startup (fail-fast — a broken migration fails the boot).
	svcCfg.AppPGHost = testHarness.AppPostgres.Host
	svcCfg.AppPGPort = testHarness.AppPostgres.Port
	svcCfg.AppPGDatabase = testHarness.AppPostgres.Database
	svcCfg.AppPGUser = testHarness.AppPostgres.User
	svcCfg.AppPGPassword = testHarness.AppPostgres.Password
	suiteLogger.Info("app Postgres wired for Java service",
		"host", svcCfg.AppPGHost, "port", svcCfg.AppPGPort)

	// Secret encryption backend: vault is a boot requirement (the v1
	// static-key codec is retired; every codec is vault-backed).
	svcCfg.VaultAddr = testHarness.OpenBao.Addr
	svcCfg.VaultToken = testHarness.OpenBao.RootToken
	suiteLogger.Info("openbao wired for Java service", "addr", svcCfg.VaultAddr)

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

	if err := harness.ProvisionTestBillingAccount(ctx, grpcConn, harness.TestOrg, "integration-test-seed-credits"); err != nil {
		suiteLogger.Warn("failed to provision test billing account — agent_call tests may fail", "error", err)
	}

	// Billing policies are seeded by the Java service itself at startup
	// (BillingPolicySeeder); usage-record uniqueness is enforced by the
	// Flyway DDL, so no manual index creation remains.
	//
	// A failed seed is fatal, not degraded: a half-seeded default agent fails
	// every session-dependent test with a misleading PERMISSION_DENIED
	// instead of the one real error here (oss#541).
	if err := harness.SeedDefaultAgent(ctx, grpcConn); err != nil {
		suiteLogger.Error("failed to seed default agent — aborting suite", "error", err)
		testHarness.Stop(ctx)
		os.Exit(1)
	}
	suiteLogger.Info("default agent seeded")

	// Cursor credentials are DB-resident CursorAccounts (DD-008) — without
	// this seed every proxied Cursor call 503s on an empty shared pool.
	// Both keys are required: the seed's upsert live-validates the admin
	// key against Cursor's Admin API (RequireCursorPrereqs skips cursor
	// tests when either is absent).
	if cursorKey != "" && cursorAdminKey != "" {
		if err := harness.SeedSharedPoolCursorAccount(ctx, grpcConn, cursorAdminKey, cursorKey); err != nil {
			suiteLogger.Warn("failed to seed shared-pool cursor account — cursor harness tests will fail at key selection", "error", err)
		} else {
			suiteLogger.Info("shared-pool cursor account seeded")
		}
	}

	mcpBinary, mcpErr := harness.BuildTestMcpServer(cfg.OutputDir)
	if mcpErr != nil {
		suiteLogger.Warn("failed to build test MCP server — MCP/HITL tests will be skipped", "error", mcpErr)
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

	suiteLogger.Info("suite infrastructure ready",
		"grpc_address", svc.GRPCAddress(),
		"app_postgres", fmt.Sprintf("%s:%s", testHarness.AppPostgres.Host, testHarness.AppPostgres.Port),
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
