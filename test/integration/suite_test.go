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

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	var err error
	testHarness, err = harness.Start(ctx, harness.DefaultConfig())
	if err != nil {
		suiteLogger.Error("failed to start test infrastructure", "error", err)
		os.Exit(1)
	}

	svc, err := harness.StartJavaService(ctx, harness.ServiceConfig{
		JarPath:         jarPath,
		MongoHost:       testHarness.Mongo.Host,
		MongoPort:       testHarness.Mongo.Port,
		RedisHost:       testHarness.Redis.Host,
		RedisPort:       testHarness.Redis.Port,
		TemporalAddress: testHarness.Temporal.Address(),
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
	}, suiteLogger)
	if err != nil {
		suiteLogger.Warn("workflow-runner failed to start — execution tests will be skipped", "error", err)
	} else {
		testHarness.WorkflowRunner = runner
	}

	suiteLogger.Info("suite infrastructure ready",
		"grpc_address", svc.GRPCAddress(),
		"mongo", fmt.Sprintf("%s:%s", testHarness.Mongo.Host, testHarness.Mongo.Port),
		"temporal", testHarness.Temporal.Address(),
		"workflow_runner", runner != nil,
	)

	code := m.Run()

	grpcConn.Close()
	testHarness.Stop(context.Background())
	os.Exit(code)
}

func findServiceJar() string {
	if jar := os.Getenv("STIGMER_SERVICE_JAR"); jar != "" {
		return jar
	}

	candidates := []string{
		"../../../../stigmer-cloud/bazel-bin/backend/services/stigmer-service/stigmer_service_fatjar.jar",
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
