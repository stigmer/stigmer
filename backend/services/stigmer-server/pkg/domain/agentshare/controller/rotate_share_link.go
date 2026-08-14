package agentshare

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"

	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// shareLinkTokenBytes is the entropy behind a rotated link: 20 bytes → 27
// url-safe base64 characters. Comfortably beyond guessability for a
// rate-limited public endpoint while keeping the share URL short.
const shareLinkTokenBytes = 20

// RotateShareLink rotates a share's link token.
//
// Generates fresh server-side entropy for status.share_link_token — this
// handler is the field's sole writer; clients never supply the token. After
// rotation the hosted chat link only resolves with the new ?k=<token>, and
// the previous link (tokened or plain) stops working immediately.
//
// The token lives in status — not spec — so manifest applies can never
// wipe it and silently fail open to the plain guessable URL (status is
// preserved verbatim across every update in both editions).
func (c *AgentShareController) RotateShareLink(
	ctx context.Context,
	input *agentsharev1.RotateShareLinkInput,
) (*agentsharev1.AgentShare, error) {
	reqCtx := pipeline.NewRequestContext(ctx, input)

	p := c.buildRotateShareLinkPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	share := reqCtx.Get(rotateShareLinkShareKey).(*agentsharev1.AgentShare)
	return share, nil
}

const rotateShareLinkShareKey = "rotateShareLinkShare"

func (c *AgentShareController) buildRotateShareLinkPipeline() *pipeline.Pipeline[*agentsharev1.RotateShareLinkInput] {
	return pipeline.NewPipeline[*agentsharev1.RotateShareLinkInput]("agent-share-rotate-share-link").
		AddStep(steps.NewValidateProtoStep[*agentsharev1.RotateShareLinkInput]()).
		AddStep(&loadShareForLinkRotationStep{store: c.store}).
		AddStep(&rotateShareLinkTokenStep{}).
		AddStep(&persistShareForLinkRotationStep{store: c.store}).
		Build()
}

func generateShareLinkToken() (string, error) {
	bytes := make([]byte, shareLinkTokenBytes)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("failed to generate share-link token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

// loadShareForLinkRotationStep loads the share by resource_id.
type loadShareForLinkRotationStep struct {
	store store.Store
}

func (s *loadShareForLinkRotationStep) Name() string {
	return "LoadShareForLinkRotation"
}

func (s *loadShareForLinkRotationStep) Execute(ctx *pipeline.RequestContext[*agentsharev1.RotateShareLinkInput]) error {
	input := ctx.Input()

	share := &agentsharev1.AgentShare{}
	err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent_share, input.GetResourceId(), share)
	if err != nil {
		return grpclib.NotFoundError("AgentShare", input.GetResourceId())
	}

	ctx.Set(rotateShareLinkShareKey, share)
	return nil
}

// rotateShareLinkTokenStep sets status.share_link_token to fresh entropy,
// preserving the rest of status (audit) and updating the audit fields —
// the same status-preserving discipline as the update pipeline's
// BuildUpdateStateStep.
type rotateShareLinkTokenStep struct{}

func (s *rotateShareLinkTokenStep) Name() string {
	return "RotateShareLinkToken"
}

func (s *rotateShareLinkTokenStep) Execute(ctx *pipeline.RequestContext[*agentsharev1.RotateShareLinkInput]) error {
	share := ctx.Get(rotateShareLinkShareKey).(*agentsharev1.AgentShare)

	token, err := generateShareLinkToken()
	if err != nil {
		return grpclib.InternalError(err, "failed to rotate share link")
	}

	if share.Status == nil {
		share.Status = &agentsharev1.AgentShareStatus{}
	}
	share.Status.ShareLinkToken = token

	if err := steps.SetAuditFieldsForUpdate(share, steps.StatusAudit); err != nil {
		return fmt.Errorf("failed to set audit fields: %w", err)
	}

	ctx.Set(rotateShareLinkShareKey, share)
	return nil
}

// persistShareForLinkRotationStep saves the updated share.
type persistShareForLinkRotationStep struct {
	store store.Store
}

func (s *persistShareForLinkRotationStep) Name() string {
	return "PersistShareForLinkRotation"
}

func (s *persistShareForLinkRotationStep) Execute(ctx *pipeline.RequestContext[*agentsharev1.RotateShareLinkInput]) error {
	share := ctx.Get(rotateShareLinkShareKey).(*agentsharev1.AgentShare)

	err := s.store.SaveResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent_share, share.GetMetadata().GetId(), share)
	if err != nil {
		return grpclib.InternalError(err, "failed to save agent share")
	}

	return nil
}
