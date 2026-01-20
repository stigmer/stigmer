package main

import (
	"context"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	agentexecutiontemporal "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal"
	workflowexecutiontemporal "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal"
	workflowexecutionworkflows "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/workflows"
	workflowtemporal "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/temporal"
	"go.temporal.io/sdk/client"
	temporallog "go.temporal.io/sdk/log"
	"go.temporal.io/sdk/worker"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/config"
	agentcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agent/controller"
	agentexecutioncontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/controller"
	agentinstancecontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentinstance/controller"
	environmentcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/environment/controller"
	executioncontextcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/executioncontext/controller"
	sessioncontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/session/controller"
	skillcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/skill/controller"
	workflowcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/controller"
	workflowexecutioncontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/controller"
	workflowinstancecontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowinstance/controller"
	agentclient "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agent"
	agentinstanceclient "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agentinstance"
	sessionclient "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/session"
	workflowclient "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflow"
	workflowinstanceclient "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflowinstance"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
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

	// ============================================================================
	// Initialize Temporal client and workers
	// ============================================================================

	// Create Temporal client
	// Configure with a no-op logger to suppress "No logger configured" warnings
	// Use slog with discard handler to suppress Temporal SDK log output
	temporalClient, err := client.Dial(client.Options{
		HostPort:  cfg.TemporalHostPort,
		Namespace: cfg.TemporalNamespace,
		Logger:    temporallog.NewStructuredLogger(slog.New(slog.NewTextHandler(io.Discard, nil))),
	})
	if err != nil {
		log.Warn().
			Err(err).
			Str("host_port", cfg.TemporalHostPort).
			Str("namespace", cfg.TemporalNamespace).
			Msg("Failed to connect to Temporal server - workflows will not execute")
		temporalClient = nil // Set to nil, check before using
	} else {
		defer temporalClient.Close()
		log.Info().
			Str("host_port", cfg.TemporalHostPort).
			Str("namespace", cfg.TemporalNamespace).
			Msg("Connected to Temporal server")
	}

	// Create workflow execution worker and workflow creator (conditional on client success)
	var workflowExecutionWorker worker.Worker
	var workflowExecutionWorkflowCreator *workflowexecutionworkflows.InvokeWorkflowExecutionWorkflowCreator

	// Create agent execution worker and workflow creator (conditional on client success)
	var agentExecutionWorker worker.Worker
	var agentExecutionWorkflowCreator *agentexecutiontemporal.InvokeAgentExecutionWorkflowCreator

	// Create workflow validation worker and validator (conditional on client success)
	var workflowValidationWorker worker.Worker
	var workflowValidator *workflowtemporal.ServerlessWorkflowValidator

	if temporalClient != nil {
		// Load Temporal configuration for workflow execution
		workflowExecutionTemporalConfig := workflowexecutiontemporal.LoadConfig()

		// Create worker configuration
		workerConfig := workflowexecutiontemporal.NewWorkerConfig(
			workflowExecutionTemporalConfig,
			store,
		)

		// Create worker (not started yet)
		workflowExecutionWorker = workerConfig.CreateWorker(temporalClient)

		// Create workflow creator (for controller injection)
		workflowExecutionWorkflowCreator = workflowexecutionworkflows.NewInvokeWorkflowExecutionWorkflowCreator(
			temporalClient,
			workflowExecutionTemporalConfig.StigmerQueue,
			workflowExecutionTemporalConfig.RunnerQueue,
		)

		log.Info().
			Str("stigmer_queue", workflowExecutionTemporalConfig.StigmerQueue).
			Str("runner_queue", workflowExecutionTemporalConfig.RunnerQueue).
			Msg("Created workflow execution worker and creator")

		// Load Temporal configuration for agent execution
		agentExecutionTemporalConfig := agentexecutiontemporal.NewConfig()

		// Create worker configuration
		agentExecutionWorkerConfig := agentexecutiontemporal.NewWorkerConfig(
			agentExecutionTemporalConfig,
			store,
		)

		// Create worker (not started yet)
		agentExecutionWorker = agentExecutionWorkerConfig.CreateWorker(temporalClient)

		// Create workflow creator (for controller injection)
		agentExecutionWorkflowCreator = agentexecutiontemporal.NewInvokeAgentExecutionWorkflowCreator(
			temporalClient,
			agentExecutionTemporalConfig,
		)

		log.Info().
			Str("stigmer_queue", agentExecutionTemporalConfig.StigmerQueue).
			Str("runner_queue", agentExecutionTemporalConfig.RunnerQueue).
			Msg("Created agent execution worker and creator")

	// Load Temporal configuration for workflow validation
	workflowValidationTemporalConfig := workflowtemporal.NewConfig()

	// Create worker configuration
	workflowValidationWorkerConfig := workflowtemporal.NewWorkerConfig(
		workflowValidationTemporalConfig,
	)

	// Create worker (not started yet)
	workflowValidationWorker = workflowValidationWorkerConfig.CreateWorker(temporalClient)

	// Create workflow validator (for controller injection)
	workflowValidator = workflowtemporal.NewServerlessWorkflowValidator(
		temporalClient,
		workflowValidationTemporalConfig,
	)

	log.Info().
		Str("stigmer_queue", workflowValidationTemporalConfig.StigmerQueue).
		Str("runner_queue", workflowValidationTemporalConfig.RunnerQueue).
		Msg("Created workflow validation worker and validator")
	}

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

	// Create and register Agent controller (without dependencies initially)
	agentController := agentcontroller.NewAgentController(store, nil)
	agentv1.RegisterAgentCommandControllerServer(grpcServer, agentController)
	agentv1.RegisterAgentQueryControllerServer(grpcServer, agentController)

	log.Info().Msg("Registered Agent controllers")

	// Create and register AgentExecution controller (without dependencies initially)
	agentExecutionController := agentexecutioncontroller.NewAgentExecutionController(
		store,
		nil, // agentClient - will be set after in-process server starts
		nil, // agentInstanceClient - will be set after in-process server starts
		nil, // sessionClient - will be set after in-process server starts
	)
	agentexecutionv1.RegisterAgentExecutionCommandControllerServer(grpcServer, agentExecutionController)
	agentexecutionv1.RegisterAgentExecutionQueryControllerServer(grpcServer, agentExecutionController)

	log.Info().Msg("Registered AgentExecution controllers")

	// Create and register Workflow controller (with validator if Temporal available)
	workflowController := workflowcontroller.NewWorkflowController(store, nil, workflowValidator)
	workflowv1.RegisterWorkflowCommandControllerServer(grpcServer, workflowController)
	workflowv1.RegisterWorkflowQueryControllerServer(grpcServer, workflowController)

	log.Info().Msg("Registered Workflow controllers")

	// Create and register WorkflowInstance controller (without dependencies initially)
	workflowInstanceController := workflowinstancecontroller.NewWorkflowInstanceController(store, nil)
	workflowinstancev1.RegisterWorkflowInstanceCommandControllerServer(grpcServer, workflowInstanceController)
	workflowinstancev1.RegisterWorkflowInstanceQueryControllerServer(grpcServer, workflowInstanceController)

	log.Info().Msg("Registered WorkflowInstance controllers")

	// Create and register WorkflowExecution controller (without dependencies initially)
	workflowExecutionController := workflowexecutioncontroller.NewWorkflowExecutionController(
		store,
		nil, // workflowInstanceClient - will be set after in-process server starts
	)
	workflowexecutionv1.RegisterWorkflowExecutionCommandControllerServer(grpcServer, workflowExecutionController)
	workflowexecutionv1.RegisterWorkflowExecutionQueryControllerServer(grpcServer, workflowExecutionController)

	log.Info().Msg("Registered WorkflowExecution controllers")

	// ============================================================================
	// CRITICAL: All services MUST be registered BEFORE starting the server
	// ============================================================================

	// Start in-process gRPC server (must be done AFTER all service registrations)
	if err := server.StartInProcess(); err != nil {
		log.Fatal().Err(err).Msg("Failed to start in-process gRPC server")
	}

	// ============================================================================
	// Start Temporal workers (after gRPC services ready)
	// ============================================================================

	if workflowExecutionWorker != nil {
		if err := workflowExecutionWorker.Start(); err != nil {
			log.Fatal().
				Err(err).
				Msg("Failed to start workflow execution worker")
		}
		defer workflowExecutionWorker.Stop()
		log.Info().Msg("Workflow execution worker started")
	}

	if agentExecutionWorker != nil {
		if err := agentExecutionWorker.Start(); err != nil {
			log.Fatal().
				Err(err).
				Msg("Failed to start agent execution worker")
		}
		defer agentExecutionWorker.Stop()
		log.Info().Msg("Agent execution worker started")
	}

	if workflowValidationWorker != nil {
		if err := workflowValidationWorker.Start(); err != nil {
			log.Fatal().
				Err(err).
				Msg("Failed to start workflow validation worker")
		}
		defer workflowValidationWorker.Stop()
		log.Info().Msg("Workflow validation worker started")
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
	agentClient := agentclient.NewClient(inProcessConn)
	agentInstanceClient := agentinstanceclient.NewClient(inProcessConn)
	sessionClient := sessionclient.NewClient(inProcessConn)
	workflowClient := workflowclient.NewClient(inProcessConn)
	workflowInstanceClient := workflowinstanceclient.NewClient(inProcessConn)

	log.Info().Msg("Created in-process gRPC clients for Agent, AgentInstance, Session, Workflow, and WorkflowInstance")

	// Now inject dependencies into controllers that need them
	// Note: Controllers are already registered, we're just updating their internal state
	agentController.SetAgentInstanceClient(agentInstanceClient)
	agentExecutionController.SetClients(agentClient, agentInstanceClient, sessionClient)
	workflowController.SetWorkflowInstanceClient(workflowInstanceClient)
	workflowInstanceController.SetWorkflowClient(workflowClient)
	workflowExecutionController.SetWorkflowInstanceClient(workflowInstanceClient)

	// Inject workflow creators (nil-safe, controllers handle gracefully)
	workflowExecutionController.SetWorkflowCreator(workflowExecutionWorkflowCreator)
	agentExecutionController.SetWorkflowCreator(agentExecutionWorkflowCreator)

	log.Info().Msg("Injected dependencies into controllers")

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
