package server

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/improbable-eng/grpc-web/go/grpcweb"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	artifactv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/artifact/v1"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	oauthappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/project/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/config"
	agentcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agent/controller"
	agentexecutioncontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/controller"
	agentexecutiontemporal "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal"
	agentinstancecontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentinstance/controller"
	artifactcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/artifact/controller"
	artifactstorage "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/artifact/storage"
	environmentcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/environment/controller"
	executioncontextcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/executioncontext/controller"
	mcpservercontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/mcpserver/controller"
	mcpserveroauth "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/mcpserver/oauth"
	oauthappcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/oauthapp/controller"
	organizationcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/organization/controller"
	projectcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/project/controller"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/project/reconcile"
	sessioncontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/session/controller"
	skillcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/skill/controller"
	skillstorage "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/skill/storage"
	workflowcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/controller"
	workflowvalidation "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/validation"
	workflowexecutioncontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/controller"
	workflowexecutiontemporal "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal"
	workflowexecutionworkflows "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/workflows"
	workflowinstancecontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowinstance/controller"
	agentclient "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agent"
	environmentclient "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/environment"
	executioncontextclient "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/executioncontext"
	mcpserverclient "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/mcpserver"
	skillclient "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/skill"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"

	// Platform service imports
	githubv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/platform/github/v1"
	platformv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/platform/v1"
	githubcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/github/controller"
	platformcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/platform/controller"

	// Search service imports
	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
	taskkindregistry "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/registry"
	agentinstanceclient "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agentinstance"
	sessionclient "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/session"
	workflowclient "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflow"
	workflowinstanceclient "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflowinstance"
	searchcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/controller"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
	searchhandler "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/handler"
	searchstore "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/store"
)

// Run starts the Stigmer server (extracted from main for BusyBox pattern)
// This allows the CLI to call this function directly instead of running a separate binary
func Run() error {
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

	// Initialize SQLite store (pure Go, no CGO dependencies)
	// SQLite provides embedded database with excellent tooling support (sqlite3 CLI, DataGrip, etc.)
	store, err := sqlite.NewStore(cfg.DBPath)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to initialize SQLite store")
	}
	defer store.Close()

	log.Info().Str("db_path", cfg.DBPath).Msg("SQLite store initialized")

	// ============================================================================
	// Create controllers early (needed for Temporal worker setup)
	// ============================================================================
	// We create these before Temporal workers so we can inject their StreamBrokers
	// into the UpdateExecutionStatusActivities. This ensures workflow error recovery
	// broadcasts status updates to active subscribers.

	// Create AgentExecutionController
	agentExecutionController := agentexecutioncontroller.NewAgentExecutionController(
		store,
		nil, // agentClient - will be set after in-process server starts
		nil, // agentInstanceClient - will be set after in-process server starts
		nil, // sessionClient - will be set after in-process server starts
	)

	log.Info().Msg("Created AgentExecution controller (for Temporal worker dependency)")

	// Create WorkflowExecutionController
	workflowExecutionController := workflowexecutioncontroller.NewWorkflowExecutionController(
		store,
		nil, // workflowInstanceClient - will be set after in-process server starts
	)

	log.Info().Msg("Created WorkflowExecution controller (for Temporal worker dependency)")

	// ============================================================================
	// Initialize Temporal connection manager
	// ============================================================================

	// Create Temporal manager for connection lifecycle and health monitoring
	temporalManager := NewTemporalManager(cfg)

	// Set dependencies for worker creation and workflow creator injection
	temporalManager.SetDependencies(
		store,
		agentExecutionController,
		workflowExecutionController,
		nil, // workflowController - will be set later
		agentExecutionController.GetStreamBroker(),
		workflowExecutionController.GetStreamBroker(),
	)

	// Attempt initial connection (non-fatal if fails)
	temporalClient := temporalManager.InitialConnect(context.Background())
	defer temporalManager.Close()

	// Load agent execution temporal config (routing mode, queue names).
	// This is needed by both the workflow creator and the execution controller
	// for dispatch routing, so it's created outside the Temporal connection block.
	agentExecutionTemporalConfig := agentexecutiontemporal.NewConfig()

	// Create in-process workflow validator (no Temporal dependency)
	workflowValidator := workflowvalidation.NewInProcessValidator()
	log.Info().Msg("Created in-process workflow validator")

	// Create workflow creators if initial connection succeeded
	var workflowExecutionWorkflowCreator *workflowexecutionworkflows.InvokeWorkflowExecutionWorkflowCreator
	var agentExecutionWorkflowCreator *agentexecutiontemporal.InvokeAgentExecutionWorkflowCreator

	if temporalClient != nil {
		// Create workflow execution workflow creator
		workflowExecutionTemporalConfig := workflowexecutiontemporal.LoadConfig()
		workflowExecutionWorkflowCreator = workflowexecutionworkflows.NewInvokeWorkflowExecutionWorkflowCreator(
			temporalClient,
			workflowExecutionTemporalConfig.StigmerQueue,
			workflowExecutionTemporalConfig.RunnerQueue,
		)

		log.Info().
			Str("stigmer_queue", workflowExecutionTemporalConfig.StigmerQueue).
			Str("runner_queue", workflowExecutionTemporalConfig.RunnerQueue).
			Msg("Created workflow execution workflow creator")

		// Create agent execution workflow creator
		agentExecutionWorkflowCreator = agentexecutiontemporal.NewInvokeAgentExecutionWorkflowCreator(
			temporalClient,
			agentExecutionTemporalConfig,
		)

		log.Info().
			Str("stigmer_queue", agentExecutionTemporalConfig.StigmerQueue).
			Str("runner_queue", agentExecutionTemporalConfig.RunnerQueue).
			Str("activity_routing", agentExecutionTemporalConfig.ActivityRouting).
			Msg("Created agent execution workflow creator")
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
	agentinstancev1.RegisterAgentInstanceQueryControllerServer(grpcServer, agentInstanceController)

	log.Info().Msg("Registered AgentInstance controllers")

	// Create and register Session controller
	sessionController := sessioncontroller.NewSessionController(store)
	sessionv1.RegisterSessionCommandControllerServer(grpcServer, sessionController)
	sessionv1.RegisterSessionQueryControllerServer(grpcServer, sessionController)

	log.Info().Msg("Registered Session controllers")

	// Create encryption service for environment secrets
	secretService, err := encryption.NewSecretServiceFromEnv()
	if err != nil {
		log.Warn().Err(err).Msg("Failed to initialize encryption - secret values will be stored in plaintext")
		secretService, _ = encryption.NewSecretService(nil)
	}

	// Create and register Environment controller
	environmentController := environmentcontroller.NewEnvironmentController(store, secretService)
	environmentv1.RegisterEnvironmentCommandControllerServer(grpcServer, environmentController)
	environmentv1.RegisterEnvironmentQueryControllerServer(grpcServer, environmentController)

	log.Info().Msg("Registered Environment controllers")

	// Create and register OAuthApp controller (reuses encryption service from Environment)
	oauthAppController := oauthappcontroller.NewOAuthAppController(store, secretService)
	oauthappv1.RegisterOAuthAppCommandControllerServer(grpcServer, oauthAppController)
	oauthappv1.RegisterOAuthAppQueryControllerServer(grpcServer, oauthAppController)

	log.Info().Msg("Registered OAuthApp controllers")

	// Create and register ExecutionContext controller
	executionContextController := executioncontextcontroller.NewExecutionContextController(store)
	executioncontextv1.RegisterExecutionContextCommandControllerServer(grpcServer, executionContextController)
	executioncontextv1.RegisterExecutionContextQueryControllerServer(grpcServer, executionContextController)

	log.Info().Msg("Registered ExecutionContext controllers")

	// Create and register Skill controller (with artifact storage)
	artifactStorage, err := skillstorage.NewLocalFileStorage(cfg.StoragePath)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to initialize skill artifact storage")
	}
	skillController := skillcontroller.NewSkillController(store, artifactStorage)
	skillv1.RegisterSkillCommandControllerServer(grpcServer, skillController)
	skillv1.RegisterSkillQueryControllerServer(grpcServer, skillController)

	log.Info().
		Str("storage_path", cfg.StoragePath).
		Msg("Registered Skill controllers with artifact storage")

	// Create artifact storage for agent execution attachments and outputs
	ctx := context.Background()
	agentExecutionArtifactStorage, err := artifactstorage.NewArtifactStorage(ctx, cfg.ArtifactStorage)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to initialize agent execution artifact storage")
	}

	// Health check the artifact storage
	if err := agentExecutionArtifactStorage.Health(ctx); err != nil {
		log.Warn().Err(err).Msg("Artifact storage health check failed - continuing with degraded functionality")
	}

	// Inject artifact storage into AgentExecutionController
	agentExecutionController.SetArtifactStorage(agentExecutionArtifactStorage)

	// Inject execution artifact storage into SkillController for pushFromExecutionArtifact
	skillController.SetExecutionArtifactStorage(agentExecutionArtifactStorage)

	log.Info().
		Str("storage_type", cfg.ArtifactStorage.Type).
		Msg("Initialized artifact storage for agent execution attachments and outputs")

	// Create and register Artifact controller (T07 Artifact Store)
	artifactController := artifactcontroller.NewArtifactController(store, agentExecutionArtifactStorage)
	artifactv1.RegisterArtifactCommandControllerServer(grpcServer, artifactController)
	artifactv1.RegisterArtifactQueryControllerServer(grpcServer, artifactController)

	log.Info().Msg("Registered Artifact controllers")

	// Create and register Agent controller (without dependencies initially)
	agentController := agentcontroller.NewAgentController(store, nil)
	agentv1.RegisterAgentCommandControllerServer(grpcServer, agentController)
	agentv1.RegisterAgentQueryControllerServer(grpcServer, agentController)

	log.Info().Msg("Registered Agent controllers")

	// Register AgentExecution controller (created earlier for Temporal worker dependency)
	agentexecutionv1.RegisterAgentExecutionCommandControllerServer(grpcServer, agentExecutionController)
	agentexecutionv1.RegisterAgentExecutionQueryControllerServer(grpcServer, agentExecutionController)

	log.Info().Msg("Registered AgentExecution controllers")

	// Create and register Workflow controller (with validator if Temporal available)
	workflowController := workflowcontroller.NewWorkflowController(store, nil, workflowValidator)

	workflowv1.RegisterWorkflowCommandControllerServer(grpcServer, workflowController)
	workflowv1.RegisterWorkflowQueryControllerServer(grpcServer, workflowController)

	// Update Temporal manager with workflow controller dependency (for validator reinjection)
	temporalManager.serverDeps.workflowController = workflowController

	log.Info().Msg("Registered Workflow controllers")

	// Create and register WorkflowInstance controller (without dependencies initially)
	workflowInstanceController := workflowinstancecontroller.NewWorkflowInstanceController(store, nil)
	workflowinstancev1.RegisterWorkflowInstanceCommandControllerServer(grpcServer, workflowInstanceController)
	workflowinstancev1.RegisterWorkflowInstanceQueryControllerServer(grpcServer, workflowInstanceController)

	log.Info().Msg("Registered WorkflowInstance controllers")

	// Register WorkflowExecution controller (created earlier for Temporal worker dependency)
	workflowexecutionv1.RegisterWorkflowExecutionCommandControllerServer(grpcServer, workflowExecutionController)
	workflowexecutionv1.RegisterWorkflowExecutionQueryControllerServer(grpcServer, workflowExecutionController)

	log.Info().Msg("Registered WorkflowExecution controllers")

	// Create and register McpServer controller
	mcpServerController := mcpservercontroller.NewMcpServerController(store)
	mcpserverv1.RegisterMcpServerCommandControllerServer(grpcServer, mcpServerController)
	mcpserverv1.RegisterMcpServerQueryControllerServer(grpcServer, mcpServerController)

	log.Info().Msg("Registered McpServer controllers")

	// Create and register Project controller
	// Pass nil for reconciliationService to use the default implementation
	projectController := projectcontroller.NewProjectController(store, nil)
	projectv1.RegisterProjectCommandControllerServer(grpcServer, projectController)
	projectv1.RegisterProjectQueryControllerServer(grpcServer, projectController)

	log.Info().Msg("Registered Project controllers")

	// Create and register Organization controller
	organizationController := organizationcontroller.NewOrganizationController(store)
	organizationv1.RegisterOrganizationCommandControllerServer(grpcServer, organizationController)
	organizationv1.RegisterOrganizationQueryControllerServer(grpcServer, organizationController)

	log.Info().Msg("Registered Organization controllers")

	// Create and register SearchService controller (CQRS Query Service)
	// The search service provides unified search across all searchable resources
	// (agents, skills, mcp_servers, workflows) using FTS5 full-text search.
	searchQueryStore := searchstore.NewSQLiteSearchQueryStore(
		store.DB(), // Get the underlying *sql.DB
		store,
		extractor.GetRegistry(),
	)
	searchHandler, err := searchhandler.NewSearchHandler(searchQueryStore)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to create SearchHandler")
	}
	searchController := searchcontroller.NewSearchController(searchHandler)
	searchv1.RegisterSearchServiceServer(grpcServer, searchController)

	// Validate that all expected extractors are registered
	extractor.GetRegistry().ValidateExpectedKinds()

	log.Info().Msg("Registered SearchService controller")

	// Create and register GitHub OAuth controller
	ghController := githubcontroller.NewGitHubController(cfg.GitHubOAuthClientID, cfg.GitHubOAuthClientSecret)
	githubv1.RegisterGitHubServiceServer(grpcServer, ghController)

	log.Info().Msg("Registered GitHubService controller")

	// Create and register Platform controller (server info / edition detection)
	platController := platformcontroller.NewPlatformController(cfg.TemporalHostPort, cfg.TemporalNamespace)
	platformv1.RegisterPlatformQueryControllerServer(grpcServer, platController)

	log.Info().Msg("Registered PlatformQueryController")

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

	if err := temporalManager.StartWorkers(temporalClient); err != nil {
		log.Warn().
			Err(err).
			Msg("Failed to start Temporal workers - health monitor will retry")
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
	mcpServerClient := mcpserverclient.NewClient(inProcessConn)
	skillClient := skillclient.NewClient(inProcessConn)
	environmentClient := environmentclient.NewClient(inProcessConn)
	executionContextClient := executioncontextclient.NewClient(inProcessConn)

	log.Info().Msg("Created in-process gRPC clients for Agent, AgentInstance, Session, Workflow, WorkflowInstance, McpServer, Skill, Environment, and ExecutionContext")

	// ============================================================================
	// Rebuild search index at startup
	// ============================================================================
	// FTS5 search index is separate from the resources table and must be
	// explicitly rebuilt. This ensures all resources (including those applied
	// by CLI-driven seedpack bootstrap) are immediately discoverable via
	// list/search after the server accepts connections.
	if indexed, err := searchQueryStore.RebuildIndex(context.Background()); err != nil {
		log.Warn().Err(err).Msg("Failed to rebuild search index at startup")
	} else {
		log.Info().Int("indexed", indexed).Msg("Search index rebuilt at startup")
	}

	// Create the reconciliation resource deleter for orphan pruning
	downstreamClients := &reconcile.DownstreamClients{
		AgentClient:     agentClient,
		WorkflowClient:  workflowClient,
		McpServerClient: mcpServerClient,
		SkillClient:     skillClient,
	}
	resourceDeleter := reconcile.NewResourceDeleterAdapter(downstreamClients)
	reconciliationService := reconcile.NewReconciliationService(store, resourceDeleter)

	// Inject ReconciliationService into ProjectController
	projectController.SetReconciliationService(reconciliationService)

	log.Info().Msg("Created reconciliation ResourceDeleter and injected into ProjectController")

	// Now inject dependencies into controllers that need them
	// Note: Controllers are already registered, we're just updating their internal state
	agentController.SetAgentInstanceClient(agentInstanceClient)
	agentExecutionController.SetClients(agentClient, agentInstanceClient, sessionClient, environmentClient, executionContextClient)
	sessionController.SetClients(agentClient, agentInstanceClient)
	workflowController.SetWorkflowInstanceClient(workflowInstanceClient)
	workflowInstanceController.SetWorkflowClient(workflowClient)
	workflowExecutionController.SetWorkflowInstanceClient(workflowInstanceClient)
	workflowExecutionController.SetEnvironmentAndExecutionContextClients(environmentClient, executionContextClient)

	// Inject workflow creators (nil-safe, controllers handle gracefully)
	workflowExecutionController.SetWorkflowCreator(workflowExecutionWorkflowCreator)
	agentExecutionController.SetWorkflowCreator(agentExecutionWorkflowCreator)
	agentExecutionController.SetTemporalConfig(agentExecutionTemporalConfig)

	// Inject Temporal client for lifecycle operations (cancel, terminate, recover, pause, resume)
	// This enables direct Temporal API calls for workflow lifecycle management
	workflowExecutionController.SetTemporalClient(temporalClient)
	agentExecutionController.SetTemporalClient(temporalClient)

	// Inject AgentExecution client for HITL approval forwarding
	// This enables WorkflowExecution.SubmitApproval to forward decisions to child agent executions
	workflowExecutionController.SetAgentExecutionClient(agentExecutionController)

	// Inject discovery dependencies into McpServerController.
	// The connect workflow runs on the runner's activity queue. In per-session
	// routing mode, the queue is derived from the session ID at connect time.
	// The Go handler creates an ephemeral ExecutionContext with resolved env
	// vars and passes its ID to the Temporal workflow. The Python activity
	// reads from the scoped ExecutionContext (least-privilege).
	if temporalClient != nil {
		mcpServerController.SetConnectDependencies(
			temporalClient,
			agentExecutionTemporalConfig,
			environmentClient,
			executionContextClient,
		)
		log.Info().
			Str("runner_queue", agentExecutionTemporalConfig.RunnerQueue).
			Str("activity_routing", agentExecutionTemporalConfig.ActivityRouting).
			Msg("Injected MCP connect dependencies into McpServerController")
	}

	// Inject OAuth dependencies into McpServerController.
	// Not gated by Temporal — initiateOAuthConnect/completeOAuthConnect
	// don't need Temporal; only the subsequent connect (tool discovery) does.
	pendingOAuthStateStore, err := mcpserveroauth.NewPendingOAuthStateStore(store.DB())
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to initialize pending OAuth state store")
	}
	oauthGrantStore, err := mcpserveroauth.NewOAuthGrantStore(store.DB())
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to initialize OAuth grant store")
	}
	mcpServerController.SetOAuthDependencies(
		oauthGrantStore,
		pendingOAuthStateStore,
		secretService,
		cfg.OAuthRedirectURI,
	)
	if cfg.OAuthRedirectURI != "" {
		log.Info().
			Str("redirect_uri", cfg.OAuthRedirectURI).
			Msg("Injected MCP OAuth dependencies into McpServerController")
	} else {
		log.Warn().Msg("STIGMER_OAUTH_REDIRECT_URI not set — MCP OAuth Connect will be unavailable")
	}

	// Inject OAuth dependencies into AgentExecutionController for
	// managed environment token injection during session creation.
	managedEnvService := mcpserveroauth.NewManagedEnvironmentService(environmentClient)
	agentExecutionController.SetOAuthDependencies(oauthGrantStore, managedEnvService)

	log.Info().Msg("Injected dependencies into controllers")

	// ============================================================================
	// Start Temporal health monitor (after all controllers are ready)
	// ============================================================================

	// Create context for health monitor lifecycle
	monitorCtx, monitorCancel := context.WithCancel(context.Background())
	defer monitorCancel()

	// Start health monitor for automatic reconnection
	temporalManager.StartHealthMonitor(monitorCtx)

	// Setup graceful shutdown
	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGINT, syscall.SIGTERM)

	// Build the gRPC-Web wrapper so browsers can talk to the API.
	// The wrapper translates gRPC-Web (HTTP/1.1, application/grpc-web) to
	// native gRPC calls. CORS is enabled for all origins — in cloud, CORS
	// is handled at the proxy/CDN layer; here it enables cross-origin
	// requests from the web console (port 8234 → port 7234).
	grpcWebWrapper := grpcweb.WrapServer(server.GRPCServer(),
		grpcweb.WithOriginFunc(func(origin string) bool { return true }),
		// Answer CORS preflight for ALL endpoints, not only those the wrapper can
		// match in its registered-endpoint table. The default
		// (corsForRegisteredEndpointsOnly=true) silently 404s the OPTIONS
		// preflight here — its endpoint lookup does not recognize our registered
		// services — so every cross-origin browser call (the web console on a
		// different port than the API) is blocked with a missing
		// Access-Control-Allow-Origin. Origin is already gated by WithOriginFunc.
		grpcweb.WithCorsForRegisteredEndpointsOnly(false),
		grpcweb.WithWebsockets(true),
		grpcweb.WithWebsocketOriginFunc(func(r *http.Request) bool { return true }),
	)

	// Task kind registry HTTP handler (static JSON, cacheable).
	registryHandler := taskkindregistry.NewHandler()

	// Unified HTTP handler that routes between REST proxy endpoints,
	// gRPC-Web, native gRPC, and 404.
	httpHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/proxy/task-kind-registry" {
			registryHandler.ServeHTTP(w, r)
			return
		}
		if grpcWebWrapper.IsGrpcWebRequest(r) || grpcWebWrapper.IsAcceptableGrpcCorsRequest(r) || grpcWebWrapper.IsGrpcWebSocketRequest(r) {
			grpcWebWrapper.ServeHTTP(w, r)
			return
		}
		if grpclib.IsGRPCRequest(r) {
			server.GRPCServer().ServeHTTP(w, r)
			return
		}
		http.NotFound(w, r)
	})

	// Start the unified HTTP server (h2c for HTTP/2 cleartext + HTTP/1.1).
	go func() {
		if err := server.StartHTTP(cfg.GRPCPort, httpHandler); err != nil {
			log.Fatal().Err(err).Msg("Failed to start gRPC+HTTP server")
		}
	}()

	log.Info().
		Int("port", cfg.GRPCPort).
		Msg("Stigmer Server started (gRPC + gRPC-Web)")

	// Start HTTP file server for local artifact downloads.
	// This serves artifact files so the CLI (and other clients) can download them
	// via a simple HTTP GET using the URLs returned by GetArtifactDownloadUrl.
	if cfg.ArtifactStorage.Type == "local" {
		artifactDir := filepath.Join(cfg.ArtifactStorage.LocalBasePath, "artifacts")
		mux := http.NewServeMux()
		mux.Handle("/", http.FileServer(http.Dir(artifactDir)))
		addr := fmt.Sprintf("127.0.0.1:%d", cfg.ArtifactHTTPPort)
		go func() {
			log.Info().
				Int("port", cfg.ArtifactHTTPPort).
				Str("dir", artifactDir).
				Msg("Starting artifact HTTP file server")
			if err := http.ListenAndServe(addr, mux); err != nil && err != http.ErrServerClosed {
				log.Error().Err(err).Msg("Artifact HTTP file server failed")
			}
		}()
	}

	// Wait for interrupt signal
	sig := <-done
	log.Info().Str("signal", sig.String()).Msg("Received shutdown signal")

	// Graceful shutdown
	server.Stop()
	log.Info().Msg("Stigmer Server stopped")

	return nil
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
