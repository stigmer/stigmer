package mcpserver

import (
	"context"
	"errors"

	"github.com/rs/zerolog/log"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	enums "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/client"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// StartConnect begins a connect operation and returns without waiting for it:
// the async lane of the connect contract (stigmer/stigmer#425).
//
// Everything that needs the caller's identity — OAuth refresh pre-flight,
// personal-environment resolution, ExecutionContext creation, token minting —
// runs synchronously here via prepareConnect, exactly as in the blocking
// Connect. Only awaiting the workflow moves to a background goroutine, which
// settles status.connect_status and cleans up the ExecutionContext when the
// run finishes. Clients poll get/getByReference until connect_status reaches
// a terminal phase.
//
// Idempotent while an operation is in flight, at two layers:
//   - Fast path: a live CONNECTING record whose workflow Temporal reports as
//     running returns immediately, before any ExecutionContext is created.
//   - Authoritative: the deterministic workflow ID makes Temporal refuse a
//     duplicate start in the residual race window; the refusal is turned into
//     the same attach semantics.
//
// A CONNECTING record whose run is NOT running (the backend restarted before
// its awaiter could settle, or Temporal lost the run) is not reconciled in
// place — the fresh start below overwrites it, which is both the repair and
// the caller's intent. Pollers guard against the stale window on their side
// by bounding their patience with started_at plus the connect ceiling.
func (c *McpServerController) StartConnect(
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

	if input.GetOrg() == "" {
		return nil, grpclib.InvalidArgumentError("org is required for connect")
	}

	mcpServer := &mcpserverv1.McpServer{}
	if err := c.store.GetResource(ctx, apiresourcekind.ApiResourceKind_mcp_server, mcpServerID, mcpServer); err != nil {
		return nil, grpclib.NotFoundError("mcp_server", mcpServerID)
	}

	if cs := mcpServer.GetStatus().GetConnectStatus(); cs.GetPhase() == mcpserverv1.ConnectPhase_connect_phase_connecting {
		if c.isConnectRunRunning(ctx, cs.GetWorkflowId()) {
			log.Info().
				Str("mcp_server_id", mcpServerID).
				Str("workflow_id", cs.GetWorkflowId()).
				Msg("StartConnect attached to in-flight connect operation")
			return mcpServer, nil
		}
	}

	wfInput, ecResourceID, executionID, err := c.prepareConnect(ctx, mcpServer, input)
	if err != nil {
		return nil, err
	}

	// Taken before the start so the advisory describes the queue the run is
	// about to join. Warn-only by design: a worker may be booting (the
	// pre-flight has a startup false-negative race), so the operation
	// proceeds either way and the poller renders the warning as context.
	warning := c.runnerQueueWarning(ctx)

	run, attached, err := c.startOrAttachConnectWorkflow(ctx, mcpServerID, wfInput, asyncConnectTimeout)
	if err != nil {
		if ecResourceID != "" {
			c.deleteConnectExecutionContext(ctx, ecResourceID, executionID)
		}
		log.Error().Err(err).
			Str("mcp_server_id", mcpServerID).
			Msg("Failed to start MCP connect workflow")
		return nil, grpclib.InternalError(err, "failed to start connect workflow")
	}

	if attached {
		// Lost the residual race to another lane: its run and CONNECTING
		// record stand, and the ExecutionContext prepared here is unused.
		if ecResourceID != "" {
			c.deleteConnectExecutionContext(ctx, ecResourceID, executionID)
		}
		if err := c.store.GetResource(ctx, apiresourcekind.ApiResourceKind_mcp_server, mcpServerID, mcpServer); err != nil {
			return nil, grpclib.NotFoundError("mcp_server", mcpServerID)
		}
		return mcpServer, nil
	}

	persisted, err := c.persistConnectStarting(ctx, mcpServerID, run.GetID(), warning)
	if err != nil {
		// The workflow is already running; hand it to the background settler
		// (which copes with a deleted resource) but fail the RPC honestly —
		// a caller that cannot observe CONNECTING cannot poll.
		go c.settleConnectAsync(mcpServer, run, ecResourceID, executionID)
		return nil, grpclib.InternalError(err, "failed to record connect operation")
	}

	go c.settleConnectAsync(mcpServer, run, ecResourceID, executionID)

	return persisted, nil
}

// settleConnectAsync awaits a connect workflow on a background context,
// records the terminal connect_status (with results on success), and cleans
// up the ephemeral ExecutionContext.
//
// The bounded background context follows the StartBestEffortConnect pattern:
// the workflow's own WorkflowRunTimeout is the deadline that should fire
// first, the slightly longer context only guarantees the goroutine can never
// leak if Temporal becomes unreachable. If this process dies before settling,
// the CONNECTING record goes stale; the next StartConnect overwrites it (see
// the orphan contract on ConnectStatus).
func (c *McpServerController) settleConnectAsync(
	mcpServer *mcpserverv1.McpServer,
	run client.WorkflowRun,
	ecResourceID string,
	executionID string,
) {
	ctx, cancel := context.WithTimeout(context.Background(), asyncConnectTimeout+bestEffortConnectGetBuffer)
	defer cancel()

	if ecResourceID != "" {
		defer c.deleteConnectExecutionContext(ctx, ecResourceID, executionID)
	}

	mcpServerID := mcpServer.GetMetadata().GetId()

	output, err := c.awaitConnectWorkflow(ctx, mcpServer, run, asyncConnectTimeout)
	if err != nil {
		c.persistConnectFailure(ctx, mcpServerID, err)
		return
	}

	persisted, toolApprovalCount, err := c.persistConnectResult(ctx, mcpServerID, run.GetID(), output)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			log.Info().
				Str("mcp_server_id", mcpServerID).
				Msg("Skipping async connect persistence: MCP server deleted before connect completed")
			return
		}
		log.Warn().Err(err).
			Str("mcp_server_id", mcpServerID).
			Msg("Failed to persist async connect result")
		return
	}

	capabilities := persisted.GetStatus().GetDiscoveredCapabilities()
	log.Info().
		Str("workflow_id", run.GetID()).
		Str("mcp_server_id", mcpServerID).
		Int("tools", len(capabilities.GetTools())).
		Int("resource_templates", len(capabilities.GetResourceTemplates())).
		Int("tool_approvals", toolApprovalCount).
		Msg("Async MCP server connect completed and stored")
}

// isConnectRunRunning reports whether the recorded connect workflow is still
// running. Errors (including a run Temporal no longer knows) report false:
// the caller falls through to a fresh start, where ExecuteWorkflow's
// AlreadyStarted refusal is the authoritative answer if this raced a live run.
func (c *McpServerController) isConnectRunRunning(ctx context.Context, workflowID string) bool {
	if workflowID == "" {
		return false
	}
	desc, err := c.temporalClient.DescribeWorkflowExecution(ctx, workflowID, "")
	if err != nil {
		return false
	}
	return desc.GetWorkflowExecutionInfo().GetStatus() == enums.WORKFLOW_EXECUTION_STATUS_RUNNING
}

// runnerQueueWarning returns the dead-runner advisory for connect_status, or
// "" when a worker is polling the runner task queue (or when the question
// cannot be answered — an unreachable Temporal should not cry wolf on an
// operation that is about to fail loudly anyway).
func (c *McpServerController) runnerQueueWarning(ctx context.Context) string {
	queue := c.temporalConfig.RunnerQueue
	resp, err := c.temporalClient.DescribeTaskQueue(ctx, queue, enums.TASK_QUEUE_TYPE_WORKFLOW)
	if err != nil {
		log.Debug().Err(err).
			Str("runner_queue", queue).
			Msg("Could not describe runner task queue for connect pre-flight")
		return ""
	}
	if len(resp.GetPollers()) > 0 {
		return ""
	}
	return "no runner appears to be polling the task queue — the connect will wait " +
		"for one to come up (start your local runner if it is not running)"
}

// persistConnectStarting records a freshly started connect operation as the
// resource's connect_status (phase CONNECTING), replacing whatever previous
// operation's record was there. Returns the updated resource — the payload
// StartConnect answers with.
func (c *McpServerController) persistConnectStarting(
	ctx context.Context,
	mcpServerID string,
	workflowID string,
	warning string,
) (*mcpserverv1.McpServer, error) {
	mcpServer := &mcpserverv1.McpServer{}
	err := c.store.UpdateResource(
		ctx,
		apiresourcekind.ApiResourceKind_mcp_server,
		mcpServerID,
		mcpServer,
		func() error {
			if mcpServer.Status == nil {
				mcpServer.Status = &mcpserverv1.McpServerStatus{}
			}
			mcpServer.Status.ConnectStatus = &mcpserverv1.ConnectStatus{
				Phase:      mcpserverv1.ConnectPhase_connect_phase_connecting,
				WorkflowId: workflowID,
				StartedAt:  timestamppb.Now(),
				Warning:    warning,
			}
			return nil
		},
	)
	if err != nil {
		return nil, err
	}
	return mcpServer, nil
}

// persistConnectFailure settles connect_status as FAILED with the mapped gRPC
// classification of the given error. Never propagates its own failure: every
// caller has already surfaced the connect failure on its own channel (RPC
// error or log), and a resource deleted mid-operation is expected.
func (c *McpServerController) persistConnectFailure(
	ctx context.Context,
	mcpServerID string,
	failure error,
) {
	mcpServer := &mcpserverv1.McpServer{}
	err := c.store.UpdateResource(
		ctx,
		apiresourcekind.ApiResourceKind_mcp_server,
		mcpServerID,
		mcpServer,
		func() error {
			if mcpServer.Status == nil {
				mcpServer.Status = &mcpserverv1.McpServerStatus{}
			}
			settleConnectStatus(
				mcpServer.Status,
				mcpServer.Status.GetConnectStatus().GetWorkflowId(),
				failure,
			)
			return nil
		},
	)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			log.Info().
				Str("mcp_server_id", mcpServerID).
				Msg("Skipping connect failure persistence: MCP server deleted before connect settled")
			return
		}
		log.Warn().Err(err).
			Str("mcp_server_id", mcpServerID).
			Msg("Failed to record connect failure on connect_status (non-fatal)")
	}
}
