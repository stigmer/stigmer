package main

import (
	"context"
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
	agentexecutioncontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/controllers/agentexecution"
	agentinstancecontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/controllers/agentinstance"
	agentinstanceclient "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agentinstance"
	agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
	agentexecutionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agentexecution/v1"
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

	// Create gRPC server with apiresource interceptor and in-process support
	// The interceptor automatically extracts api_resource_kind from proto service descriptors
	// and injects it into the request context for use by pipeline steps
	// In-process support enables internal service calls through full gRPC stack (with interceptors)
	server := grpclib.NewServer(
		grpclib.WithUnaryInterceptor(apiresourceinterceptor.UnaryServerInterceptor()),
		grpclib.WithInProcess(), // Enable in-process gRPC for internal calls
	)
	grpcServer := server.GRPCServer()

	// Create and register AgentInstance controller
	agentInstanceController := agentinstancecontroller.NewAgentInstanceController(store)
	agentinstancev1.RegisterAgentInstanceCommandControllerServer(grpcServer, agentInstanceController)
	agentinstancev1.RegisterAgentInstanceQueryServiceServer(grpcServer, agentInstanceController)

	log.Info().Msg("Registered AgentInstance controllers")

	// TODO: Register Session controller here (needed for AgentExecution auto-create session)
	// sessionController := sessioncontroller.NewSessionController(store)
	// sessionv1.RegisterSessionCommandControllerServer(grpcServer, sessionController)
	// sessionv1.RegisterSessionQueryServiceServer(grpcServer, sessionController)
	
	// TODO: Register other controllers here (Workflow, Skill, Environment)
	// All services must be registered BEFORE starting the server or creating connections

	// Create in-process AgentInstance client for downstream calls
	// The in-process server will be started automatically when Start() is called
	// Note: We create this client BEFORE starting the server, but it will work because
	// the connection is established lazily when the first RPC is made
	var agentInstanceClient *agentinstanceclient.Client
	{
		// Start in-process gRPC server (must be done before creating connections)
		if err := server.StartInProcess(); err != nil {
			log.Fatal().Err(err).Msg("Failed to start in-process gRPC server")
		}

		// Create in-process gRPC connection
		// This connection goes through all gRPC interceptors (validation, logging, etc.)
		// even though it's in-process, ensuring consistent behavior with network calls
		inProcessConn, err := server.NewInProcessConnection(context.Background())
		if err != nil {
			log.Fatal().Err(err).Msg("Failed to create in-process gRPC connection")
		}
		defer inProcessConn.Close()

		// Create AgentInstance client (controller is registered above)
		agentInstanceClient = agentinstanceclient.NewClient(inProcessConn)
	}

	// Create and register Agent controller (with AgentInstance client for default instance creation)
	agentController := agent.NewAgentController(store, agentInstanceClient)
	agentv1.RegisterAgentCommandControllerServer(grpcServer, agentController)
	agentv1.RegisterAgentQueryControllerServer(grpcServer, agentController)

	log.Info().Msg("Registered Agent controllers")

	// Create and register AgentExecution controller
	// Note: Passing nil for sessionClient (Session controller not yet implemented)
	// AgentExecution will fall back to direct store access for session creation
	// TODO: Once Session controller is implemented, create and pass session client:
	//   sessionClient := sessionclient.NewClient(inProcessConn)
	agentExecutionController := agentexecutioncontroller.NewAgentExecutionController(
		store,
		agentInstanceClient,
		nil, // sessionClient - will be created once Session controller is implemented
	)
	agentexecutionv1.RegisterAgentExecutionCommandControllerServer(grpcServer, agentExecutionController)
	agentexecutionv1.RegisterAgentExecutionQueryControllerServer(grpcServer, agentExecutionController)

	log.Info().Msg("Registered AgentExecution controllers")

	// Setup graceful shutdown
	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGINT, syscall.SIGTERM)

	// Start network server in goroutine
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
