package workflows

import (
	"context"
	"fmt"

	"github.com/stigmer/stigmer/mcp-server/internal/domains"
	workflowv1 "github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/grpc"
)

// Delete removes a workflow identified by org and slug. It first resolves the
// org/slug pair to a resource ID via GetByReference, then calls the
// CommandController.Delete RPC. Both calls share a single gRPC connection.
func Delete(ctx context.Context, serverAddress, org, slug string) (string, error) {
	return domains.WithConnection(ctx, serverAddress,
		func(ctx context.Context, conn *grpc.ClientConn) (string, error) {
			desc := fmt.Sprintf("workflow %q in org %q", slug, org)

			queryClient := workflowv1.NewWorkflowQueryControllerClient(conn)
			workflow, err := queryClient.GetByReference(ctx, &apiresource.ApiResourceReference{
				Org:  org,
				Kind: apiresourcekind.ApiResourceKind_workflow,
				Slug: slug,
			})
			if err != nil {
				return "", domains.RPCError(err, desc)
			}

			cmdClient := workflowv1.NewWorkflowCommandControllerClient(conn)
			deleted, err := cmdClient.Delete(ctx, &workflowv1.WorkflowId{
				Value: workflow.GetMetadata().GetId(),
			})
			if err != nil {
				return "", domains.RPCError(err, desc)
			}

			return domains.MarshalJSON(deleted)
		})
}
