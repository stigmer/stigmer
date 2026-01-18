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
	environmentcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/controllers/environment"
	executioncontextcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/controllers/executioncontext"
	sessioncontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/controllers/session"
	skillcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/controllers/skill"
	workflowcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/controllers/workflow"
	workflowinstancecontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/controllers/workflowinstance"
	agentclient "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agent"
	agentinstanceclient "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agentinstance"
	sessionclient "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/session"
	workflowinstanceclient "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflowinstance"
	agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
	agentexecutionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agentexecution/v1"
	agentinstancev1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agentinstance/v1"
	environmentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/environment/v1"
	executioncontextv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/executioncontext/v1"
	sessionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/session/v1"
	skillv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/workflow/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/workflowinstance/v1"
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

	// Create and register Session controller
	sessionController := sessioncontroller.NewSessionController(store)
	sessionv1.RegisterSessionCommandControllerServer(grpcServer, sessionController)
	sessionv1.RegisterSessionQueryControllerServer(grpcServer, sessionController)

	log.Info().Msg("Registered Session controllers")

	// Create and register Environment controller
	environmentController := environmentcontroller.NewEnvironmentController(store)
	environmentv1.RegisterEnvironmentCommandControllerServer(grpcServer, environmentController)
	environmentv1.RegisterEnvironmentQueryControllerServer(grpcServer, environmentController)

	log.Info().Msg("Registered Environment controllers")

	// Create and register ExecutionContext controller
	executionContextController := executioncontextcontroller.NewExecutionContextController(store)
	executioncontextv1.RegisterExecutionContextCommandControllerServer(grpcServer, executionContextController)
	executioncontextv1.RegisterExecutionContextQueryControllerServer(grpcServer, executionContextController)

	log.Info().Msg("Registered ExecutionContext controllers")

	// Create and register Skill controller
	skillController := skillcontroller.NewSkillController(store)
	skillv1.RegisterSkillCommandControllerServer(grpcServer, skillController)
	skillv1.RegisterSkillQueryControllerServer(grpcServer, skillController)

	log.Info().Msg("Registered Skill controllers")

	// Create and register WorkflowInstance controller
	workflowInstanceController := workflowinstancecontroller.NewWorkflowInstanceController(store)
	workflowinstancev1.RegisterWorkflowInstanceCommandControllerServer(grpcServer, workflowInstanceController)
	workflowinstancev1.RegisterWorkflowInstanceQueryControllerServer(grpcServer, workflowInstanceController)

	log.Info().Msg("Registered WorkflowInstance controllers")
	
	// All services must be registered BEFORE starting the server or creating connections

	// Create downstream clients for in-process gRPC calls
	// These clients ensure single source of truth through the full interceptor chain
	var (
		agentClient            *agentclient.Client
		agentInstanceClient    *agentinstanceclient.Client
		sessionClient          *sessionclient.Client
		workflowInstanceClient *workflowinstanceclient.Client
	)
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

		// Create downstream clients (all controllers are registered above)
		agentClient = agentclient.NewClient(inProcessConn)
		agentInstanceClient = agentinstanceclient.NewClient(inProcessConn)
		sessionClient = sessionclient.NewClient(inProcessConn)
		workflowInstanceClient = workflowinstanceclient.NewClient(inProcessConn)

		log.Info().Msg("Created in-process gRPC clients for Agent, AgentInstance, Session, and WorkflowInstance")
	}

	// Create and register Agent controller (with AgentInstance client for default instance creation)
	agentController := agent.NewAgentController(store, agentInstanceClient)
	agentv1.RegisterAgentCommandControllerServer(grpcServer, agentController)
	agentv1.RegisterAgentQueryControllerServer(grpcServer, agentController)

	log.Info().Msg("Registered Agent controllers")

	// Create and register AgentExecution controller
	// Note: All downstream calls use in-process gRPC clients for single source of truth
	agentExecutionController := agentexecutioncontroller.NewAgentExecutionController(
		store,
		agentClient,
		agentInstanceClient,
		sessionClient,
	)
	agentexecutionv1.RegisterAgentExecutionCommandControllerServer(grpcServer, agentExecutionController)
	agentexecutionv1.RegisterAgentExecutionQueryControllerServer(grpcServer, agentExecutionController)

	log.Info().Msg("Registered AgentExecution controllers")

	// Create and register Workflow controller (with WorkflowInstance client for default instance creation)
	workflowController := workflowcontroller.NewWorkflowController(store, workflowInstanceClient)
	workflowv1.RegisterWorkflowCommandControllerServer(grpcServer, workflowController)
	workflowv1.RegisterWorkflowQueryControllerServer(grpcServer, workflowController)

	log.Info().Msg("Registered Workflow controllers")

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
