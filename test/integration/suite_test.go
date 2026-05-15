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
	testHarness *harness.TestHarness
	grpcConn    *grpc.ClientConn
	suiteLogger *slog.Logger
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

	svc, err := harness.StartJavaService(ctx, harness.ServiceConfig{
		JarPath:         jarPath,
		MongoHost:       testHarness.Mongo.Host,
		MongoPort:       testHarness.Mongo.Port,
		RedisHost:       testHarness.Redis.Host,
		RedisPort:       testHarness.Redis.Port,
		TemporalAddress: testHarness.Temporal.Address(),
		LogDir:          logDir,
	}, suiteLogger)
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

	// Provision a billing account for the test org so agent executions
	// pass the billing authorization gate in InvokeAgentExecutionWorkflow.
	if err := provisionTestBillingAccount(ctx, grpcConn); err != nil {
		suiteLogger.Warn("failed to provision test billing account — agent_call tests may fail", "error", err)
	}

	// Start agent-runner only when an LLM API key is available.
	// This keeps the default offline suite unaffected.
	anthropicKey := os.Getenv("ANTHROPIC_API_KEY")
	if anthropicKey != "" && runner != nil {
		agentRunner, agentErr := harness.StartAgentRunner(ctx, harness.AgentRunnerConfig{
			StigmerServiceAddress: svc.GRPCAddress(),
			TemporalAddress:       testHarness.Temporal.Address(),
			LogDir:                logDir,
			AnthropicAPIKey:       anthropicKey,
		}, suiteLogger)
		if agentErr != nil {
			suiteLogger.Warn("agent-runner failed to start — agent_call tests will be skipped", "error", agentErr)
		} else {
			testHarness.AgentRunner = agentRunner
		}
	}

	suiteLogger.Info("suite infrastructure ready",
		"grpc_address", svc.GRPCAddress(),
		"mongo", fmt.Sprintf("%s:%s", testHarness.Mongo.Host, testHarness.Mongo.Port),
		"temporal", testHarness.Temporal.Address(),
		"workflow_runner", runner != nil,
		"agent_runner", testHarness.AgentRunner != nil,
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
