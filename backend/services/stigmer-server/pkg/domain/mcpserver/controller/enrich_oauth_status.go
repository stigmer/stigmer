package mcpserver

import (
	"github.com/rs/zerolog/log"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	oauthappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// enrichOAuthStatusStep populates status.oauth_status on a loaded McpServer
// from the OAuthApp its spec.auth.oauth_app_ref points to, mirroring the
// cloud's McpServerVendorApprovalEnricher so the shared SDK's
// vendor-approval-blocked UI (VendorApprovalBlockedNotice) renders
// identically on both editions (stigmer/stigmer#523). Without it, an OSS
// user's first hint that OAuth sign-in is vendor-blocked is the initiate
// RPC's refusal — after they click.
//
// Semantics shared with the cloud enricher:
//   - Servers without an oauth_app_ref (DCR or manual-token) are untouched.
//   - A missing OAuthApp skips enrichment (the initiate path owns refusing).
//   - oauth_status is set only when there is something to gate on: a
//     non-default vendor_approval_status or a docs URL. Its very presence is
//     the signal the SDK keys on, so "nothing to report" means absent.
//   - The fields are response-only, per the OAuthStatus proto contract.
//     Nothing here persists: get pipelines don't save, and the write
//     pipelines clear client-sent status (BuildNewState/BuildUpdateState),
//     so a round-tripped enriched read cannot leak into the store.
//
// One deliberate divergence from cloud: a store failure during the lookup
// degrades to an unenriched response (WARN) instead of failing the read.
// Enrichment is advisory — the initiate RPC's vendor refusal remains the
// enforcement boundary — and an advisory lookup must not take down the
// primary read path.
//
// The step is generic over the pipeline input type because it serves both
// read pipelines (get takes an ApiResourceId, getByReference an
// ApiResourceReference); it only touches the already-loaded target resource.
type enrichOAuthStatusStep[T proto.Message] struct {
	store store.Store
}

func newEnrichOAuthStatusStep[T proto.Message](s store.Store) *enrichOAuthStatusStep[T] {
	return &enrichOAuthStatusStep[T]{store: s}
}

func (s *enrichOAuthStatusStep[T]) Name() string {
	return "EnrichOAuthStatus"
}

func (s *enrichOAuthStatusStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	mcpServer, ok := ctx.Get(steps.TargetResourceKey).(*mcpserverv1.McpServer)
	if !ok {
		return nil
	}

	ref := mcpServer.GetSpec().GetAuth().GetOauthAppRef()
	if ref.GetSlug() == "" {
		return nil
	}

	oauthApp, err := resolveOAuthAppByRef(ctx.Context(), s.store, ref)
	if err != nil {
		log.Warn().Err(err).
			Str("mcp_server_id", mcpServer.GetMetadata().GetId()).
			Str("oauth_app_slug", ref.GetSlug()).
			Msg("OAuthApp lookup failed; returning MCP server without oauth_status enrichment")
		return nil
	}
	if oauthApp == nil {
		log.Debug().
			Str("mcp_server_id", mcpServer.GetMetadata().GetId()).
			Str("oauth_app_slug", ref.GetSlug()).
			Msg("OAuthApp not found for ref; skipping oauth_status enrichment")
		return nil
	}

	approvalStatus := oauthApp.GetSpec().GetVendorApprovalStatus()
	docsURL := oauthApp.GetSpec().GetVendorApprovalDocsUrl()
	if approvalStatus == oauthappv1.VendorApprovalStatus_VENDOR_APPROVAL_STATUS_UNSPECIFIED &&
		docsURL == "" {
		return nil
	}

	if mcpServer.Status == nil {
		mcpServer.Status = &mcpserverv1.McpServerStatus{}
	}
	mcpServer.Status.OauthStatus = &mcpserverv1.OAuthStatus{
		VendorApprovalStatus:  approvalStatus,
		VendorApprovalDocsUrl: docsURL,
	}

	return nil
}
