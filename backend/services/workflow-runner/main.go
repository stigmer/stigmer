/*
 * Copyright 2026 Leftbin/Stigmer
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package main

import (
	"fmt"
	"os"
	"os/signal"
	"runtime/debug"
	"strconv"
	"sync"
	"syscall"

	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/config"
	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/env"
	grpcserver "github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/grpc"
	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/worker"
	workerConfig "github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/worker/config"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

const (
	EnvVarPort          = "GRPC_PORT"
	EnvVarExecutionMode = "EXECUTION_MODE"
	DefaultPort         = 8080
)

// ExecutionMode defines how the workflow-runner operates
type ExecutionMode string

const (
	// ModeGrpc runs only the gRPC server (for local testing/debugging)
	ModeGrpc ExecutionMode = "grpc"

	// ModeTemporal runs only the Temporal worker (production mode)
	ModeTemporal ExecutionMode = "temporal"

	// ModeDual runs both gRPC server and Temporal worker simultaneously
	ModeDual ExecutionMode = "dual"
)

func main() {
	defer func() {
		if r := recover(); r != nil {
			log.Error().
				Interface("panic", r).
				Str("stack", string(debug.Stack())).
				Msg("Recovered from panic in main")
		}
	}()

	// Load .env file for local development (optional - fails silently in production)
	env.Load()

	// Setup logging
	setupLogging()

	// Get execution mode from environment
	mode := getExecutionMode()
	log.Info().Str("mode", string(mode)).Msg("Starting workflow-runner")

	// Get port for gRPC server (if needed)
	port := getPort()

	// Start based on mode
	if err := startWithMode(mode, port); err != nil {
		log.Fatal().Err(err).Msg("Failed to start workflow-runner")
	}
}

// getExecutionMode returns the execution mode from environment variable
func getExecutionMode() ExecutionMode {
	modeStr := os.Getenv(EnvVarExecutionMode)
	if modeStr == "" {
		// Default to gRPC mode for local development
		log.Info().Msg("EXECUTION_MODE not set, defaulting to 'grpc' for local development")
		return ModeGrpc
	}

	mode := ExecutionMode(modeStr)
	switch mode {
	case ModeGrpc, ModeTemporal, ModeDual:
		return mode
	default:
		log.Warn().
			Str("mode", modeStr).
			Msg("Invalid execution mode, defaulting to 'grpc'. Valid modes: grpc, temporal, dual")
		return ModeGrpc
	}
}

// getPort gets the gRPC server port from environment
func getPort() int {
	portStr := os.Getenv(EnvVarPort)
	if portStr == "" {
		return DefaultPort
	}

	port, err := strconv.Atoi(portStr)
	if err != nil {
		log.Warn().
			Str("port_str", portStr).
			Err(err).
			Msgf("Invalid %s, using default %d", EnvVarPort, DefaultPort)
		return DefaultPort
	}

	return port
}

// startWithMode starts the service in the specified mode
func startWithMode(mode ExecutionMode, port int) error {
	switch mode {
	case ModeGrpc:
		return startGrpcServer(port)
	case ModeTemporal:
		return startTemporalWorker()
	case ModeDual:
		return startBothModes(port)
	default:
		return fmt.Errorf("unknown execution mode: %s", mode)
	}
}

// startGrpcServer starts only the gRPC server
func startGrpcServer(port int) error {
	defer func() {
		if r := recover(); r != nil {
			log.Fatal().
				Interface("panic", r).
				Str("stack", string(debug.Stack())).
				Msg("Recovered from panic in gRPC server")
		}
	}()

	log.Info().Msg("Starting in gRPC-only mode")

	// Load Stigmer Service configuration (for callbacks)
	stigmerConfig, err := config.LoadStigmerConfig()
	if err != nil {
		return fmt.Errorf("failed to load Stigmer Service configuration: %w", err)
	}

	log.Info().
		Str("endpoint", stigmerConfig.Endpoint).
		Bool("tls", stigmerConfig.UseTLS).
		Msg("Loaded Stigmer Service configuration")

	// Create gRPC server without Temporal client (gRPC-only mode)
	server := grpcserver.NewServer(stigmerConfig, nil, "")

	// Setup graceful shutdown
	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGINT, syscall.SIGTERM)

	// Start server in goroutine
	go func() {
		if err := server.Start(port); err != nil {
			log.Fatal().Err(err).Msg("Failed to start gRPC server")
		}
	}()

	log.Info().Int("port", port).Msg("gRPC server started")

	// Wait for shutdown signal
	<-done
	log.Info().Msg("Received shutdown signal")

	// Graceful shutdown
	server.Stop()
	log.Info().Msg("gRPC server stopped")

	return nil
}

// startTemporalWorker starts only the Temporal worker
func startTemporalWorker() error {
	log.Info().Msg("Starting in Temporal-only mode")

	// Load Temporal worker configuration
	cfg, err := workerConfig.LoadFromEnv()
	if err != nil {
		return fmt.Errorf("failed to load worker config: %w", err)
	}

	log.Info().
		Str("address", cfg.TemporalServiceAddress).
		Str("namespace", cfg.TemporalNamespace).
		Str("orchestration_queue", cfg.OrchestrationTaskQueue).
		Str("execution_queue", cfg.ExecutionTaskQueue).
		Int("max_concurrency", cfg.MaxConcurrency).
		Msg("Loaded Temporal configuration")

	// Create and configure worker
	zigflowWorker, err := worker.NewZigflowWorker(cfg)
	if err != nil {
		return fmt.Errorf("failed to create Temporal worker: %w", err)
	}
	defer zigflowWorker.Stop()

	// Register workflows and activities (Phase 3)
	zigflowWorker.RegisterWorkflowsAndActivities()

	log.Info().Msg("Temporal worker configured and ready")

	// Start worker (blocking)
	return zigflowWorker.Start()
}

// startBothModes starts both gRPC server and Temporal worker concurrently
func startBothModes(port int) error {
	log.Info().Msg("Starting in dual mode (gRPC + Temporal)")

	// Load configurations
	stigmerConfig, err := config.LoadStigmerConfig()
	if err != nil {
		return fmt.Errorf("failed to load Stigmer Service configuration: %w", err)
	}

	log.Info().
		Str("endpoint", stigmerConfig.Endpoint).
		Bool("tls", stigmerConfig.UseTLS).
		Msg("Loaded Stigmer Service configuration")

	temporalConfig, err := workerConfig.LoadFromEnv()
	if err != nil {
		return fmt.Errorf("failed to load Temporal configuration: %w", err)
	}

	log.Info().
		Str("address", temporalConfig.TemporalServiceAddress).
		Str("namespace", temporalConfig.TemporalNamespace).
		Str("orchestration_queue", temporalConfig.OrchestrationTaskQueue).
		Str("execution_queue", temporalConfig.ExecutionTaskQueue).
		Int("max_concurrency", temporalConfig.MaxConcurrency).
		Msg("Loaded Temporal configuration")

	// Create Temporal worker
	zigflowWorker, err := worker.NewZigflowWorker(temporalConfig)
	if err != nil {
		return fmt.Errorf("failed to create Temporal worker: %w", err)
	}
	defer zigflowWorker.Stop()

	// Register workflows and activities
	zigflowWorker.RegisterWorkflowsAndActivities()

	// Get Temporal client from worker (for gRPC server to start workflows)
	temporalClient := zigflowWorker.GetTemporalClient()

	log.Info().Msg("Temporal worker configured and ready")

	// Create gRPC server WITH Temporal client (enables Temporal workflow triggers)
	// Use EXECUTION queue for direct workflow execution (ExecuteServerlessWorkflow)
	// Note: OrchestrationTaskQueue is for Java→Go activity calls (ExecuteWorkflowActivity)
	grpcServer := grpcserver.NewServer(stigmerConfig, temporalClient, temporalConfig.ExecutionTaskQueue)

	log.Info().Msg("gRPC server created with Temporal client")

	// Setup signal handling for graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	var wg sync.WaitGroup
	errChan := make(chan error, 2)

	// Start gRPC server in goroutine
	wg.Add(1)
	go func() {
		defer wg.Done()
		log.Info().Int("port", port).Msg("Starting gRPC server...")
		if err := grpcServer.Start(port); err != nil {
			errChan <- fmt.Errorf("gRPC server failed: %w", err)
		}
	}()

	// Start Temporal worker in goroutine
	wg.Add(1)
	go func() {
		defer wg.Done()
		log.Info().Msg("Starting Temporal worker...")
		if err := zigflowWorker.Start(); err != nil {
			errChan <- fmt.Errorf("Temporal worker failed: %w", err)
		}
	}()

	log.Info().Msg("✅ Both gRPC server and Temporal worker started successfully")

	// Wait for either an error or shutdown signal
	select {
	case err := <-errChan:
		log.Error().Err(err).Msg("One of the services failed")
		grpcServer.Stop()
		return err
	case sig := <-sigChan:
		log.Info().
			Str("signal", sig.String()).
			Msg("Received shutdown signal, stopping both services...")
		grpcServer.Stop()
		// zigflowWorker.Stop() will be called by defer
		return nil
	}
}

// setupLogging configures zerolog
func setupLogging() {
	// Set log level from environment
	logLevel := os.Getenv("LOG_LEVEL")
	if logLevel == "" {
		logLevel = "info"
	}

	level, err := zerolog.ParseLevel(logLevel)
	if err != nil {
		level = zerolog.InfoLevel
	}

	zerolog.SetGlobalLevel(level)

	// Pretty logging for development
	if os.Getenv("ENV") == "local" {
		log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})
	}

	log.Info().Str("level", level.String()).Msg("Logging configured")
}
