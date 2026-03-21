package workflows

import (
	"context"
	"fmt"

	"github.com/stigmer/stigmer/mcp-server/internal/domains"
	workflowv1 "github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/agentic/workflow/v1"
	"google.golang.org/grpc"
)

// Apply creates or updates a workflow via the WorkflowCommandController.Apply RPC.
func Apply(ctx context.Context, serverAddress string, workflow *workflowv1.Workflow) (string, error) {
	return domains.WithConnection(ctx, serverAddress,
		func(ctx context.Context, conn *grpc.ClientConn) (string, error) {
			client := workflowv1.NewWorkflowCommandControllerClient(conn)
			result, err := client.Apply(ctx, workflow)
			if err != nil {
				desc := fmt.Sprintf("workflow %q in org %q", workflow.GetMetadata().GetSlug(), workflow.GetMetadata().GetOrg())
				return "", domains.RPCError(err, desc)
			}
			return domains.MarshalJSON(result)
		})
}
