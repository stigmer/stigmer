package workflows

import (
	"context"
	"fmt"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/domains"
	stigmergrpc "github.com/stigmer/stigmer/mcp-server/internal/grpc"
)

// Delete removes a workflow identified by org and slug. It first resolves the
// org/slug pair to a resource ID via GetByReference, then calls the
// CommandController.Delete RPC. Both calls share a single gRPC connection.
func Delete(ctx context.Context, serverAddress, org, slug string) (string, error) {
	conn, err := stigmergrpc.NewConnection(serverAddress, auth.APIKey(ctx))
	if err != nil {
		return "", fmt.Errorf("workflows.Delete: %w", err)
	}
	defer conn.Close()

	rpcCtx, cancel := context.WithTimeout(ctx, stigmergrpc.DefaultRPCTimeout)
	defer cancel()

	resourceDesc := fmt.Sprintf("workflow %q in org %q", slug, org)

	queryClient := workflowv1.NewWorkflowQueryControllerClient(conn)
	workflow, err := queryClient.GetByReference(rpcCtx, &apiresource.ApiResourceReference{
		Org:  org,
		Kind: apiresourcekind.ApiResourceKind_workflow,
		Slug: slug,
	})
	if err != nil {
		return "", domains.RPCError(err, resourceDesc)
	}

	cmdClient := workflowv1.NewWorkflowCommandControllerClient(conn)
	deleted, err := cmdClient.Delete(rpcCtx, &workflowv1.WorkflowId{
		Value: workflow.GetMetadata().GetId(),
	})
	if err != nil {
		return "", domains.RPCError(err, resourceDesc)
	}

	return domains.MarshalJSON(deleted)
}
