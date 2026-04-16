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
	"runtime/debug"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/dotenv"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/worker"
	workerConfig "github.com/stigmer/stigmer/backend/services/workflow-runner/worker/config"
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
	dotenv.Load()

	// Setup logging
	setupLogging()

	log.Info().Msg("Starting workflow-runner (Temporal worker)")

	// Start Temporal worker
	if err := startTemporalWorker(); err != nil {
		log.Fatal().Err(err).Msg("Failed to start workflow-runner")
	}
}

// startTemporalWorker starts the Temporal worker
func startTemporalWorker() error {
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

	// Register workflows and activities
	zigflowWorker.RegisterWorkflowsAndActivities()

	log.Info().Msg("Temporal worker configured and ready")

	// Start worker (blocking)
	return zigflowWorker.Start()
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
