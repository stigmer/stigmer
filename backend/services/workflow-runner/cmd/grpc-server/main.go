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
	"os"
	"os/signal"
	"strconv"
	"syscall"

	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/config"
	grpcserver "github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/grpc"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func main() {
	// Setup logging
	setupLogging()

	log.Info().Msg("Starting Workflow Runner gRPC Server")

	// Load configuration
	stigmerConfig, err := config.LoadStigmerConfig()
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to load Stigmer Service configuration")
	}

	log.Info().
		Str("endpoint", stigmerConfig.Endpoint).
		Bool("tls", stigmerConfig.UseTLS).
		Msg("Loaded Stigmer Service configuration")

	// Get gRPC server port from environment
	port := getPort()

	// Create gRPC server (implements command controller - receives commands FROM Stigmer Service)
	// Note: Pass nil for temporalClient to run in gRPC-only mode (workflows executed via direct Temporal SDK)
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

	// Wait for interrupt signal
	<-done
	log.Info().Msg("Received shutdown signal")

	// Graceful shutdown
	server.Stop()
	log.Info().Msg("Workflow Runner gRPC server stopped")
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
}

// getPort gets the gRPC server port from environment
func getPort() int {
	portStr := os.Getenv("GRPC_PORT")
	if portStr == "" {
		return 8080 // Default port (matches stigmer-service)
	}

	port, err := strconv.Atoi(portStr)
	if err != nil {
		log.Warn().
			Str("port_str", portStr).
			Err(err).
			Msg("Invalid GRPC_PORT, using default 8080")
		return 8080
	}

	return port
}
