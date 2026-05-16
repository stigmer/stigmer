//go:build integration

package integration

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	billingv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/billing/v1"
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
)

func TestMain(m *testing.M) {
	suiteLogger = slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

	jarPath := findServiceJar()
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

	grpcConn, err = grpc.NewClient(
		svc.GRPCAddress(),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		suiteLogger.Error("failed to create gRPC connection", "error", err)
		testHarness.Stop(ctx)
		os.Exit(1)
	}

	runner, err := harness.StartWorkflowRunner(ctx, harness.WorkflowRunnerConfig{
		StigmerServiceAddress: svc.GRPCAddress(),
		TemporalAddress:       testHarness.Temporal.Address(),
		LogDir:                logDir,
	}, suiteLogger)
	if err != nil {
		suiteLogger.Warn("workflow-runner failed to start — execution tests will be skipped", "error", err)
	} else {
		testHarness.WorkflowRunner = runner
	}

	// Seed base FGA tuples (platform operator, org ownership) so the test
	// identity passes authorization checks when real OpenFGA is active.
	if testHarness.OpenFGA != nil {
		if err := harness.SeedBaseFGATuples(ctx, testHarness.OpenFGA); err != nil {
			suiteLogger.Error("failed to seed FGA tuples", "error", err)
			testHarness.Stop(ctx)
			os.Exit(1)
		}
		suiteLogger.Info("FGA base tuples seeded")
	}

	// Provision a billing account for the test org so agent executions
	// pass the billing authorization gate in InvokeAgentExecutionWorkflow.
	if err := provisionTestBillingAccount(ctx, grpcConn); err != nil {
		suiteLogger.Warn("failed to provision test billing account — agent_call tests may fail", "error", err)
	}

	// Build the test MCP server binary for HITL and MCP integration tests.
	mcpBinary, mcpErr := harness.BuildTestMcpServer(cfg.OutputDir)
	if mcpErr != nil {
		suiteLogger.Warn("failed to build test MCP server — MCP/HITL tests will be skipped", "error", mcpErr)
	} else {
		mcpTestServerBinary = mcpBinary
		suiteLogger.Info("built test MCP server", "path", mcpBinary)
	}

	// Build the real mcp-server-stigmer binary for Workflow Architect tests.
	stigmerMcpBinary, stigmerMcpErr := harness.BuildMcpServerStigmer(cfg.OutputDir)
	if stigmerMcpErr != nil {
		suiteLogger.Warn("failed to build mcp-server-stigmer — workflow architect tests will be skipped", "error", stigmerMcpErr)
	} else {
		mcpServerStigmerBinary = stigmerMcpBinary
		suiteLogger.Info("built mcp-server-stigmer", "path", stigmerMcpBinary)
	}

	// Start agent-runner only when an LLM API key is available.
	// This keeps the default offline suite unaffected.
	if anthropicKey != "" && runner != nil {
		agentRunnerCfg := harness.AgentRunnerConfig{
			StigmerServiceAddress: svc.GRPCAddress(),
			TemporalAddress:       testHarness.Temporal.Address(),
			LogDir:                logDir,
			AnthropicAPIKey:       anthropicKey,
			ProxyEndpoint:         svc.HTTPAddress(),
		}
		if testHarness.MinIO != nil {
			agentRunnerCfg.R2Endpoint = testHarness.MinIO.Endpoint
			agentRunnerCfg.R2AccessKey = testHarness.MinIO.AccessKey
			agentRunnerCfg.R2SecretKey = testHarness.MinIO.SecretKey
			agentRunnerCfg.R2Bucket = "test-bucket"
		}
		agentRunner, agentErr := harness.StartAgentRunner(ctx, agentRunnerCfg, suiteLogger)
		if agentErr != nil {
			suiteLogger.Warn("agent-runner failed to start — agent_call tests will be skipped", "error", agentErr)
		} else {
			testHarness.AgentRunner = agentRunner
		}
	}

	// Start cursor-runner only when a Cursor API key is available.
	if cursorKey != "" && runner != nil {
		cursorRunner, cursorErr := harness.StartCursorRunner(ctx, harness.CursorRunnerConfig{
			StigmerServiceAddress: svc.GRPCAddress(),
			TemporalAddress:       testHarness.Temporal.Address(),
			LogDir:                logDir,
			CursorAPIKey:          cursorKey,
			ProxyEndpoint:         svc.HTTPAddress(),
		}, suiteLogger)
		if cursorErr != nil {
			suiteLogger.Warn("cursor-runner failed to start — cursor_call tests will be skipped", "error", cursorErr)
		} else {
			testHarness.CursorRunner = cursorRunner
		}
	}

	suiteLogger.Info("suite infrastructure ready",
		"grpc_address", svc.GRPCAddress(),
		"mongo", fmt.Sprintf("%s:%s", testHarness.Mongo.Host, testHarness.Mongo.Port),
		"temporal", testHarness.Temporal.Address(),
		"workflow_runner", runner != nil,
		"agent_runner", testHarness.AgentRunner != nil,
		"cursor_runner", testHarness.CursorRunner != nil,
		"log_dir", logDir,
	)

	code := m.Run()

	grpcConn.Close()
	testHarness.Stop(context.Background())
	os.Exit(code)
}

func provisionTestBillingAccount(ctx context.Context, conn *grpc.ClientConn) error {
	billing := billingv1.NewBillingCommandControllerClient(conn)

	// Create the billing account (idempotent).
	_, err := billing.GetOrCreateBillingAccount(ctx, &billingv1.GetOrCreateBillingAccountInput{
		OrgId: "test-org",
	})
	if err != nil {
		return fmt.Errorf("getOrCreateBillingAccount: %w", err)
	}

	// Seed generous credits so agent executions don't hit the balance gate.
	_, err = billing.AdjustCredits(ctx, &billingv1.AdjustCreditsInput{
		OrgId:          "test-org",
		AmountMicros:   100_000_000, // $100 in micro-USD
		Reason:         "integration test seed",
		IdempotencyKey: "integration-test-seed-credits",
	})
	if err != nil {
		return fmt.Errorf("adjustCredits: %w", err)
	}

	return nil
}

func findServiceJar() string {
	if jar := os.Getenv("STIGMER_SERVICE_JAR"); jar != "" {
		return jar
	}

	// go test sets cwd to the package directory (test/integration/).
	// stigmer-cloud is a sibling of the stigmer repo:
	//   test/integration/ -> ../../ (repo root) -> ../ (org dir) -> stigmer-cloud/
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
