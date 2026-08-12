package agentexecution

import (
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal"
	artifactstorage "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/artifact/storage"
	envresolution "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/environment/resolution"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/mcpserver/oauth"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agent"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agentinstance"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/environment"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/executioncontext"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/session"
	temporalclient "go.temporal.io/sdk/client"
)

// AgentExecutionController implements AgentExecutionCommandController and AgentExecutionQueryController
type AgentExecutionController struct {
	agentexecutionv1.UnimplementedAgentExecutionCommandControllerServer
	agentexecutionv1.UnimplementedAgentExecutionQueryControllerServer
	store                  store.Store
	agentClient            *agent.Client
	agentInstanceClient    *agentinstance.Client
	sessionClient          *session.Client
	environmentClient      *environment.Client
	environmentResolution  *envresolution.RuntimeResolutionService
	executionContextClient *executioncontext.Client
	workflowCreator        *temporal.InvokeAgentExecutionWorkflowCreator
	temporalConfig         *temporal.Config
	streamBroker           *StreamBroker
	temporalClient         temporalclient.Client           // Temporal client for lifecycle operations
	artifactStorage        artifactstorage.ArtifactStorage // Artifact storage for attachments and outputs
	oauthGrantStore        *oauth.OAuthGrantStore
	managedEnvService      *oauth.ManagedEnvironmentService
}

// NewAgentExecutionController creates a new AgentExecutionController
//
// Parameters:
//   - store: Store for persistence
//   - agentClient: In-process gRPC client for Agent service
//   - agentInstanceClient: In-process gRPC client for AgentInstance service
//   - sessionClient: In-process gRPC client for Session service
//
// Note: All clients use in-process gRPC to ensure single source of truth through
// the full interceptor chain (validation, logging, api_resource_kind injection, etc.)
func NewAgentExecutionController(
	store store.Store,
	agentClient *agent.Client,
	agentInstanceClient *agentinstance.Client,
	sessionClient *session.Client,
) *AgentExecutionController {
	return &AgentExecutionController{
		store:               store,
		agentClient:         agentClient,
		agentInstanceClient: agentInstanceClient,
		sessionClient:       sessionClient,
		streamBroker:        NewStreamBroker(),
	}
}

// SetClients sets the client dependencies
// This is used when the controller is created before the in-process gRPC server is started
func (c *AgentExecutionController) SetClients(
	agentClient *agent.Client,
	agentInstanceClient *agentinstance.Client,
	sessionClient *session.Client,
	environmentClient *environment.Client,
	executionContextClient *executioncontext.Client,
) {
	c.agentClient = agentClient
	c.agentInstanceClient = agentInstanceClient
	c.sessionClient = sessionClient
	c.environmentClient = environmentClient
	c.executionContextClient = executionContextClient
}

// SetEnvironmentResolution sets the environment runtime-resolution service —
// the decrypt-for-execution path the execution-context builder uses to
// resolve environment_refs (the RPC surface redacts secret values, oss#405).
func (c *AgentExecutionController) SetEnvironmentResolution(svc *envresolution.RuntimeResolutionService) {
	c.environmentResolution = svc
}

// SetWorkflowCreator sets the Temporal workflow creator dependency
// This is used when the controller is created before the Temporal client is initialized.
// While nil (the startup window before Temporal first connects, or after a failed
// initial connection), Create rejects new executions with Unavailable via
// ensureEngineAvailableStep rather than persisting executions that could never run.
// TemporalManager re-injects the creator once Temporal connects.
func (c *AgentExecutionController) SetWorkflowCreator(creator *temporal.InvokeAgentExecutionWorkflowCreator) {
	c.workflowCreator = creator
}

// SetTemporalConfig sets the Temporal configuration for activity routing.
// This determines how the dispatch function resolves task queues (global vs per-session).
func (c *AgentExecutionController) SetTemporalConfig(cfg *temporal.Config) {
	c.temporalConfig = cfg
}

// GetStreamBroker returns the stream broker for use by Temporal activities
// This allows workflow error recovery to broadcast status updates to subscribers
func (c *AgentExecutionController) GetStreamBroker() *StreamBroker {
	return c.streamBroker
}

// SetTemporalClient sets the Temporal client for lifecycle operations
// This is used when the controller is created before the Temporal client is initialized
// If nil, lifecycle operations (cancel, terminate, pause, resume, recover) will fail gracefully
func (c *AgentExecutionController) SetTemporalClient(client temporalclient.Client) {
	c.temporalClient = client
}

// SetArtifactStorage sets the artifact storage backend
// This is used for processing attachments and managing execution outputs
func (c *AgentExecutionController) SetArtifactStorage(storage artifactstorage.ArtifactStorage) {
	c.artifactStorage = storage
}

// SetOAuthDependencies sets the OAuth grant store and managed environment
// service for injecting OAuth tokens into execution contexts. If not set,
// OAuth token injection is silently skipped (graceful degradation).
func (c *AgentExecutionController) SetOAuthDependencies(
	oauthGrantStore *oauth.OAuthGrantStore,
	managedEnvService *oauth.ManagedEnvironmentService,
) {
	c.oauthGrantStore = oauthGrantStore
	c.managedEnvService = managedEnvService
}
