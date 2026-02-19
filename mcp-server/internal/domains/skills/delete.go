package skills

import (
	"context"
	"fmt"

	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/domains"
	stigmergrpc "github.com/stigmer/stigmer/mcp-server/internal/grpc"
)

// Delete removes a skill and all its versions, identified by org and slug.
// It first resolves the org/slug pair to a resource ID via GetByReference,
// then calls the CommandController.Delete RPC. Both calls share a single gRPC
// connection.
func Delete(ctx context.Context, serverAddress, org, slug string) (string, error) {
	conn, err := stigmergrpc.NewConnection(serverAddress, auth.APIKey(ctx))
	if err != nil {
		return "", fmt.Errorf("skills.Delete: %w", err)
	}
	defer conn.Close()

	rpcCtx, cancel := context.WithTimeout(ctx, stigmergrpc.DefaultRPCTimeout)
	defer cancel()

	resourceDesc := fmt.Sprintf("skill %q in org %q", slug, org)

	queryClient := skillv1.NewSkillQueryControllerClient(conn)
	skill, err := queryClient.GetByReference(rpcCtx, &apiresource.ApiResourceReference{
		Org:  org,
		Kind: apiresourcekind.ApiResourceKind_skill,
		Slug: slug,
	})
	if err != nil {
		return "", domains.RPCError(err, resourceDesc)
	}

	cmdClient := skillv1.NewSkillCommandControllerClient(conn)
	deleted, err := cmdClient.Delete(rpcCtx, &skillv1.SkillId{
		Value: skill.GetMetadata().GetId(),
	})
	if err != nil {
		return "", domains.RPCError(err, resourceDesc)
	}

	return domains.MarshalJSON(deleted)
}
