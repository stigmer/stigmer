package mcpserver

import (
	"context"
	"fmt"
	"strings"
	"time"

	"errors"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	oauthappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/mcpserver/oauth"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	connectWorkflowName = "stigmer/mcp-server/connect"

	// connectTimeout is the connect workflow's WorkflowRunTimeout — the total
	// budget for discovery + tool-approval classification. It is sized from the
	// runner's own bounds (issue #243): the 270s stdio init allowance
	// (STDIO_INIT_TIMEOUT_MS in activities/discover-mcp-server.ts — a first run
	// may download and compile packages via npx/uvx/go run) + the 120s
	// classification floor (classifyWithTimeout in workflows/connect-mcp-server.ts)
	// + margin for tool listing and persistence. Anything smaller makes the
	// runner's cold-start allowance — and its actionable timeout error —
	// unreachable by construction, which is exactly how the pre-#243 45s value
	// killed every heavy stdio connect.
	//
	// Deliberately NOT sized for classification retries (maximumAttempts: 2) or
	// >~160-tool stdio servers, whose budgets scale past any flat ceiling —
	// async/pollable discovery is the cure for those, not a longer wait.
	//
	// Trade-off, accepted: this is also the bound on "no runner ever picked up
	// the task", so a connect against a dead runner now waits the full budget
	// before DEADLINE_EXCEEDED. The local daemon supervises the runner
	// (crash-restart), making that state pathological rather than designed; a
	// CLI --timeout remains the caller's soft bound.
	connectTimeout = 420 * time.Second

	personalEnvLabel = "stigmer.ai/personal"

	// bestEffortConnectGetBuffer is added to connectTimeout to bound the
	// background goroutine's wait on the connect workflow result. The workflow's
	// own WorkflowRunTimeout (connectTimeout) is the deadline that should fire
	// first; this slightly longer context is only a backstop so the goroutine
	// can never leak if Temporal becomes unreachable.
	bestEffortConnectGetBuffer = 15 * time.Second
)

// connectWorkflowInput matches the Python DiscoverMcpServerInput dataclass
// used by ConnectMcpServerWorkflow (discover + classify).
//
// Follows the slim-payload pattern: only reference IDs are passed through
// Temporal. The Python activity reads environment variables from the
// pre-created ExecutionContext, keeping secrets out of Temporal's durable
// workflow history.
type connectWorkflowInput struct {
	McpServerID              string `json:"mcp_server_id"`
	ExecutionContextID       string `json:"execution_context_id,omitempty"`
	InvokerIdentityAccountID string `json:"invoker_identity_account_id,omitempty"`
}

// connectWorkflowOutput mirrors the connect workflow's result
// (ConnectMcpServerWorkflowOutput in the runner). Every field the runner
// emits must have a home here: a missing field is silently dropped during
// JSON deserialization, which is exactly how tool_approvals used to be lost.
type connectWorkflowOutput struct {
	Tools             []discoveredToolResult             `json:"tools"`
	ResourceTemplates []discoveredResourceTemplateResult `json:"resource_templates"`
	// Per-tool approval policies produced by the connect-time classifier.
	// These feed McpServerStatus.tool_approvals — layer 1 of the approval
	// policy chain. The classifier returns only the gated tools, but each
	// entry still carries requires_approval so a future runner that emits
	// non-gated entries is handled defensively at conversion time.
	ToolApprovals []toolApprovalResult `json:"tool_approvals"`
}

type discoveredToolResult struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"input_schema,omitempty"`
}

type discoveredResourceTemplateResult struct {
	URITemplate string `json:"uri_template"`
	Name        string `json:"name"`
	Description string `json:"description"`
	MimeType    string `json:"mime_type"`
}

type toolApprovalResult struct {
	ToolName         string `json:"tool_name"`
	RequiresApproval bool   `json:"requires_approval"`
	Message          string `json:"message"`
	// FromDestructiveHint is true when the connect-time tightener force-gated this
	// tool from its destructiveHint annotation (not the classifier). Persisted to
	// ToolApprovalPolicy.from_destructive_hint so the runner attributes the gate to
	// the annotation rather than the classifier default.
	FromDestructiveHint bool `json:"from_destructive_hint"`
}

// Connect triggers server-side MCP discovery and tool approval classification
// via a Temporal workflow on the agent-runner.
//
// Lifecycle:
//  1. Resolve environment variables (from runtime_env or personal environment)
//  2. Create an ephemeral ExecutionContext with the resolved variables
//  3. Start the Temporal workflow with only the MCP server ID and EC ID
//  4. Block until the workflow completes
//  5. Delete the ExecutionContext (defer cleanup)
//  6. Store discovered capabilities on the McpServer resource
func (c *McpServerController) Connect(
	ctx context.Context,
	input *mcpserverv1.ConnectInput,
) (*mcpserverv1.McpServer, error) {
	if c.temporalClient == nil {
		return nil, grpclib.FailedPreconditionError(
			"connect is not available: Temporal not configured",
		)
	}

	mcpServerID := input.GetMcpServerId()
	if mcpServerID == "" {
		return nil, grpclib.InvalidArgumentError("mcp_server_id is required")
	}

	callerOrg := input.GetOrg()
	if callerOrg == "" {
		return nil, grpclib.InvalidArgumentError("org is required for connect")
	}

	mcpServer := &mcpserverv1.McpServer{}
	if err := c.store.GetResource(ctx, apiresourcekind.ApiResourceKind_mcp_server, mcpServerID, mcpServer); err != nil {
		return nil, grpclib.NotFoundError("mcp_server", mcpServerID)
	}

	// Pre-flight: refresh expired OAuth tokens before env resolution.
	// Only applies when runtime_env is empty and the MCP server has
	// an auth block with an existing OAuthGrant. Tokens are refreshed
	// in the grant's managed environment.
	if len(input.GetRuntimeEnv()) == 0 {
		if err := c.refreshOAuthTokenIfNeeded(ctx, mcpServer, callerOrg); err != nil {
			return nil, err
		}
	}

	executionID := fmt.Sprintf("connect-%s-%s", mcpServerID, uuid.New().String()[:8])

	ecResourceID, err := c.createConnectExecutionContext(
		ctx, mcpServer, executionID, callerOrg, input.GetRuntimeEnv(),
	)
	if err != nil {
		return nil, err
	}

	if ecResourceID != "" {
		defer c.deleteConnectExecutionContext(ctx, ecResourceID, executionID)
	}

	wfInput := connectWorkflowInput{
		McpServerID:        mcpServerID,
		ExecutionContextID: executionID,
	}

	result, err := c.executeConnectWorkflow(ctx, mcpServer, wfInput)
	if err != nil {
		return nil, err
	}

	// Persist discovered capabilities + the connect-time classifier output
	// (layer 1 of the approval policy chain) atomically. The freshly-read,
	// updated resource is returned to the caller.
	persisted, toolApprovalCount, err := c.persistConnectResult(ctx, mcpServerID, result)
	if err != nil {
		return nil, grpclib.InternalError(err, "failed to save mcp server after connect")
	}

	capabilities := persisted.GetStatus().GetDiscoveredCapabilities()
	log.Info().
		Str("mcp_server_id", mcpServerID).
		Int("tools", len(capabilities.GetTools())).
		Int("resource_templates", len(capabilities.GetResourceTemplates())).
		Int("tool_approvals", toolApprovalCount).
		Msg("MCP server connect completed and stored")

	return persisted, nil
}

// createConnectExecutionContext builds and persists an ephemeral ExecutionContext
// for the connect activity.
//
// When runtime_env is provided, the values are used directly (one-time use).
// When runtime_env is empty, variables are resolved from two sources:
//   - OAuth-managed variables: read from the grant's managed environment
//   - Remaining variables: read from the user's personal environment
//
// Returns the ExecutionContext resource ID (for cleanup) and an error.
// Returns ("", nil) when the MCP server has no env declarations and no runtime_env.
func (c *McpServerController) createConnectExecutionContext(
	ctx context.Context,
	mcpServer *mcpserverv1.McpServer,
	executionID string,
	callerOrg string,
	runtimeEnv map[string]*executioncontextv1.ExecutionValue,
) (string, error) {
	var ecData map[string]*executioncontextv1.ExecutionValue

	if len(runtimeEnv) > 0 {
		ecData = runtimeEnv

		log.Info().
			Str("execution_id", executionID).
			Int("runtime_env_count", len(runtimeEnv)).
			Msg("Using runtime_env for connect ExecutionContext (one-time use)")
	} else {
		envDecls := mcpServer.GetSpec().GetEnv()
		if len(envDecls) == 0 {
			log.Debug().
				Str("execution_id", executionID).
				Msg("MCP server has no env declarations — skipping ExecutionContext creation")
			return "", nil
		}

		mcpServerID := mcpServer.GetMetadata().GetId()

		// Split resolution: OAuth vars from managed env, rest from personal env.
		oauthVars, remainingDecls := c.resolveOAuthVarsFromManagedEnv(ctx, mcpServerID, callerOrg, envDecls)

		var personalVars map[string]*executioncontextv1.ExecutionValue
		if len(remainingDecls) > 0 {
			var err error
			personalVars, err = c.resolveFromPersonalEnvironment(ctx, callerOrg, remainingDecls)
			if err != nil {
				return "", err
			}
		}

		ecData = make(map[string]*executioncontextv1.ExecutionValue, len(oauthVars)+len(personalVars))
		for k, v := range personalVars {
			ecData[k] = v
		}
		for k, v := range oauthVars {
			ecData[k] = v
		}

		log.Info().
			Str("execution_id", executionID).
			Int("oauth_count", len(oauthVars)).
			Int("personal_count", len(personalVars)).
			Msg("Resolved env vars for connect ExecutionContext")
	}

	if len(ecData) == 0 {
		return "", nil
	}

	ec := &executioncontextv1.ExecutionContext{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "ExecutionContext",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: fmt.Sprintf("exec-ctx-%s", executionID),
			Org:  callerOrg,
		},
		Spec: &executioncontextv1.ExecutionContextSpec{
			ExecutionId: executionID,
			Data:        ecData,
		},
	}

	created, err := c.executionCtxClient.Create(ctx, ec)
	if err != nil {
		return "", grpclib.InternalError(err, "failed to create connect ExecutionContext")
	}

	resourceID := created.GetMetadata().GetId()
	log.Info().
		Str("execution_context_id", resourceID).
		Str("execution_id", executionID).
		Int("data_entries", len(ecData)).
		Msg("Created ephemeral ExecutionContext for MCP connect")

	return resourceID, nil
}

// resolveOAuthVarsFromManagedEnv reads OAuth-managed variables from the grant's
// managed environment and returns them along with the remaining declarations
// that still need to be resolved from the personal environment.
//
// If no grant exists or the grant has no managed environment, all declarations
// are returned as "remaining" (unchanged).
func (c *McpServerController) resolveOAuthVarsFromManagedEnv(
	ctx context.Context,
	mcpServerID string,
	org string,
	envDecls map[string]*environmentv1.EnvVarDeclaration,
) (oauthVars map[string]*executioncontextv1.ExecutionValue, remainingDecls map[string]*environmentv1.EnvVarDeclaration) {
	if c.oauthGrantStore == nil || c.managedEnvService == nil {
		return nil, envDecls
	}

	grant, err := c.oauthGrantStore.Find(ctx, "", mcpServerID, org)
	if err != nil || grant == nil || grant.EnvironmentID == "" {
		return nil, envDecls
	}

	oauthKey := grant.AccessTokenEnvVar
	if _, declared := envDecls[oauthKey]; !declared {
		return nil, envDecls
	}

	tokenValue, err := c.managedEnvService.ReadSecretValue(ctx, grant.EnvironmentID, oauthKey)
	if err != nil || tokenValue == "" {
		log.Warn().Err(err).
			Str("mcp_server_id", mcpServerID).
			Str("oauth_key", oauthKey).
			Str("managed_env_id", grant.EnvironmentID).
			Msg("Failed to read OAuth token from managed environment — falling back to personal env")
		return nil, envDecls
	}

	oauthVars = map[string]*executioncontextv1.ExecutionValue{
		oauthKey: {
			Value:    tokenValue,
			IsSecret: true,
		},
	}

	remainingDecls = make(map[string]*environmentv1.EnvVarDeclaration, len(envDecls)-1)
	for k, v := range envDecls {
		if k != oauthKey {
			remainingDecls[k] = v
		}
	}

	log.Debug().
		Str("mcp_server_id", mcpServerID).
		Str("oauth_key", oauthKey).
		Str("managed_env_id", grant.EnvironmentID).
		Msg("Resolved OAuth token from managed environment")

	return oauthVars, remainingDecls
}

// resolveFromPersonalEnvironment reads environment variables from the user's
// personal environment (labeled stigmer.ai/personal=true). Required variables
// (optional=false, the default) must be present; optional variables are
// included when available but silently skipped when missing.
func (c *McpServerController) resolveFromPersonalEnvironment(
	ctx context.Context,
	org string,
	envDecls map[string]*environmentv1.EnvVarDeclaration,
) (map[string]*executioncontextv1.ExecutionValue, error) {
	requiredKeys := make([]string, 0, len(envDecls))
	for k, decl := range envDecls {
		if !decl.GetOptional() {
			requiredKeys = append(requiredKeys, k)
		}
	}

	listResp, err := c.environmentClient.List(ctx, &environmentv1.ListEnvironmentsRequest{
		Org:    org,
		Labels: map[string]string{personalEnvLabel: "true"},
	})
	if err != nil {
		return nil, grpclib.InternalError(err, "failed to list personal environments")
	}
	if listResp.GetTotalCount() == 0 || len(listResp.GetItems()) == 0 {
		if len(requiredKeys) == 0 {
			return make(map[string]*executioncontextv1.ExecutionValue), nil
		}
		return nil, grpclib.FailedPreconditionError(
			"personal environment not found for org '%s'; save required credentials first: %v", org, requiredKeys,
		)
	}

	personalEnv := listResp.GetItems()[0]
	personalEnvID := personalEnv.GetMetadata().GetId()
	storedKeys := make(map[string]bool)
	for k := range personalEnv.GetSpec().GetData() {
		storedKeys[k] = true
	}

	result := make(map[string]*executioncontextv1.ExecutionValue, len(envDecls))
	var missing []string

	for key, decl := range envDecls {
		if !storedKeys[key] {
			if decl.GetOptional() {
				log.Debug().
					Str("key", key).
					Msg("Optional env var not in personal environment — skipping")
				continue
			}
			missing = append(missing, key)
			continue
		}

		secretVal, err := c.environmentClient.GetSecretValue(ctx, &environmentv1.EnvironmentSecretValueInput{
			EnvironmentId: personalEnvID,
			Key:           key,
		})
		if err != nil {
			log.Warn().Err(err).
				Str("key", key).
				Str("personal_env_id", personalEnvID).
				Msg("Failed to get secret value from personal environment")
			if decl.GetOptional() {
				continue
			}
			missing = append(missing, key)
			continue
		}
		if secretVal.GetValue() == "" {
			if decl.GetOptional() {
				continue
			}
			missing = append(missing, key)
			continue
		}

		result[key] = &executioncontextv1.ExecutionValue{
			Value:    secretVal.GetValue(),
			IsSecret: decl.GetIsSecret(),
		}
	}

	if len(missing) > 0 {
		return nil, grpclib.FailedPreconditionError(
			"missing required credentials in personal environment: %v", missing,
		)
	}

	return result, nil
}

// deleteConnectExecutionContext removes the ephemeral ExecutionContext after
// the connect workflow completes. Failures are logged but not propagated,
// since the result is already stored.
func (c *McpServerController) deleteConnectExecutionContext(
	ctx context.Context,
	resourceID string,
	executionID string,
) {
	if _, err := c.executionCtxClient.Delete(ctx, resourceID); err != nil {
		log.Warn().Err(err).
			Str("resource_id", resourceID).
			Str("execution_id", executionID).
			Msg("Failed to delete connect ExecutionContext (non-fatal)")
		return
	}

	log.Debug().
		Str("resource_id", resourceID).
		Str("execution_id", executionID).
		Msg("Deleted ephemeral connect ExecutionContext")
}

// startConnectWorkflow launches the connect workflow on the runner queue and
// returns the run handle without waiting for completion.
//
// The synchronous Connect path and the fire-and-forget best-effort path share
// this launch so the workflow ID scheme, task queue, run timeout, and the
// "Started MCP connect workflow" log line stay identical across both. The two
// callers diverge only afterwards, in how they await the result (run.Get) and
// surface failures (gRPC status vs. background log) — which is a legitimate
// difference, not duplication.
func (c *McpServerController) startConnectWorkflow(
	ctx context.Context,
	mcpServerID string,
	input connectWorkflowInput,
) (client.WorkflowRun, error) {
	workflowID := fmt.Sprintf("%s/%s/%s", connectWorkflowName, mcpServerID, uuid.New().String()[:8])

	runnerQueue := c.temporalConfig.RunnerQueue
	options := client.StartWorkflowOptions{
		ID:                 workflowID,
		TaskQueue:          runnerQueue,
		WorkflowRunTimeout: connectTimeout,
	}

	run, err := c.temporalClient.ExecuteWorkflow(ctx, options, connectWorkflowName, input)
	if err != nil {
		return nil, err
	}

	log.Info().
		Str("workflow_id", workflowID).
		Str("mcp_server_id", mcpServerID).
		Str("runner_queue", runnerQueue).
		Msg("Started MCP connect workflow")

	return run, nil
}

// executeConnectWorkflow starts the Python DiscoverMcpServerWorkflow on
// the runner queue and blocks until it completes or times out.
//
// MCP connect is not session-scoped (it discovers tools at the server level),
// so it always routes to the default runner queue regardless of routing mode.
// Session-scoped MCP tool invocation during execution is handled by the
// execution workflow's activity routing, not by this connect flow.
func (c *McpServerController) executeConnectWorkflow(
	ctx context.Context,
	mcpServer *mcpserverv1.McpServer,
	input connectWorkflowInput,
) (*connectWorkflowOutput, error) {
	mcpServerID := mcpServer.GetMetadata().GetId()
	run, err := c.startConnectWorkflow(ctx, mcpServerID, input)
	if err != nil {
		log.Error().Err(err).
			Str("mcp_server_id", mcpServerID).
			Msg("Failed to start MCP connect workflow")
		return nil, grpclib.InternalError(err, "failed to start connect workflow")
	}

	var result connectWorkflowOutput
	if err := run.Get(ctx, &result); err != nil {
		log.Error().Err(err).
			Str("workflow_id", run.GetID()).
			Str("mcp_server_id", mcpServerID).
			Msg("MCP connect workflow failed")

		var appErr *temporal.ApplicationError
		var timeoutErr *temporal.TimeoutError
		var notFoundErr *serviceerror.NotFound

		switch {
		case errors.As(err, &appErr):
			// FAILED_PRECONDITION, not INTERNAL (issue #239): an application
			// error from the connect workflow means the TARGET server (or its
			// credentials/config) refused the connect — the runner's message is
			// crafted for the user, and clients render FAILED_PRECONDITION
			// messages verbatim while (correctly) hiding INTERNAL detail.
			return nil, status.Error(codes.FailedPrecondition,
				buildConnectFailureMessage(mcpServer, appErr.Message()))
		case errors.As(err, &timeoutErr):
			// Name the budget that fired (issue #243): the runner's own bounds
			// fail earlier with specific, actionable errors, so reaching this
			// ceiling usually means the runner never served the task at all.
			return nil, status.Errorf(codes.DeadlineExceeded,
				"connect did not complete within the %s budget for MCP server '%s' — "+
					"if this repeats, check that your runner is running and healthy",
				connectTimeout, mcpServerID)
		case errors.As(err, &notFoundErr):
			return nil, grpclib.UnavailableError(
				"connect service temporarily unavailable for MCP server '%s'", mcpServerID)
		default:
			// Deliberate exception to the "internal causes stay off the wire"
			// rule (stigmer/stigmer#478): the cause here is the runner's own
			// CLASSIFIED, user-facing connect-failure text (see the runner's
			// error classification and buildConnectFailureMessage below), not
			// raw server internals. Connect failures are user-debugged
			// configuration problems — the classified cause is the product.
			return nil, status.Error(codes.Internal,
				buildConnectFailureMessage(mcpServer, err.Error()))
		}
	}

	return &result, nil
}

// buildConnectFailureMessage builds a user-facing, transport-aware connect
// failure message, replacing the raw ExceptionGroup/TaskGroup text that told
// users nothing.
//
// In the OSS/local edition the local runner spawns stdio servers on the user's
// own machine, so a stdio failure is usually a missing command or bad
// args/environment — and previewing discovery locally with --dry-run is the
// fastest way to diagnose it. HTTP servers fail on reachability or credentials.
func buildConnectFailureMessage(mcpServer *mcpserverv1.McpServer, cause string) string {
	name := mcpServer.GetMetadata().GetName()
	// The runner classifies a 401 OAuth challenge into a self-contained,
	// user-facing message (see runner mcp-oauth-detect.ts). It already names the
	// server and tells the user to sign in, so pass it through verbatim rather
	// than wrapping it with a generic "check your credentials" suffix that would
	// contradict it. The "requires OAuth" phrase is the stable marker.
	if strings.Contains(cause, "requires OAuth") {
		return cause
	}
	if mcpServer.GetSpec().GetStdio() != nil {
		slug := mcpServer.GetMetadata().GetSlug()
		return fmt.Sprintf(
			"connect failed for MCP server '%s': %s. This is a stdio server launched "+
				"by your local runner — verify the command is installed and its arguments "+
				"and environment variables are correct. Preview discovery locally with: "+
				"stigmer connect mcp-server %s --dry-run",
			name, cause, slug)
	}
	return fmt.Sprintf(
		"connect failed for MCP server '%s': %s. Check that the server URL is "+
			"reachable and your credentials are valid.",
		name, cause)
}

// convertToDiscoveredCapabilities converts the Temporal workflow output
// to the proto DiscoveredCapabilities message.
func convertToDiscoveredCapabilities(output *connectWorkflowOutput) *mcpserverv1.DiscoveredCapabilities {
	capabilities := &mcpserverv1.DiscoveredCapabilities{
		LastDiscoveredAt: timestamppb.Now(),
	}

	for _, t := range output.Tools {
		tool := &mcpserverv1.DiscoveredTool{
			Name:        t.Name,
			Description: t.Description,
		}
		if t.InputSchema != nil {
			if s, err := structpb.NewStruct(t.InputSchema); err == nil {
				tool.InputSchema = s
			}
		}
		capabilities.Tools = append(capabilities.Tools, tool)
	}

	for _, rt := range output.ResourceTemplates {
		capabilities.ResourceTemplates = append(capabilities.ResourceTemplates, &mcpserverv1.DiscoveredResourceTemplate{
			UriTemplate: rt.URITemplate,
			Name:        rt.Name,
			Description: rt.Description,
			MimeType:    rt.MimeType,
		})
	}

	return capabilities
}

// convertToToolApprovals converts the connect workflow's classifier output to
// the proto ToolApprovalPolicy list stored on McpServerStatus.tool_approvals.
//
// Presence in the list means "requires approval" — there is no boolean on the
// proto — so any entry explicitly marked requires_approval=false is dropped.
// Mirrors the Cloud (Java) StoreConnectResults converter so both editions
// persist identical classifier output (the historical OSS gap was that this
// list was never written at all, leaving layer 1 of the policy chain empty).
func convertToToolApprovals(output *connectWorkflowOutput) []*mcpserverv1.ToolApprovalPolicy {
	var approvals []*mcpserverv1.ToolApprovalPolicy
	for _, a := range output.ToolApprovals {
		if !a.RequiresApproval || a.ToolName == "" {
			continue
		}
		approvals = append(approvals, &mcpserverv1.ToolApprovalPolicy{
			ToolName:            a.ToolName,
			Message:             a.Message,
			FromDestructiveHint: a.FromDestructiveHint,
		})
	}
	return approvals
}

// setToolApprovalsFromConnect writes the freshly classified tool approvals onto
// the status, returning how many were applied.
//
// Overwrite-on-reconnect: a new non-empty result replaces the prior list so a
// reclassification takes effect. Preserve-on-empty: an empty result leaves the
// existing list untouched, so a degraded or older runner that returns nothing
// can never silently disarm previously persisted approval gates.
func setToolApprovalsFromConnect(status *mcpserverv1.McpServerStatus, output *connectWorkflowOutput) int {
	approvals := convertToToolApprovals(output)
	if len(approvals) > 0 {
		status.ToolApprovals = approvals
	}
	return len(approvals)
}

// persistConnectResult writes the connect workflow's output onto the McpServer
// status as a single atomic read-modify-write, returning the updated resource
// and the number of tool-approval gates applied.
//
// This is the one place connect output lands on the resource — both the
// synchronous Connect path and the best-effort auto-connect path route through
// it. The atomic UpdateResource is deliberate: the best-effort write can land
// up to connectTimeout after Apply returned, so a plain read-modify-write would
// risk clobbering a concurrent update (a manual reconnect or an edit) made in
// that window.
//
// The two status fields follow the deliberate Phase-6 asymmetry, unchanged:
//   - discovered_capabilities is a point-in-time snapshot, overwritten on every
//     connect.
//   - tool_approvals are safety-critical gates, so setToolApprovalsFromConnect
//     overwrites them only on a non-empty result and preserves them on an empty
//     one — a degraded or older runner can never silently disarm them.
//
// Returns store.ErrNotFound if the resource was deleted between the connect
// trigger and its completion (a real case for the background path); callers
// decide how to react.
func (c *McpServerController) persistConnectResult(
	ctx context.Context,
	mcpServerID string,
	output *connectWorkflowOutput,
) (*mcpserverv1.McpServer, int, error) {
	mcpServer := &mcpserverv1.McpServer{}
	var toolApprovalCount int

	err := c.store.UpdateResource(
		ctx,
		apiresourcekind.ApiResourceKind_mcp_server,
		mcpServerID,
		mcpServer,
		func() error {
			if mcpServer.Status == nil {
				mcpServer.Status = &mcpserverv1.McpServerStatus{}
			}
			mcpServer.Status.DiscoveredCapabilities = convertToDiscoveredCapabilities(output)
			toolApprovalCount = setToolApprovalsFromConnect(mcpServer.Status, output)
			return nil
		},
	)
	if err != nil {
		return nil, 0, err
	}

	return mcpServer, toolApprovalCount, nil
}

// refreshOAuthTokenIfNeeded checks whether the MCP server has an auth block
// with an existing OAuthGrant, and if the access token is expired, refreshes
// it using the refresh token from the grant's managed environment.
//
// This is the pre-flight check that ensures the Connect workflow (and
// agent execution) always sees a fresh token in the managed environment.
func (c *McpServerController) refreshOAuthTokenIfNeeded(
	ctx context.Context,
	mcpServer *mcpserverv1.McpServer,
	callerOrg string,
) error {
	auth := mcpServer.GetSpec().GetAuth()
	if auth == nil || c.oauthGrantStore == nil || c.managedEnvService == nil {
		return nil
	}

	mcpServerID := mcpServer.GetMetadata().GetId()

	// OSS mode: single user, empty identity_account_id.
	// Org comes from the caller's active org (matches how the grant was stored).
	grant, err := c.oauthGrantStore.Find(ctx, "", mcpServerID, callerOrg)
	if err != nil {
		log.Warn().Err(err).
			Str("mcp_server_id", mcpServerID).
			Msg("Failed to load OAuth grant for pre-flight check (non-fatal)")
		return nil
	}
	if grant == nil {
		return nil
	}

	if grant.EnvironmentID == "" {
		log.Warn().
			Str("mcp_server_id", mcpServerID).
			Msg("OAuth grant has no managed environment ID — user must re-authenticate via OAuth Connect")
		return nil
	}

	refreshToken, err := c.managedEnvService.ReadSecretValue(ctx, grant.EnvironmentID, grant.RefreshTokenEnvVar)
	if err != nil {
		log.Debug().Err(err).
			Str("mcp_server_id", mcpServerID).
			Str("refresh_token_var", grant.RefreshTokenEnvVar).
			Str("managed_env_id", grant.EnvironmentID).
			Msg("No refresh token found in managed environment (may not be OAuth-connected)")
		return nil
	}

	// For vendor OAuth, we need the client_secret. For DCR, it's empty.
	var clientSecret string
	if grant.AuthMethod == "vendor_oauth" && c.encryptionService != nil {
		clientSecret, err = c.loadOAuthAppClientSecret(ctx, mcpServer)
		if err != nil {
			log.Warn().Err(err).
				Str("mcp_server_id", mcpServerID).
				Msg("Failed to load OAuthApp client secret for refresh")
		}
	}

	result, err := oauth.RefreshTokenIfExpired(
		ctx, grant, refreshToken, clientSecret,
	)
	if err != nil {
		return grpclib.FailedPreconditionError("%v", err)
	}

	if !result.Refreshed {
		return nil
	}

	// Write refreshed tokens to the grant's managed environment
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

	if err := c.managedEnvService.UpdateSecrets(ctx, grant.EnvironmentID, tokenVars); err != nil {
		return grpclib.InternalError(err, "failed to update refreshed tokens in managed environment")
	}

	grant.AccessTokenExpiresAt = result.NewExpiresAt
	if err := c.oauthGrantStore.Upsert(ctx, grant); err != nil {
		log.Warn().Err(err).
			Str("mcp_server_id", mcpServerID).
			Msg("Failed to update OAuth grant after refresh (non-fatal)")
	}

	return nil
}

// loadOAuthAppClientSecret loads and decrypts the client_secret from the
// referenced OAuthApp for vendor OAuth token refresh.
func (c *McpServerController) loadOAuthAppClientSecret(
	ctx context.Context,
	mcpServer *mcpserverv1.McpServer,
) (string, error) {
	ref := mcpServer.GetSpec().GetAuth().GetOauthAppRef()
	if ref == nil || ref.GetSlug() == "" {
		return "", nil
	}

	oauthApps, err := c.store.ListResources(ctx, apiresourcekind.ApiResourceKind_oauth_app)
	if err != nil {
		return "", fmt.Errorf("failed to list oauth apps: %w", err)
	}

	for _, data := range oauthApps {
		app := &oauthappv1.OAuthApp{}
		if err := proto.Unmarshal(data, app); err != nil {
			continue
		}
		if app.GetMetadata().GetSlug() == ref.GetSlug() {
			secret := app.GetSpec().GetClientSecret()
			if c.encryptionService != nil && c.encryptionService.IsEncrypted(secret) {
				return c.encryptionService.Decrypt(secret)
			}
			return secret, nil
		}
	}

	return "", fmt.Errorf("OAuthApp '%s' not found", ref.GetSlug())
}

// StartBestEffortConnect runs the connect workflow for a freshly applied MCP
// server and persists its discovered capabilities + classifier tool-approvals.
//
// Apply launches it in a goroutine, so it is fire-and-forget from the caller's
// view: it awaits the workflow result on its own bounded background context and
// every failure is logged, never propagated. Persistence is shared with the
// synchronous Connect path via persistConnectResult, so auto-connect and manual
// connect store byte-identical results.
//
// Skips when the MCP server declares env vars, because creating an
// ExecutionContext requires the caller's gRPC context (for personal environment
// resolution), which is unavailable in a background goroutine. Users must
// trigger a manual connect for those servers.
//
// If the server is deleted before the workflow completes, persistence is
// skipped (store.ErrNotFound) — expected for best-effort.
func (c *McpServerController) StartBestEffortConnect(
	mcpServer *mcpserverv1.McpServer,
) {
	if c.temporalClient == nil {
		return
	}

	if len(mcpServer.GetSpec().GetEnv()) > 0 {
		log.Debug().
			Str("mcp_server_id", mcpServer.GetMetadata().GetId()).
			Int("env_keys", len(mcpServer.GetSpec().GetEnv())).
			Msg("Skipping best-effort auto-connect: MCP server has env declarations (requires manual connect)")
		return
	}

	mcpServerID := mcpServer.GetMetadata().GetId()

	ctx, cancel := context.WithTimeout(context.Background(), connectTimeout+bestEffortConnectGetBuffer)
	defer cancel()

	run, err := c.startConnectWorkflow(ctx, mcpServerID, connectWorkflowInput{McpServerID: mcpServerID})
	if err != nil {
		log.Warn().Err(err).
			Str("mcp_server_id", mcpServerID).
			Msg("Failed to start best-effort connect workflow (non-fatal)")
		return
	}

	var result connectWorkflowOutput
	if err := run.Get(ctx, &result); err != nil {
		log.Warn().Err(err).
			Str("workflow_id", run.GetID()).
			Str("mcp_server_id", mcpServerID).
			Msg("Best-effort connect workflow did not complete (non-fatal)")
		return
	}

	persisted, toolApprovalCount, err := c.persistConnectResult(ctx, mcpServerID, &result)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			log.Info().
				Str("mcp_server_id", mcpServerID).
				Msg("Skipping best-effort connect persistence: MCP server deleted before connect completed")
			return
		}
		log.Warn().Err(err).
			Str("mcp_server_id", mcpServerID).
			Msg("Failed to persist best-effort connect result (non-fatal)")
		return
	}

	capabilities := persisted.GetStatus().GetDiscoveredCapabilities()
	log.Info().
		Str("workflow_id", run.GetID()).
		Str("mcp_server_id", mcpServerID).
		Int("tools", len(capabilities.GetTools())).
		Int("resource_templates", len(capabilities.GetResourceTemplates())).
		Int("tool_approvals", toolApprovalCount).
		Msg("Best-effort auto-connect completed and stored")
}
