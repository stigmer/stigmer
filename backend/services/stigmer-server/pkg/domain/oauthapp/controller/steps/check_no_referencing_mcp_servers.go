package steps

import (
	"github.com/rs/zerolog/log"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	oauthappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	pipelinesteps "github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// checkNoReferencingMcpServersStep prevents deletion of an OAuthApp that
// is still referenced by one or more McpServer resources via
// spec.auth.oauth_app_ref.
//
// Requires LoadExistingForDeleteStep to have run first (the OAuthApp
// being deleted must be in ExistingResourceKey).
//
// The pipeline type parameter is ApiResourceDeleteInput (the delete RPC input),
// but the OAuthApp is read from the pipeline context where LoadExistingForDelete
// stored it.
type checkNoReferencingMcpServersStep struct {
	store store.Store
}

func NewCheckNoReferencingMcpServersStep(store store.Store) *checkNoReferencingMcpServersStep {
	return &checkNoReferencingMcpServersStep{store: store}
}

func (s *checkNoReferencingMcpServersStep) Name() string {
	return "CheckNoReferencingMcpServers"
}

func (s *checkNoReferencingMcpServersStep) Execute(ctx *pipeline.RequestContext[*apiresource.ApiResourceDeleteInput]) error {
	existingVal := ctx.Get(pipelinesteps.ExistingResourceKey)
	existing, ok := existingVal.(*oauthappv1.OAuthApp)
	if !ok || existing == nil {
		return grpclib.InternalError(nil, "existing OAuthApp not loaded in delete pipeline")
	}

	org := existing.GetMetadata().GetOrg()
	slug := existing.GetMetadata().GetSlug()

	resources, err := s.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_mcp_server)
	if err != nil {
		return grpclib.InternalError(err, "failed to list MCP servers for referential integrity check")
	}

	for _, data := range resources {
		mcp := &mcpserverv1.McpServer{}
		if err := proto.Unmarshal(data, mcp); err != nil {
			log.Warn().Err(err).Msg("Failed to unmarshal MCP server during referential integrity check, skipping")
			continue
		}

		ref := mcp.GetSpec().GetAuth().GetOauthAppRef()
		if ref == nil {
			continue
		}

		if ref.GetOrg() == org && ref.GetSlug() == slug {
			return grpclib.FailedPreconditionError(
				"cannot delete OAuthApp '%s/%s': referenced by MCP server '%s'",
				org, slug, mcp.GetMetadata().GetName())
		}
	}

	return nil
}
