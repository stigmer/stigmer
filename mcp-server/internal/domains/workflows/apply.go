package workflows

import (
	"context"
	"fmt"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/domains"
	stigmergrpc "github.com/stigmer/stigmer/mcp-server/internal/grpc"
)

// Apply creates or updates a workflow via the
// WorkflowCommandController.apply RPC. The resourceJSON parameter must be a
// valid JSON representation of the Workflow protobuf message.
func Apply(ctx context.Context, serverAddress, resourceJSON string) (string, error) {
	var workflow workflowv1.Workflow
	if err := domains.UnmarshalJSON(resourceJSON, &workflow); err != nil {
		return "", fmt.Errorf("invalid workflow JSON: %w", err)
	}

	conn, err := stigmergrpc.NewConnection(serverAddress, auth.APIKey(ctx))
	if err != nil {
		return "", fmt.Errorf("workflows.Apply: %w", err)
	}
	defer conn.Close()

	rpcCtx, cancel := context.WithTimeout(ctx, stigmergrpc.DefaultRPCTimeout)
	defer cancel()

	client := workflowv1.NewWorkflowCommandControllerClient(conn)
	result, err := client.Apply(rpcCtx, &workflow)
	if err != nil {
		desc := fmt.Sprintf("workflow %q in org %q", workflow.GetMetadata().GetSlug(), workflow.GetMetadata().GetOrg())
		return "", domains.RPCError(err, desc)
	}

	return domains.MarshalJSON(result)
}
