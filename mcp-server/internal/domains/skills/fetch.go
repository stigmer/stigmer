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

// Fetch retrieves a skill by org, slug, and optional version, returning its
// JSON representation. Pass an empty version string to get the latest version.
// Both tool and resource handlers delegate to this function for the actual RPC.
func Fetch(ctx context.Context, serverAddress, org, slug, version string) (string, error) {
	return domains.WithConnection(ctx, serverAddress,
		func(ctx context.Context, conn *grpc.ClientConn) (string, error) {
			client := skillv1.NewSkillQueryControllerClient(conn)
			skill, err := client.GetByReference(ctx, &apiresource.ApiResourceReference{
				Org:     org,
				Kind:    apiresourcekind.ApiResourceKind_skill,
				Slug:    slug,
				Version: version,
			})
			if err != nil {
				return "", domains.RPCError(err, fmt.Sprintf("skill %q in org %q", slug, org))
			}
			return domains.MarshalJSON(skill)
		})
}
