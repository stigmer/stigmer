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

// Fetch retrieves a workflow by org and slug, returning its JSON
// representation.
func Fetch(ctx context.Context, serverAddress, org, slug string) (string, error) {
	conn, err := stigmergrpc.NewConnection(serverAddress, auth.APIKey(ctx))
	if err != nil {
		return "", fmt.Errorf("workflows.Fetch: %w", err)
	}
	defer conn.Close()

	rpcCtx, cancel := context.WithTimeout(ctx, stigmergrpc.DefaultRPCTimeout)
	defer cancel()

	client := workflowv1.NewWorkflowQueryControllerClient(conn)
	workflow, err := client.GetByReference(rpcCtx, &apiresource.ApiResourceReference{
		Org:  org,
		Kind: apiresourcekind.ApiResourceKind_workflow,
		Slug: slug,
	})
	if err != nil {
		return "", domains.RPCError(err, fmt.Sprintf("workflow %q in org %q", slug, org))
	}

	return domains.MarshalJSON(workflow)
}
