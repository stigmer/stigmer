package agentexecution

import (
	"context"
	"errors"
	"fmt"

	"github.com/rs/zerolog/log"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/envmerge"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/mcpserver/oauth"
	scheduletemporal "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/schedule/temporal"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agent"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agentinstance"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/environment"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/executioncontext"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/session"
)

// executionContextBuilder builds and persists an ExecutionContext with a
// fully-merged environment for an agent execution: it resolves the agent
// instance, merges environment layers, applies the declared-key filter and the
// injection passes (workspace-provisioning keys, personal-environment
// fallback, MCP OAuth tokens), and persists the result.
//
// Shared by the create pipeline (createExecutionContextStep) and the recover
// pipeline (recreateExecutionContextStep): recovery must rebuild the EC
// because the failed run's workflow cleanup deleted it, and re-resolving from
// the CURRENT agent/instance/environment configuration is the desired
// semantics ("fix the API key, then recover").
//
// Resolution chain:
//   - Path A (preResolvedInstanceID provided): agentInstanceClient.Get -> agentClient.Get
//   - Path B (session_id on the execution): sessionClient.Get -> Session.agent_instance_id -> agentInstanceClient.Get -> agentClient.Get
//
// Merge priority (lowest to highest):
//  1. AgentInstance.environment_refs resolved via environmentClient (in order)
//  2. AgentExecution.spec.runtime_env (execution-time overrides; empty on
//     recover — consumed into the original EC and cleared before persist)
type executionContextBuilder struct {
	agentClient         *agent.Client
	agentInstanceClient *agentinstance.Client
	sessionClient       *session.Client
	environmentClient   *environment.Client
	executionCtxClient  *executioncontext.Client
	store               store.Store
	oauthGrantStore     *oauth.OAuthGrantStore
	managedEnvService   *oauth.ManagedEnvironmentService
}

func (c *AgentExecutionController) newExecutionContextBuilder() *executionContextBuilder {
	return &executionContextBuilder{
		agentClient:         c.agentClient,
		agentInstanceClient: c.agentInstanceClient,
		sessionClient:       c.sessionClient,
		environmentClient:   c.environmentClient,
		executionCtxClient:  c.executionContextClient,
		store:               c.store,
		oauthGrantStore:     c.oauthGrantStore,
		managedEnvService:   c.managedEnvService,
	}
}

// createExecutionContextStep runs the shared executionContextBuilder for the
// create pipeline, then clears the consumed runtime_env from the execution —
// a create-only concern (the recover pipeline has no runtime_env to clear).
type createExecutionContextStep struct {
	builder *executionContextBuilder
}

func (c *AgentExecutionController) newCreateExecutionContextStep() *createExecutionContextStep {
	return &createExecutionContextStep{builder: c.newExecutionContextBuilder()}
}

func (s *createExecutionContextStep) Name() string {
	return "CreateExecutionContext"
}

func (s *createExecutionContextStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecution]) error {
	execution := ctx.NewState()
	executionID := execution.GetMetadata().GetId()

	// Path A: the instance resolved by createDefaultInstanceIfNeededStep, when
	// the request came in by agent_id. Empty for session-first requests, which
	// the builder resolves via the session (Path B).
	preResolvedInstanceID := ""
	if val := ctx.Get(DefaultInstanceIDKey); val != nil {
		if instanceID, ok := val.(string); ok {
			preResolvedInstanceID = instanceID
		}
	}

	if err := s.builder.buildAndPersist(ctx.Context(), execution, preResolvedInstanceID); err != nil {
		return err
	}

	// Clear runtime_env from the execution now that it has been consumed.
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

// buildAndPersist resolves the environment for execution and persists a fresh
// ExecutionContext. preResolvedInstanceID short-circuits instance resolution
// when the caller already knows it; pass "" to resolve via the execution's
// session_id (the only path recover needs — a persisted execution always
// carries one).
func (b *executionContextBuilder) buildAndPersist(
	ctx context.Context,
	execution *agentexecutionv1.AgentExecution,
	preResolvedInstanceID string,
) error {
	executionID := execution.GetMetadata().GetId()
	executionOrg := execution.GetMetadata().GetOrg()

	log.Debug().
		Str("execution_id", executionID).
		Msg("Creating execution context with merged environment")

	// 1. Resolve agent_instance_id
	agentInstanceID, err := b.resolveAgentInstanceID(ctx, execution, preResolvedInstanceID)
	if err != nil {
		return fmt.Errorf("resolve agent instance: %w", err)
	}

	log.Debug().
		Str("execution_id", executionID).
		Str("agent_instance_id", agentInstanceID).
		Msg("Resolved agent instance ID")

	// 2. Load AgentInstance to get environment_refs and agent_id
	instance, err := b.agentInstanceClient.Get(ctx, agentInstanceID)
	if err != nil {
		return fmt.Errorf("load agent instance %s: %w", agentInstanceID, err)
	}

	agentID := instance.GetSpec().GetAgentId()

	// 3. Load Agent to get env declarations
	agentResource, err := b.agentClient.Get(ctx, &agentv1.AgentId{Value: agentID})
	if err != nil {
		return fmt.Errorf("load agent %s: %w", agentID, err)
	}

	// 4. Resolve environments from instance environment_refs
	environments, err := b.resolveEnvironments(ctx, instance.GetSpec().GetEnvironmentRefs())
	if err != nil {
		return err
	}

	// 4.5 Schedule-created executions: merge the schedule's own
	// environment_refs BELOW instance refs (lowest priority — the
	// AgentShare/AgentChannel layering, project DD-017 D-2/D-4). This is
	// how a tool-using agent becomes schedulable: the schedule binds the
	// credentials its unattended runs need without touching the agent or
	// its default instance. Resolution is keyed on the
	// stigmer.ai/schedule-id label the run starter stamps — OSS has no
	// caller tokens to carry the claim the cloud edition resolves
	// through, and this single-user edition has no trust boundary the
	// label could widen (the DD-015 divergence posture).
	scheduleEnvironments, err := b.resolveScheduleEnvironments(ctx, execution)
	if err != nil {
		return err
	}
	if len(scheduleEnvironments) > 0 {
		environments = append(scheduleEnvironments, environments...)
	}

	// 5. Merge all layers
	merged := envmerge.MergeEnvironmentLayers(
		environments,
		execution.GetSpec().GetRuntimeEnv(),
	)

	// 6. Filter merged env vars by agent env declarations (least-privilege whitelist).
	// Agents only receive variables they explicitly declared. If env is
	// nil or empty, all vars pass through for backward compatibility.
	agentEnvDecls := agentResource.GetSpec().GetEnv()
	filtered, excludedKeys := envmerge.FilterByDeclaredKeys(merged, agentEnvDecls)
	if len(excludedKeys) > 0 {
		log.Warn().
			Str("execution_id", executionID).
			Str("agent_id", agentID).
			Strs("excluded_keys", excludedKeys).
			Msg("Filtered env vars not declared in agent env")
	}

	// 6.5 Re-inject workspace-provisioning keys that were excluded by env
	// filtering, and fall back to the caller's personal environment for keys
	// that were never in the merge chain at all.
	//
	// GITHUB_TOKEN is needed by the agent-runner to clone private repos, but
	// it is a session-level workspace concern, not an agent-declared tool
	// dependency. The token typically lives in the caller's personal
	// environment (stored via GitHub OAuth), which is not part of the
	// standard 2-layer merge (environment_refs, runtime_env).
	sessionID := execution.GetSpec().GetSessionId()
	var sess *sessionv1.Session
	if sessionID != "" {
		var sessErr error
		sess, sessErr = b.sessionClient.Get(ctx, sessionID)
		if sessErr != nil {
			log.Warn().Err(sessErr).
				Str("execution_id", executionID).
				Msg("Failed to load session for workspace provisioning key injection (non-fatal)")
		} else {
			filtered = injectWorkspaceProvisioningKeys(filtered, merged, sess, executionID)
			filtered = injectFromPersonalEnvironment(
				ctx, filtered, sess, executionOrg, executionID, b.environmentClient,
			)
		}
	}

	// 6.7 Inject OAuth-managed MCP variables from managed environments.
	// For each MCP server with spec.auth, reads the access token from the
	// grant's managed environment. Performs inline pre-flight refresh if
	// the token is expired.
	//
	// Uses merged agent + session MCP usages so that session-level servers
	// (added at runtime, not declared on the agent) also get their OAuth
	// tokens injected.
	mergedMcpUsages := mergeAgentAndSessionMcpUsages(agentResource, sess)
	filtered, oauthErr := b.injectMcpOAuthFromManagedEnvironment(
		ctx, filtered, mergedMcpUsages, executionOrg, executionID,
	)
	if oauthErr != nil {
		return grpclib.FailedPreconditionError("%v", oauthErr)
	}

	// 6.9 Validate that all required (non-optional) declared env vars are
	// present after merging, filtering, and all injections. Missing required
	// vars are logged as a warning — the downstream execution will fail with
	// a clearer error (e.g. MCP server auth failure) if truly needed.
	if missingRequired := envmerge.ValidateRequiredKeys(filtered, agentEnvDecls); len(missingRequired) > 0 {
		log.Warn().
			Str("execution_id", executionID).
			Str("agent_id", agentID).
			Strs("missing_required", missingRequired).
			Msg("Required env vars missing after environment merge — execution may fail")
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

	created, err := b.executionCtxClient.Create(ctx, ec)
	if err != nil {
		return fmt.Errorf("create execution context for %s: %w", executionID, err)
	}

	log.Info().
		Str("execution_context_id", created.GetMetadata().GetId()).
		Str("execution_id", executionID).
		Int("data_entries", len(filtered)).
		Msg("Successfully created execution context")

	return nil
}

// resolveAgentInstanceID determines the agent_instance_id from the caller's
// pre-resolved value or by looking up the execution's session.
func (b *executionContextBuilder) resolveAgentInstanceID(
	ctx context.Context,
	execution *agentexecutionv1.AgentExecution,
	preResolvedInstanceID string,
) (string, error) {
	// Path A: instance already resolved by the caller.
	if preResolvedInstanceID != "" {
		return preResolvedInstanceID, nil
	}

	// Path B: look up session to get agent_instance_id
	sessionID := execution.GetSpec().GetSessionId()
	if sessionID == "" {
		return "", fmt.Errorf("neither a pre-resolved instance id nor session_id on execution")
	}

	sess, err := b.sessionClient.Get(ctx, sessionID)
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

// mergeAgentAndSessionMcpUsages combines MCP server usages from the agent and
// session, deduplicating by server slug. Agent-level usages take priority over
// session-level usages for the same slug.
//
// This ensures that MCP servers added at the session level (e.g. via the UI at
// runtime) are included in OAuth token injection — not just servers declared
// on the agent.
func mergeAgentAndSessionMcpUsages(
	agentResource *agentv1.Agent,
	sess *sessionv1.Session,
) []*agentv1.McpServerUsage {
	merged := make(map[string]*agentv1.McpServerUsage)

	// Session usages first (lower priority).
	if sess != nil {
		for _, usage := range sess.GetSpec().GetMcpServerUsages() {
			slug := usage.GetMcpServerRef().GetSlug()
			if slug != "" {
				merged[slug] = usage
			}
		}
	}

	// Agent usages override (higher priority).
	if agentResource != nil {
		for _, usage := range agentResource.GetSpec().GetMcpServerUsages() {
			slug := usage.GetMcpServerRef().GetSlug()
			if slug != "" {
				merged[slug] = usage
			}
		}
	}

	result := make([]*agentv1.McpServerUsage, 0, len(merged))
	for _, usage := range merged {
		result = append(result, usage)
	}
	return result
}

// injectMcpOAuthFromManagedEnvironment reads OAuth-managed access tokens from
// managed environments for MCP servers that have spec.auth configured.
//
// For each MCP server in the merged (agent + session) usages with an auth block:
//  1. Look up the OAuthGrant by (identity="", server_id, org) — OSS single-user
//  2. If the target env var is missing from filtered: perform inline refresh,
//     then read the token from the grant's managed environment
//
// Token refresh failures are fatal — an expired token that cannot be refreshed
// must prevent execution rather than letting the agent run with a stale token
// that will fail with an opaque 401 from the MCP server.
func (b *executionContextBuilder) injectMcpOAuthFromManagedEnvironment(
	ctx context.Context,
	filtered map[string]*executioncontextv1.ExecutionValue,
	mcpServerUsages []*agentv1.McpServerUsage,
	executionOrg string,
	executionID string,
) (map[string]*executioncontextv1.ExecutionValue, error) {
	if b.oauthGrantStore == nil || b.managedEnvService == nil || b.store == nil {
		return filtered, nil
	}

	if len(mcpServerUsages) == 0 {
		return filtered, nil
	}

	injected := false
	for _, usage := range mcpServerUsages {
		ref := usage.GetMcpServerRef()
		slug := ref.GetSlug()
		if slug == "" {
			continue
		}

		serverOrg := ref.GetOrg()
		if serverOrg == "" {
			serverOrg = executionOrg
		}
		if serverOrg == "" {
			continue
		}

		mcpServer, found, err := steps.FindResourceBySlug[*mcpserverv1.McpServer](
			ctx, b.store, apiresourcekind.ApiResourceKind_mcp_server, slug, serverOrg,
		)
		if err != nil || !found || mcpServer.GetSpec().GetAuth() == nil {
			continue
		}

		mcpServerID := mcpServer.GetMetadata().GetId()

		grant, err := b.oauthGrantStore.Find(ctx, "", mcpServerID, serverOrg)
		if err != nil || grant == nil {
			continue
		}

		oauthKey := grant.AccessTokenEnvVar
		if oauthKey == "" {
			continue
		}

		if _, present := filtered[oauthKey]; present {
			continue
		}

		managedEnvID := grant.EnvironmentID
		if managedEnvID == "" {
			log.Warn().
				Str("mcp_server_id", mcpServerID).
				Str("execution_id", executionID).
				Msg("OAuth grant has no managed environment ID — skipping token injection")
			continue
		}

		// Inline pre-flight refresh if expired. Refresh failures are fatal —
		// an expired token must not be silently injected into the execution.
		refreshResult, refreshErr := inlineRefreshIfExpired(ctx, grant, b.managedEnvService, managedEnvID)
		if refreshErr != nil {
			return nil, fmt.Errorf(
				"OAuth token refresh failed for MCP server '%s': %w", mcpServerID, refreshErr)
		}
		if refreshResult != nil && refreshResult.Refreshed {
			grant.AccessTokenExpiresAt = refreshResult.NewExpiresAt
			if upsertErr := b.oauthGrantStore.Upsert(ctx, grant); upsertErr != nil {
				log.Warn().Err(upsertErr).
					Str("mcp_server_id", mcpServerID).
					Msg("Failed to update OAuth grant after inline refresh (non-fatal)")
			}
		}

		tokenValue, err := b.managedEnvService.ReadSecretValue(ctx, managedEnvID, oauthKey)
		if err != nil || tokenValue == "" {
			log.Warn().Err(err).
				Str("mcp_server_id", mcpServerID).
				Str("oauth_key", oauthKey).
				Str("managed_env_id", managedEnvID).
				Str("execution_id", executionID).
				Msg("Failed to read OAuth token from managed environment (non-fatal)")
			continue
		}

		if !injected {
			cp := make(map[string]*executioncontextv1.ExecutionValue, len(filtered)+len(mcpServerUsages))
			for k, v := range filtered {
				cp[k] = v
			}
			filtered = cp
			injected = true
		}
		filtered[oauthKey] = &executioncontextv1.ExecutionValue{
			Value:    tokenValue,
			IsSecret: true,
		}

		log.Info().
			Str("execution_id", executionID).
			Str("mcp_server_id", mcpServerID).
			Str("oauth_key", oauthKey).
			Str("managed_env_id", managedEnvID).
			Msg("Injected OAuth token from managed environment")
	}

	return filtered, nil
}

// inlineRefreshIfExpired reads the refresh token from the managed environment
// and attempts a token refresh if the access token is expired. Returns nil
// result if no refresh was needed or the refresh token is unavailable.
func inlineRefreshIfExpired(
	ctx context.Context,
	grant *oauth.OAuthGrant,
	managedEnvService *oauth.ManagedEnvironmentService,
	managedEnvID string,
) (*oauth.RefreshResult, error) {
	refreshToken, err := managedEnvService.ReadSecretValue(ctx, managedEnvID, grant.RefreshTokenEnvVar)
	if err != nil || refreshToken == "" {
		return nil, nil
	}

	// No client_secret resolution in the execution context path — DCR/public
	// clients work without it, and vendor OAuth would require loading the
	// OAuthApp (cross-domain). The connect pre-flight refresh handles
	// vendor OAuth; this inline path is a best-effort fallback.
	result, err := oauth.RefreshTokenIfExpired(ctx, grant, refreshToken, "")
	if err != nil {
		return nil, err
	}

	if !result.Refreshed {
		return result, nil
	}

	tokenVars := map[string]*environmentv1.EnvironmentValue{
		grant.AccessTokenEnvVar: {
			Value:    result.NewAccessToken,
			IsSecret: true,
		},
	}
	if result.NewRefreshToken != refreshToken {
		tokenVars[grant.RefreshTokenEnvVar] = &environmentv1.EnvironmentValue{
			Value:    result.NewRefreshToken,
			IsSecret: true,
		}
	}

	if updateErr := managedEnvService.UpdateSecrets(ctx, managedEnvID, tokenVars); updateErr != nil {
		return nil, fmt.Errorf("failed to write refreshed tokens to managed environment: %w", updateErr)
	}

	return result, nil
}

// personalEnvLabel is the well-known metadata label that identifies a user's
// personal environment resource.
const personalEnvLabel = "stigmer.ai/personal"

// injectFromPersonalEnvironment is the fallback for workspace-provisioning
// keys that were absent from the standard 3-layer merge entirely. When the
// session has git_repo workspace entries and a required key (e.g.
// GITHUB_TOKEN) is still missing after the merged-map re-injection, this
// function looks up the caller's personal environment via gRPC and injects
// the decrypted secret value.
//
// All failures are non-fatal: if the personal environment does not exist, does
// not contain the key, or the gRPC call fails, execution continues without the
// key. The downstream git clone will fail with a clear authentication error if
// the token is truly required.
func injectFromPersonalEnvironment(
	ctx context.Context,
	filtered map[string]*executioncontextv1.ExecutionValue,
	sess *sessionv1.Session,
	executionOrg string,
	executionID string,
	envClient *environment.Client,
) map[string]*executioncontextv1.ExecutionValue {
	// Only relevant when the session has git_repo workspace entries.
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

	// Collect keys that are still missing after the merged-map re-injection.
	var missing []string
	for _, key := range workspaceProvisioningKeys {
		if _, present := filtered[key]; !present {
			missing = append(missing, key)
		}
	}
	if len(missing) == 0 {
		return filtered
	}

	// Look up the caller's personal environment by org + label.
	listResp, err := envClient.List(ctx, &environmentv1.ListEnvironmentsRequest{
		Org:    executionOrg,
		Labels: map[string]string{personalEnvLabel: "true"},
	})
	if err != nil {
		log.Warn().Err(err).
			Str("execution_id", executionID).
			Msg("Failed to list personal environments for provisioning key injection (non-fatal)")
		return filtered
	}
	if listResp.GetTotalCount() == 0 || len(listResp.GetItems()) == 0 {
		log.Debug().
			Str("execution_id", executionID).
			Str("org", executionOrg).
			Msg("No personal environment found — skipping provisioning key injection from personal env")
		return filtered
	}

	personalEnv := listResp.GetItems()[0]
	personalEnvID := personalEnv.GetMetadata().GetId()

	injected := false
	for _, key := range missing {
		// The personal env's spec.data keys are present even when redacted,
		// so we can check existence before making the GetSecretValue call.
		if _, hasKey := personalEnv.GetSpec().GetData()[key]; !hasKey {
			continue
		}

		secretVal, err := envClient.GetSecretValue(ctx, &environmentv1.EnvironmentSecretValueInput{
			EnvironmentId: personalEnvID,
			Key:           key,
		})
		if err != nil {
			log.Warn().Err(err).
				Str("execution_id", executionID).
				Str("key", key).
				Str("personal_env_id", personalEnvID).
				Msg("Failed to retrieve secret from personal environment (non-fatal)")
			continue
		}
		if secretVal.GetValue() == "" {
			continue
		}

		if !injected {
			cp := make(map[string]*executioncontextv1.ExecutionValue, len(filtered)+len(missing))
			for k, v := range filtered {
				cp[k] = v
			}
			filtered = cp
			injected = true
		}
		filtered[key] = &executioncontextv1.ExecutionValue{
			Value:    secretVal.GetValue(),
			IsSecret: true,
		}
		log.Info().
			Str("execution_id", executionID).
			Str("key", key).
			Str("personal_env_id", personalEnvID).
			Msg("Injected workspace-provisioning key from caller's personal environment")
	}

	return filtered
}

// resolveEnvironments fetches each referenced Environment resource in order.
// resolveScheduleEnvironments resolves the environment_refs of the
// schedule that created this execution, identified by the
// stigmer.ai/schedule-id label the run starter stamps. Executions with
// no schedule label (the overwhelmingly common case) answer nil at the
// cost of one map lookup. A schedule deleted between the fire and this
// step degrades to no schedule environments — the run proceeds with the
// instance's own refs, exactly as it would have before the schedule
// existed. An unresolvable REF, by contrast, fails the create: that is
// an authoring error the fire ledger should record as a deterministic
// refusal, never silently run without credentials (the failure mode
// this whole seam exists to fix).
func (b *executionContextBuilder) resolveScheduleEnvironments(
	ctx context.Context,
	execution *agentexecutionv1.AgentExecution,
) ([]*environmentv1.Environment, error) {
	scheduleID := execution.GetMetadata().GetLabels()[scheduletemporal.ScheduleIDLabelKey]
	if scheduleID == "" {
		return nil, nil
	}

	schedule := &schedulev1.Schedule{}
	if err := b.store.GetResource(ctx, apiresourcekind.ApiResourceKind_schedule,
		scheduleID, schedule); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			log.Warn().Str("schedule_id", scheduleID).
				Str("execution_id", execution.GetMetadata().GetId()).
				Msg("Schedule-labeled execution's schedule row is gone — running without schedule environments")
			return nil, nil
		}
		return nil, fmt.Errorf("load schedule %s for environment resolution: %w", scheduleID, err)
	}

	refs := schedule.GetSpec().GetAgent().GetEnvironmentRefs()
	if len(refs) == 0 {
		return nil, nil
	}

	// A manifest ref may omit the org (relative to the schedule's own —
	// the same-org invariant pins agent_ref.org == metadata.org, and
	// environment resolution follows the schedule's org).
	resolved := make([]*apiresource.ApiResourceReference, 0, len(refs))
	for _, ref := range refs {
		if ref.GetOrg() == "" {
			resolved = append(resolved, &apiresource.ApiResourceReference{
				Kind: ref.GetKind(),
				Org:  schedule.GetMetadata().GetOrg(),
				Slug: ref.GetSlug(),
			})
			continue
		}
		resolved = append(resolved, ref)
	}

	environments, err := b.resolveEnvironments(ctx, resolved)
	if err != nil {
		return nil, fmt.Errorf("resolve schedule %s environment_refs: %w", scheduleID, err)
	}
	log.Debug().Str("schedule_id", scheduleID).Int("count", len(environments)).
		Msg("Resolved schedule environment references")
	return environments, nil
}

func (b *executionContextBuilder) resolveEnvironments(
	ctx context.Context,
	refs []*apiresource.ApiResourceReference,
) ([]*environmentv1.Environment, error) {
	if len(refs) == 0 {
		return nil, nil
	}

	environments := make([]*environmentv1.Environment, 0, len(refs))
	for _, ref := range refs {
		env, err := b.environmentClient.GetByReference(ctx, ref)
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
