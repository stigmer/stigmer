package workflows

import (
	"context"
	"fmt"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/mcp-server/internal/domains"
	"google.golang.org/grpc"
)

// Apply creates or updates a workflow via the
// WorkflowCommandController.Apply RPC. The resourceJSON parameter must be a
// valid JSON representation of the Workflow protobuf message. Unknown fields
// are silently discarded.
func Apply(ctx context.Context, serverAddress, resourceJSON string) (string, error) {
	var workflow workflowv1.Workflow
	if err := domains.UnmarshalJSON(resourceJSON, &workflow); err != nil {
		return "", fmt.Errorf("invalid workflow JSON: %w", err)
	}

	return domains.WithConnection(ctx, serverAddress,
		func(ctx context.Context, conn *grpc.ClientConn) (string, error) {
			client := workflowv1.NewWorkflowCommandControllerClient(conn)
			result, err := client.Apply(ctx, &workflow)
			if err != nil {
				desc := fmt.Sprintf("workflow %q in org %q", workflow.GetMetadata().GetSlug(), workflow.GetMetadata().GetOrg())
				return "", domains.RPCError(err, desc)
			}
			return domains.MarshalJSON(result)
		})
}
