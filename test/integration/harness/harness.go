package harness

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"sync"
)

// TestHarness orchestrates all infrastructure and services needed for
// integration tests against the Stigmer Cloud Java service.
type TestHarness struct {
	Mongo          *MongoContainer
	Redis          *RedisContainer
	Temporal       *TemporalDevServer
	Service        *JavaService
	WorkflowRunner *WorkflowRunner

	logger *slog.Logger
}

type Config struct {
	// StigmerServiceJar is the path to the stigmer-service fat JAR.
	// If empty, the harness will attempt to find it relative to
	// the stigmer-cloud repo checkout.
	StigmerServiceJar string

	// StigmerCloudRoot is the path to the stigmer-cloud repo root.
	// Defaults to ../../../../stigmer-cloud relative to this module.
	StigmerCloudRoot string
}

func DefaultConfig() Config {
	return Config{}
}

// Start brings up all infrastructure and services in the correct order.
// Call Stop in a defer to clean up.
func Start(ctx context.Context, cfg Config) (*TestHarness, error) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	h := &TestHarness{logger: logger}

	logger.Info("starting test infrastructure")

	var mongoErr, redisErr, temporalErr error
	var wg sync.WaitGroup

	wg.Add(3)
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

	logger.Info("all infrastructure ready")
	return h, nil
}

// Stop tears down all services and infrastructure in reverse order.
func (h *TestHarness) Stop(ctx context.Context) {
	h.logger.Info("stopping test infrastructure")

	if h.WorkflowRunner != nil {
		if err := h.WorkflowRunner.Stop(); err != nil {
			h.logger.Error("failed to stop workflow-runner", "error", err)
		}
	}

	if h.Service != nil {
		if err := h.Service.Stop(); err != nil {
			h.logger.Error("failed to stop java service", "error", err)
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
