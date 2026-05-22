//go:build integration

package sessionrouting

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	billingv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/billing/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"go.temporal.io/sdk/client"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

const (
	testOrg        = "test-org"
	testAPIVersion = "agentic.stigmer.ai/v1"
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

	jarPath := findServiceJar()
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

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
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
		MongoHost:       testHarness.Mongo.Host,
		MongoPort:       testHarness.Mongo.Port,
		RedisHost:       testHarness.Redis.Host,
		RedisPort:       testHarness.Redis.Port,
		TemporalAddress: testHarness.Temporal.Address(),
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

	if err := provisionTestBillingAccount(ctx, grpcConn); err != nil {
		suiteLogger.Warn("failed to provision test billing account", "error", err)
	}

	if err := seedDefaultAgent(ctx, grpcConn); err != nil {
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

func seedDefaultAgent(ctx context.Context, conn *grpc.ClientConn) error {
	clients := harness.NewClients(conn)
	_, err := clients.AgentCommand.Apply(ctx, &agentv1.Agent{
		ApiVersion: testAPIVersion,
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name:       "assistant",
			Org:        testOrg,
			Visibility: apiresource.ApiResourceVisibility_visibility_public,
			Labels: map[string]string{
				"stigmer.ai/system":        "true",
				"stigmer.ai/default-agent": "true",
			},
		},
		Spec: &agentv1.AgentSpec{
			Description:  "General-purpose AI assistant.",
			Instructions: "You are a general-purpose AI assistant.",
		},
	})
	return err
}

func provisionTestBillingAccount(ctx context.Context, conn *grpc.ClientConn) error {
	billing := billingv1.NewBillingCommandControllerClient(conn)

	_, err := billing.GetOrCreateBillingAccount(ctx, &billingv1.GetOrCreateBillingAccountInput{
		OrgId: testOrg,
	})
	if err != nil {
		return fmt.Errorf("getOrCreateBillingAccount: %w", err)
	}

	_, err = billing.AdjustCredits(ctx, &billingv1.AdjustCreditsInput{
		OrgId:          testOrg,
		AmountMicros:   100_000_000,
		Reason:         "session routing integration test seed",
		IdempotencyKey: "session-routing-test-seed-credits",
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
