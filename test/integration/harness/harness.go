package harness

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
)

// AgentRunnerProcess represents a running agent-runner (Python/LangGraph).
// Currently a stub for in-progress workstreams; tests skip when nil.
type AgentRunnerProcess struct{}

// CursorRunnerProcess represents a running cursor-runner (TypeScript/Cursor SDK).
// Currently a stub for in-progress workstreams; tests skip when nil.
type CursorRunnerProcess struct {
	workspaceDir string
}

// WorkspaceDir returns the workspace directory used by the cursor runner.
func (c *CursorRunnerProcess) WorkspaceDir() string {
	return c.workspaceDir
}

// TestHarness orchestrates all infrastructure and services needed for
// integration tests against the Stigmer Cloud Java service.
type TestHarness struct {
	Mongo         *MongoContainer
	Redis         *RedisContainer
	Temporal      *TemporalDevServer
	OpenFGA       *OpenFGAContainer
	MinIO         *MinIOContainer
	Jaeger        *JaegerContainer
	Service       *JavaService
	UnifiedRunner *UnifiedRunnerStatic
	AgentRunner   *AgentRunnerProcess
	CursorRunner  *CursorRunnerProcess

	outputDir string
	logger    *slog.Logger
}

type Config struct {
	// StigmerServiceJar is the path to the stigmer-service fat JAR.
	// If empty, the harness will attempt to find it relative to
	// the stigmer-cloud repo checkout.
	StigmerServiceJar string

	// StigmerCloudRoot is the path to the stigmer-cloud repo root.
	// Defaults to ../../../../stigmer-cloud relative to this module.
	StigmerCloudRoot string

	// OutputDir is the directory for test artifacts (service logs, etc.).
	// Defaults to ".test-output" relative to the working directory.
	// Can be overridden via the INTEGRATION_TEST_OUTPUT_DIR env var.
	OutputDir string
}

func DefaultConfig() Config {
	outputDir := os.Getenv("INTEGRATION_TEST_OUTPUT_DIR")
	if outputDir == "" {
		outputDir = ".test-output"
	}
	return Config{OutputDir: outputDir}
}

// FGAEnabled returns true if real OpenFGA authorization is active in this
// test run. Tests can use this to adjust assertions or skip FGA-specific
// test cases when running with the permit-all bypass.
func (h *TestHarness) FGAEnabled() bool {
	return h.OpenFGA != nil
}

// OTelEnabled returns true if OpenTelemetry tracing is active (Jaeger
// container running). Controlled by INTEGRATION_TEST_OTEL=true.
func (h *TestHarness) OTelEnabled() bool {
	return h.Jaeger != nil
}

// IsOTelRequested returns true when the INTEGRATION_TEST_OTEL env var is
// set to "true" or "1".
func IsOTelRequested() bool {
	v := os.Getenv("INTEGRATION_TEST_OTEL")
	return v == "true" || v == "1"
}

// OutputDir returns the root test output directory.
func (h *TestHarness) OutputDir() string {
	return h.outputDir
}

// LogDir returns the directory where service logs are written.
func (h *TestHarness) LogDir() string {
	return filepath.Join(h.outputDir, "logs")
}

// LogPaths returns the file paths of all service logs that exist on disk.
func (h *TestHarness) LogPaths() []string {
	var paths []string
	if h.Service != nil && h.Service.LogPath() != "" {
		paths = append(paths, h.Service.LogPath())
	}
	if h.UnifiedRunner != nil && h.UnifiedRunner.LogPath() != "" {
		paths = append(paths, h.UnifiedRunner.LogPath())
	}
	return paths
}

// Start brings up all infrastructure and services in the correct order.
// Call Stop in a defer to clean up.
func Start(ctx context.Context, cfg Config) (*TestHarness, error) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

	outputDir := cfg.OutputDir
	if outputDir == "" {
		outputDir = ".test-output"
	}
	logDir := filepath.Join(outputDir, "logs")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return nil, fmt.Errorf("create log output directory %s: %w", logDir, err)
	}

	h := &TestHarness{outputDir: outputDir, logger: logger}

	logger.Info("starting test infrastructure", "output_dir", outputDir)

	otelEnabled := IsOTelRequested()

	var mongoErr, redisErr, temporalErr, minioErr, jaegerErr error
	var wg sync.WaitGroup

	startCount := 4
	if otelEnabled {
		startCount = 5
	}
	wg.Add(startCount)

	go func() {
		defer wg.Done()
		logger.Info("starting mongodb")
		h.Mongo, mongoErr = StartMongo(ctx)
		if mongoErr == nil {
			logger.Info("mongodb ready", "uri", h.Mongo.URI)
		}
	}()

	go func() {
		defer wg.Done()
		logger.Info("starting redis")
		h.Redis, redisErr = StartRedis(ctx)
		if redisErr == nil {
			logger.Info("redis ready", "host", h.Redis.Host, "port", h.Redis.Port)
		}
	}()

	go func() {
		defer wg.Done()
		logger.Info("starting temporal dev server")
		h.Temporal, temporalErr = StartTemporal(ctx)
		if temporalErr == nil {
			logger.Info("temporal ready", "address", h.Temporal.Address())
		}
	}()

	go func() {
		defer wg.Done()
		logger.Info("starting minio")
		h.MinIO, minioErr = StartMinIO(ctx)
		if minioErr == nil {
			logger.Info("minio ready", "endpoint", h.MinIO.Endpoint)
		}
	}()

	if otelEnabled {
		go func() {
			defer wg.Done()
			logger.Info("starting jaeger (INTEGRATION_TEST_OTEL=true)")
			h.Jaeger, jaegerErr = StartJaeger(ctx)
			if jaegerErr == nil {
				logger.Info("jaeger ready",
					"otlp", h.Jaeger.OTLPAddress,
					"query", h.Jaeger.QueryURL,
				)
			}
		}()
	}

	wg.Wait()

	if mongoErr != nil {
		h.Stop(ctx)
		return nil, fmt.Errorf("mongodb: %w", mongoErr)
	}
	if redisErr != nil {
		h.Stop(ctx)
		return nil, fmt.Errorf("redis: %w", redisErr)
	}
	if temporalErr != nil {
		h.Stop(ctx)
		return nil, fmt.Errorf("temporal: %w", temporalErr)
	}
	if minioErr != nil {
		h.Stop(ctx)
		return nil, fmt.Errorf("minio: %w", minioErr)
	}
	if jaegerErr != nil {
		h.Stop(ctx)
		return nil, fmt.Errorf("jaeger: %w", jaegerErr)
	}

	// Start OpenFGA if the model directory and CLI are available.
	// This is opt-in: tests degrade gracefully when FGA is unavailable.
	fgaModelDir := FindFGAModelDir()
	if fgaModelDir != "" && IsFGACLIAvailable() {
		logger.Info("starting openfga", "model_dir", fgaModelDir)
		var err error
		h.OpenFGA, err = StartOpenFGA(ctx, fgaModelDir)
		if err != nil {
			h.Stop(ctx)
			return nil, fmt.Errorf("openfga: %w", err)
		}
		logger.Info("openfga ready",
			"endpoint", h.OpenFGA.HTTPEndpoint,
			"store_id", h.OpenFGA.StoreID,
			"model_id", h.OpenFGA.ModelID,
		)
	} else {
		if fgaModelDir == "" {
			logger.Warn("openfga skipped: FGA model directory not found (set STIGMER_FGA_MODEL_DIR or ensure stigmer-cloud is a sibling repo)")
		} else {
			logger.Warn("openfga skipped: fga CLI not on PATH (install with: brew install openfga/tap/fga)")
		}
	}

	logger.Info("all infrastructure ready")
	return h, nil
}

// Stop tears down all services and infrastructure in reverse order.
func (h *TestHarness) Stop(ctx context.Context) {
	h.logger.Info("stopping test infrastructure")

	if h.UnifiedRunner != nil {
		if err := h.UnifiedRunner.Stop(); err != nil {
			h.logger.Error("failed to stop unified-runner", "error", err)
		}
	}

	if h.Service != nil {
		if err := h.Service.Stop(); err != nil {
			h.logger.Error("failed to stop java service", "error", err)
		}
	}

	if h.OpenFGA != nil {
		if err := StopContainer(ctx, h.OpenFGA.Container); err != nil {
			h.logger.Error("failed to stop openfga", "error", err)
		}
	}

	if h.Jaeger != nil {
		if err := StopContainer(ctx, h.Jaeger.Container); err != nil {
			h.logger.Error("failed to stop jaeger", "error", err)
		}
	}

	if h.MinIO != nil {
		if err := StopContainer(ctx, h.MinIO.Container); err != nil {
			h.logger.Error("failed to stop minio", "error", err)
		}
	}

	if h.Temporal != nil {
		if err := h.Temporal.Stop(); err != nil {
			h.logger.Error("failed to stop temporal", "error", err)
		}
	}

	if h.Redis != nil {
		if err := StopContainer(ctx, h.Redis.Container); err != nil {
			h.logger.Error("failed to stop redis", "error", err)
		}
	}

	if h.Mongo != nil {
		if err := StopContainer(ctx, h.Mongo.Container); err != nil {
			h.logger.Error("failed to stop mongodb", "error", err)
		}
	}

	h.logger.Info("test infrastructure stopped")
}
