package agentexecution

import (
	"fmt"

	"github.com/rs/zerolog/log"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/envmerge"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agent"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agentinstance"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/environment"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/executioncontext"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/session"
)

// createExecutionContextStep builds and persists an ExecutionContext with a fully-merged
// environment for the agent execution.
//
// Resolution chain:
//   - Path A (agent_id provided): DefaultInstanceIDKey in pipeline context -> agentInstanceClient.Get -> agentClient.Get
//   - Path B (session_id provided): sessionClient.Get -> Session.agent_instance_id -> agentInstanceClient.Get -> agentClient.Get
//
// Merge priority (lowest to highest):
//  1. Agent.spec.env_spec.data (template defaults)
//  2. AgentInstance.environment_refs resolved via environmentClient (in order)
//  3. AgentExecution.spec.runtime_env (execution-time overrides)
type createExecutionContextStep struct {
	agentClient         *agent.Client
	agentInstanceClient *agentinstance.Client
	sessionClient       *session.Client
	environmentClient   *environment.Client
	executionCtxClient  *executioncontext.Client
}

func (c *AgentExecutionController) newCreateExecutionContextStep() *createExecutionContextStep {
	return &createExecutionContextStep{
		agentClient:         c.agentClient,
		agentInstanceClient: c.agentInstanceClient,
		sessionClient:       c.sessionClient,
		environmentClient:   c.environmentClient,
		executionCtxClient:  c.executionContextClient,
	}
}

func (s *createExecutionContextStep) Name() string {
	return "CreateExecutionContext"
}

func (s *createExecutionContextStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecution]) error {
	execution := ctx.NewState()
	executionID := execution.GetMetadata().GetId()
	executionOrg := execution.GetMetadata().GetOrg()

	log.Debug().
		Str("execution_id", executionID).
		Msg("Creating execution context with merged environment")

	// 1. Resolve agent_instance_id
	agentInstanceID, err := s.resolveAgentInstanceID(ctx)
	if err != nil {
		return fmt.Errorf("resolve agent instance: %w", err)
	}

	log.Debug().
		Str("execution_id", executionID).
		Str("agent_instance_id", agentInstanceID).
		Msg("Resolved agent instance ID")

	// 2. Load AgentInstance to get environment_refs and agent_id
	instance, err := s.agentInstanceClient.Get(ctx.Context(), agentInstanceID)
	if err != nil {
		return fmt.Errorf("load agent instance %s: %w", agentInstanceID, err)
	}

	agentID := instance.GetSpec().GetAgentId()

	// 3. Load Agent to get env_spec
	agentResource, err := s.agentClient.Get(ctx.Context(), &agentv1.AgentId{Value: agentID})
	if err != nil {
		return fmt.Errorf("load agent %s: %w", agentID, err)
	}

	// 4. Resolve environments from instance environment_refs
	environments, err := s.resolveEnvironments(ctx, instance.GetSpec().GetEnvironmentRefs())
	if err != nil {
		return err
	}

	// 5. Merge all layers
	merged := envmerge.MergeEnvironmentLayers(
		agentResource.GetSpec().GetEnvSpec().GetData(),
		environments,
		execution.GetSpec().GetRuntimeEnv(),
	)

	// 6. Filter merged env vars by agent env_spec (least-privilege whitelist).
	// Agents only receive variables they explicitly declared. If env_spec is
	// nil or empty, all vars pass through for backward compatibility.
	filtered, excludedKeys := envmerge.FilterByEnvSpec(merged, agentResource.GetSpec().GetEnvSpec().GetData())
	if len(excludedKeys) > 0 {
		log.Warn().
			Str("execution_id", executionID).
			Str("agent_id", agentID).
			Strs("excluded_keys", excludedKeys).
			Msg("Filtered env vars not declared in agent env_spec")
	}

	// 6.5 Re-inject workspace-provisioning keys that were excluded by env_spec
	// filtering. GITHUB_TOKEN is needed by the agent-runner to clone private
	// repos, but it is a session-level workspace concern, not an agent-declared
	// tool dependency. Without this passthrough, agents with a non-empty
	// env_spec that omit GITHUB_TOKEN silently lose it.
	sessionID := execution.GetSpec().GetSessionId()
	if sessionID != "" {
		sess, sessErr := s.sessionClient.Get(ctx.Context(), sessionID)
		if sessErr != nil {
			log.Warn().Err(sessErr).
				Str("execution_id", executionID).
				Msg("Failed to load session for workspace provisioning key injection (non-fatal)")
		} else {
			filtered = injectWorkspaceProvisioningKeys(filtered, merged, sess, executionID)
		}
	}

	log.Info().
		Str("execution_id", executionID).
		Int("merged_count", len(merged)).
		Int("filtered_count", len(filtered)).
		Int("environment_refs_count", len(instance.GetSpec().GetEnvironmentRefs())).
		Msg("Merged environment layers for execution context")

	// 7. Build and persist ExecutionContext
	ec := &executioncontextv1.ExecutionContext{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "ExecutionContext",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: fmt.Sprintf("exec-ctx-%s", executionID),
			Org:  executionOrg,
		},
		Spec: &executioncontextv1.ExecutionContextSpec{
			ExecutionId: executionID,
			Data:        filtered,
		},
	}

	created, err := s.executionCtxClient.Create(ctx.Context(), ec)
	if err != nil {
		return fmt.Errorf("create execution context for %s: %w", executionID, err)
	}

	log.Info().
		Str("execution_context_id", created.GetMetadata().GetId()).
		Str("execution_id", executionID).
		Int("data_entries", len(filtered)).
		Msg("Successfully created execution context")

	// 8. Clear runtime_env from the execution now that it has been consumed.
	// runtime_env is a transient creation-time input; its contents are now
	// materialized in the ExecutionContext. Clearing it ensures secrets never
	// appear in the persisted execution or in Temporal workflow history.
	if execution.GetSpec() != nil && len(execution.GetSpec().GetRuntimeEnv()) > 0 {
		log.Debug().
			Str("execution_id", executionID).
			Int("cleared_entries", len(execution.GetSpec().GetRuntimeEnv())).
			Msg("Clearing runtime_env from execution (consumed into ExecutionContext)")

		execution.Spec.RuntimeEnv = nil
		ctx.SetNewState(execution)
	}

	return nil
}

// resolveAgentInstanceID determines the agent_instance_id from pipeline context or by
// looking up the session.
func (s *createExecutionContextStep) resolveAgentInstanceID(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecution]) (string, error) {
	// Path A: DefaultInstanceIDKey set by createDefaultInstanceIfNeededStep
	if val := ctx.Get(DefaultInstanceIDKey); val != nil {
		if instanceID, ok := val.(string); ok && instanceID != "" {
			return instanceID, nil
		}
	}

	// Path B: look up session to get agent_instance_id
	execution := ctx.NewState()
	sessionID := execution.GetSpec().GetSessionId()
	if sessionID == "" {
		return "", fmt.Errorf("neither default_instance_id in context nor session_id on execution")
	}

	sess, err := s.sessionClient.Get(ctx.Context(), sessionID)
	if err != nil {
		return "", fmt.Errorf("load session %s: %w", sessionID, err)
	}

	agentInstanceID := sess.GetSpec().GetAgentInstanceId()
	if agentInstanceID == "" {
		return "", fmt.Errorf("session %s has no agent_instance_id", sessionID)
	}

	return agentInstanceID, nil
}

// workspaceProvisioningKeys lists environment variable keys required by the
// agent-runner for workspace provisioning. These are re-injected after
// env_spec filtering when the session has git_repo workspace entries.
var workspaceProvisioningKeys = []string{"GITHUB_TOKEN"}

// injectWorkspaceProvisioningKeys re-injects provisioning keys that were
// excluded by env_spec filtering, but only when the session actually has
// git_repo workspace entries.
func injectWorkspaceProvisioningKeys(
	filtered map[string]*executioncontextv1.ExecutionValue,
	merged map[string]*executioncontextv1.ExecutionValue,
	sess *sessionv1.Session,
	executionID string,
) map[string]*executioncontextv1.ExecutionValue {
	hasGitRepo := false
	for _, entry := range sess.GetSpec().GetWorkspaceEntries() {
		if entry.GetSource().GetGitRepo() != nil {
			hasGitRepo = true
			break
		}
	}
	if !hasGitRepo {
		return filtered
	}

	injected := false
	for _, key := range workspaceProvisioningKeys {
		if _, inFiltered := filtered[key]; inFiltered {
			continue
		}
		val, inMerged := merged[key]
		if !inMerged {
			continue
		}
		if !injected {
			// Copy-on-write: create a new map so the original is not mutated.
			cp := make(map[string]*executioncontextv1.ExecutionValue, len(filtered)+len(workspaceProvisioningKeys))
			for k, v := range filtered {
				cp[k] = v
			}
			filtered = cp
			injected = true
		}
		filtered[key] = val
		log.Info().
			Str("execution_id", executionID).
			Str("key", key).
			Msg("Re-injected workspace-provisioning key after env_spec filter (session has git_repo entries)")
	}
	return filtered
}

// resolveEnvironments fetches each referenced Environment resource in order.
func (s *createExecutionContextStep) resolveEnvironments(
	ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecution],
	refs []*apiresource.ApiResourceReference,
) ([]*environmentv1.Environment, error) {
	if len(refs) == 0 {
		return nil, nil
	}

	environments := make([]*environmentv1.Environment, 0, len(refs))
	for _, ref := range refs {
		env, err := s.environmentClient.GetByReference(ctx.Context(), ref)
		if err != nil {
			return nil, fmt.Errorf("resolve environment ref (org=%s, slug=%s): %w",
				ref.GetOrg(), ref.GetSlug(), err)
		}
		environments = append(environments, env)
	}

	log.Debug().
		Int("count", len(environments)).
		Msg("Resolved environment references")

	return environments, nil
}
