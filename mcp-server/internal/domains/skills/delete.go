package skills

import (
	"context"
	"fmt"

	"github.com/stigmer/stigmer/mcp-server/internal/domains"
	skillv1 "github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/grpc"
)

// Delete removes a skill and all its versions, identified by org and slug.
// It first resolves the org/slug pair to a resource ID via GetByReference,
// then calls the CommandController.Delete RPC. Both calls share a single gRPC
// connection.
func Delete(ctx context.Context, serverAddress, org, slug string) (string, error) {
	return domains.WithConnection(ctx, serverAddress,
		func(ctx context.Context, conn *grpc.ClientConn) (string, error) {
			desc := fmt.Sprintf("skill %q in org %q", slug, org)

			queryClient := skillv1.NewSkillQueryControllerClient(conn)
			skill, err := queryClient.GetByReference(ctx, &apiresource.ApiResourceReference{
				Org:  org,
				Kind: apiresourcekind.ApiResourceKind_skill,
				Slug: slug,
			})
			if err != nil {
				return "", domains.RPCError(err, desc)
			}

			cmdClient := skillv1.NewSkillCommandControllerClient(conn)
			deleted, err := cmdClient.Delete(ctx, &skillv1.SkillId{
				Value: skill.GetMetadata().GetId(),
			})
			if err != nil {
				return "", domains.RPCError(err, desc)
			}

			return domains.MarshalJSON(deleted)
		})
}
