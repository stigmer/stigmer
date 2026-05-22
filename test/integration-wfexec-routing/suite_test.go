//go:build integration

package wfexecrouting

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
)

func TestMain(m *testing.M) {
	suiteLogger = slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

	jarPath := findServiceJar()
	if jarPath == "" {
		suiteLogger.Warn("stigmer-service fat JAR not found — skipping wfexec routing integration tests",
			"hint", "set STIGMER_SERVICE_JAR or build with bazel in stigmer-cloud")
		os.Exit(0)
	}

	cfg := harness.DefaultConfig()
	outputDir := os.Getenv("INTEGRATION_TEST_OUTPUT_DIR")
	if outputDir != "" {
		cfg.OutputDir = outputDir
	} else {
		cfg.OutputDir = ".test-output-wfexec-routing"
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

	svcCfg := harness.ServiceConfig{
		JarPath:         jarPath,
		MongoHost:       testHarness.Mongo.Host,
		MongoPort:       testHarness.Mongo.Port,
		RedisHost:       testHarness.Redis.Host,
		RedisPort:       testHarness.Redis.Port,
		TemporalAddress: testHarness.Temporal.Address(),
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

	suiteLogger.Info("wfexec routing suite ready",
		"grpc_address", svc.GRPCAddress(),
		"workflow_activity_routing", "execution",
		"log_dir", logDir,
	)

	code := m.Run()

	temporalClient.Close()
	grpcConn.Close()
	testHarness.Stop(context.Background())
	os.Exit(code)
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
		Reason:         "wfexec routing integration test seed",
		IdempotencyKey: "wfexec-routing-test-seed-credits",
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
