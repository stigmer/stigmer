package main

import (
	"os"
	"os/signal"
	"syscall"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/config"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/controllers/agent"
	agentinstancecontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/controllers/agentinstance"
	agentinstanceclient "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agentinstance"
	agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
	agentinstancev1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agentinstance/v1"
)

func main() {
	// Load configuration
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to load configuration")
	}

	// Setup logging
	setupLogging(cfg)

	log.Info().
		Int("grpc_port", cfg.GRPCPort).
		Str("db_path", cfg.DBPath).
		Str("env", cfg.Env).
		Msg("Starting Stigmer Server")

	// Initialize BadgerDB store (replaced SQLite per ADR-005 Revised)
	// BadgerDB is a pure Go key-value store optimized for the daemon architecture
	store, err := badger.NewStore(cfg.DBPath)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to initialize BadgerDB store")
	}
	defer store.Close()

	log.Info().Str("db_path", cfg.DBPath).Msg("BadgerDB store initialized")

	// Create gRPC server with apiresource interceptor
	// The interceptor automatically extracts api_resource_kind from proto service descriptors
	// and injects it into the request context for use by pipeline steps
	server := grpclib.NewServer(
		grpclib.WithUnaryInterceptor(apiresourceinterceptor.UnaryServerInterceptor()),
	)
	grpcServer := server.GRPCServer()

	// Create and register AgentInstance controller
	agentInstanceController := agentinstancecontroller.NewAgentInstanceController(store)
	agentinstancev1.RegisterAgentInstanceCommandControllerServer(grpcServer, agentInstanceController)
	agentinstancev1.RegisterAgentInstanceQueryServiceServer(grpcServer, agentInstanceController)

	log.Info().Msg("Registered AgentInstance controllers")

	// Create in-process AgentInstance client for downstream calls
	agentInstanceClient := agentinstanceclient.NewClient(agentInstanceController)

	// Create and register Agent controller (with AgentInstance client for default instance creation)
	agentController := agent.NewAgentController(store, agentInstanceClient)
	agentv1.RegisterAgentCommandControllerServer(grpcServer, agentController)
	agentv1.RegisterAgentQueryControllerServer(grpcServer, agentController)

	log.Info().Msg("Registered Agent controllers")

	// TODO: Register other controllers (Workflow, Skill, Environment, Session)

	// Setup graceful shutdown
	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGINT, syscall.SIGTERM)

	// Start server in goroutine
	go func() {
		if err := server.Start(cfg.GRPCPort); err != nil {
			log.Fatal().Err(err).Msg("Failed to start gRPC server")
		}
	}()

	log.Info().Int("port", cfg.GRPCPort).Msg("Stigmer Server started successfully")

	// Wait for interrupt signal
	<-done
	log.Info().Msg("Received shutdown signal")

	// Graceful shutdown
	server.Stop()
	log.Info().Msg("Stigmer Server stopped")
}

// setupLogging configures zerolog
func setupLogging(cfg *config.Config) {
	// Parse log level
	level, err := zerolog.ParseLevel(cfg.LogLevel)
	if err != nil {
		level = zerolog.InfoLevel
	}

	zerolog.SetGlobalLevel(level)

	// Pretty logging for local development
	if cfg.Env == "local" {
		log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})
	}

	// Set timestamp format
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
}
