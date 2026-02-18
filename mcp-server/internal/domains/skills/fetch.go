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

// Fetch retrieves a skill by org, slug, and optional version, returning its
// JSON representation. Pass an empty version string to get the latest version.
func Fetch(ctx context.Context, serverAddress, org, slug, version string) (string, error) {
	conn, err := stigmergrpc.NewConnection(serverAddress, auth.APIKey(ctx))
	if err != nil {
		return "", fmt.Errorf("skills.Fetch: %w", err)
	}
	defer conn.Close()

	rpcCtx, cancel := context.WithTimeout(ctx, stigmergrpc.DefaultRPCTimeout)
	defer cancel()

	client := skillv1.NewSkillQueryControllerClient(conn)
	skill, err := client.GetByReference(rpcCtx, &apiresource.ApiResourceReference{
		Org:     org,
		Kind:    apiresourcekind.ApiResourceKind_skill,
		Slug:    slug,
		Version: version,
	})
	if err != nil {
		return "", domains.RPCError(err, fmt.Sprintf("skill %q in org %q", slug, org))
	}

	return domains.MarshalJSON(skill)
}
