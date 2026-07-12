package agent

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
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

// RotateShareLink rotates an agent's share-link token.
//
// Generates fresh server-side entropy for status.share_link_token — this
// handler is the field's sole writer; clients never supply the token. After
// rotation the hosted chat link only resolves with the new ?k=<token>, and
// the previous link (tokened or plain) stops working immediately.
//
// The token lives in status — not spec.sharing — so manifest applies can
// never wipe it and silently fail open to the plain guessable URL (status
// is preserved verbatim across every update in both editions).
func (c *AgentController) RotateShareLink(
	ctx context.Context,
	input *agentv1.RotateShareLinkInput,
) (*agentv1.Agent, error) {
	reqCtx := pipeline.NewRequestContext(ctx, input)

	p := c.buildRotateShareLinkPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	agent := reqCtx.Get(rotateShareLinkAgentKey).(*agentv1.Agent)
	return agent, nil
}

const rotateShareLinkAgentKey = "rotateShareLinkAgent"

func (c *AgentController) buildRotateShareLinkPipeline() *pipeline.Pipeline[*agentv1.RotateShareLinkInput] {
	return pipeline.NewPipeline[*agentv1.RotateShareLinkInput]("agent-rotate-share-link").
		AddStep(steps.NewValidateProtoStep[*agentv1.RotateShareLinkInput]()).
		AddStep(&loadAgentForShareLinkRotationStep{store: c.store}).
		AddStep(&rotateShareLinkTokenStep{}).
		AddStep(&persistAgentForShareLinkRotationStep{store: c.store}).
		Build()
}

func generateShareLinkToken() (string, error) {
	bytes := make([]byte, shareLinkTokenBytes)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("failed to generate share-link token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

// loadAgentForShareLinkRotationStep loads the agent by resource_id.
type loadAgentForShareLinkRotationStep struct {
	store store.Store
}

func (s *loadAgentForShareLinkRotationStep) Name() string {
	return "LoadAgentForShareLinkRotation"
}

func (s *loadAgentForShareLinkRotationStep) Execute(ctx *pipeline.RequestContext[*agentv1.RotateShareLinkInput]) error {
	input := ctx.Input()

	agent := &agentv1.Agent{}
	err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent, input.GetResourceId(), agent)
	if err != nil {
		return grpclib.NotFoundError("agent", input.GetResourceId())
	}

	ctx.Set(rotateShareLinkAgentKey, agent)
	return nil
}

// rotateShareLinkTokenStep sets status.share_link_token to fresh entropy,
// preserving the rest of status (default_instance_id, audit) and updating
// the audit fields — the same status-preserving discipline as the update
// pipeline's BuildUpdateStateStep.
type rotateShareLinkTokenStep struct{}

func (s *rotateShareLinkTokenStep) Name() string {
	return "RotateShareLinkToken"
}

func (s *rotateShareLinkTokenStep) Execute(ctx *pipeline.RequestContext[*agentv1.RotateShareLinkInput]) error {
	agent := ctx.Get(rotateShareLinkAgentKey).(*agentv1.Agent)

	token, err := generateShareLinkToken()
	if err != nil {
		return grpclib.InternalError(err, "failed to rotate share link")
	}

	if agent.Status == nil {
		agent.Status = &agentv1.AgentStatus{}
	}
	agent.Status.ShareLinkToken = token

	if err := steps.SetAuditFieldsForUpdate(agent); err != nil {
		return fmt.Errorf("failed to set audit fields: %w", err)
	}

	ctx.Set(rotateShareLinkAgentKey, agent)
	return nil
}

// persistAgentForShareLinkRotationStep saves the updated agent.
type persistAgentForShareLinkRotationStep struct {
	store store.Store
}

func (s *persistAgentForShareLinkRotationStep) Name() string {
	return "PersistAgentForShareLinkRotation"
}

func (s *persistAgentForShareLinkRotationStep) Execute(ctx *pipeline.RequestContext[*agentv1.RotateShareLinkInput]) error {
	agent := ctx.Get(rotateShareLinkAgentKey).(*agentv1.Agent)

	err := s.store.SaveResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent, agent.GetMetadata().GetId(), agent)
	if err != nil {
		return grpclib.InternalError(err, "failed to save agent")
	}

	return nil
}
