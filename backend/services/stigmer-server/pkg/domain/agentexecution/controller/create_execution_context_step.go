package agentexecution

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/envmerge"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/mcpserver/oauth"
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
//  1. AgentInstance.environment_refs resolved via environmentClient (in order)
//  2. AgentExecution.spec.runtime_env (execution-time overrides)
type createExecutionContextStep struct {
	agentClient         *agent.Client
	agentInstanceClient *agentinstance.Client
	sessionClient       *session.Client
	environmentClient   *environment.Client
	executionCtxClient  *executioncontext.Client
	store               store.Store
	oauthGrantStore     *oauth.OAuthGrantStore
	managedEnvService   *oauth.ManagedEnvironmentService
}

func (c *AgentExecutionController) newCreateExecutionContextStep() *createExecutionContextStep {
	return &createExecutionContextStep{
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

	// 3. Load Agent to get env declarations
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
	if sessionID != "" {
		sess, sessErr := s.sessionClient.Get(ctx.Context(), sessionID)
		if sessErr != nil {
			log.Warn().Err(sessErr).
				Str("execution_id", executionID).
				Msg("Failed to load session for workspace provisioning key injection (non-fatal)")
		} else {
			filtered = injectWorkspaceProvisioningKeys(filtered, merged, sess, executionID)
			filtered = injectFromPersonalEnvironment(
				ctx.Context(), filtered, sess, executionOrg, executionID, s.environmentClient,
			)
		}
	}

	// 6.7 Inject OAuth-managed MCP variables from managed environments.
	// For each MCP server with spec.auth, reads the access token from the
	// grant's managed environment. Performs inline pre-flight refresh if
	// the token is expired.
	filtered = s.injectMcpOAuthFromManagedEnvironment(
		ctx.Context(), filtered, agentResource, executionOrg, executionID,
	)

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

// injectMcpOAuthFromManagedEnvironment reads OAuth-managed access tokens from
// managed environments for MCP servers that have spec.auth configured.
//
// For each MCP server referenced by the agent with an auth block:
//  1. Look up the OAuthGrant by (identity="", server_id, org) — OSS single-user
//  2. If the target env var is missing from filtered: perform inline refresh,
//     then read the token from the grant's managed environment
//
// Non-fatal: failures are logged and left for downstream validation to catch.
func (s *createExecutionContextStep) injectMcpOAuthFromManagedEnvironment(
	ctx context.Context,
	filtered map[string]*executioncontextv1.ExecutionValue,
	agentResource *agentv1.Agent,
	executionOrg string,
	executionID string,
) map[string]*executioncontextv1.ExecutionValue {
	if s.oauthGrantStore == nil || s.managedEnvService == nil || s.store == nil {
		return filtered
	}

	usages := agentResource.GetSpec().GetMcpServerUsages()
	if len(usages) == 0 {
		return filtered
	}

	injected := false
	for _, usage := range usages {
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
			ctx, s.store, apiresourcekind.ApiResourceKind_mcp_server, slug, serverOrg,
		)
		if err != nil || !found || mcpServer.GetSpec().GetAuth() == nil {
			continue
		}

		mcpServerID := mcpServer.GetMetadata().GetId()

		grant, err := s.oauthGrantStore.Find(ctx, "", mcpServerID, serverOrg)
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

		// Inline pre-flight refresh if expired.
		refreshResult, refreshErr := inlineRefreshIfExpired(ctx, grant, s.managedEnvService, managedEnvID)
		if refreshErr != nil {
			log.Warn().Err(refreshErr).
				Str("mcp_server_id", mcpServerID).
				Str("execution_id", executionID).
				Msg("Inline OAuth token refresh failed (non-fatal)")
		}
		if refreshResult != nil && refreshResult.Refreshed {
			grant.AccessTokenExpiresAt = refreshResult.NewExpiresAt
			if upsertErr := s.oauthGrantStore.Upsert(ctx, grant); upsertErr != nil {
				log.Warn().Err(upsertErr).
					Str("mcp_server_id", mcpServerID).
					Msg("Failed to update OAuth grant after inline refresh (non-fatal)")
			}
		}

		tokenValue, err := s.managedEnvService.ReadSecretValue(ctx, managedEnvID, oauthKey)
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
			cp := make(map[string]*executioncontextv1.ExecutionValue, len(filtered)+len(usages))
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

	return filtered
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
