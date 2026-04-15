package agentinstance

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/applier"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

type applyHandler struct{}

// NewApplyHandler returns an ApplyHandler for AgentInstance resources.
func NewApplyHandler() applier.ApplyHandler { return &applyHandler{} }

func (h *applyHandler) Kind() apiresourcekind.ApiResourceKind {
	return apiresourcekind.ApiResourceKind_agent_instance
}

func (h *applyHandler) LoadFromBytes(raw []byte) (proto.Message, error) {
	result, err := LoadFromBytes(raw)
	if err != nil {
		return nil, errors.Wrap(err, "failed to load agent instance")
	}
	return result.AgentInstance, nil
}

func (h *applyHandler) Validate(proto.Message) error { return nil }

func (h *applyHandler) Metadata(msg proto.Message) *apiresource.ApiResourceMetadata {
	return msg.(*agentinstancev1.AgentInstance).Metadata
}

func (h *applyHandler) Apply(ctx context.Context, conn grpc.ClientConnInterface, msg proto.Message) (*applier.ApplyResult, error) {
	ai := msg.(*agentinstancev1.AgentInstance)

	if ai.Metadata == nil {
		ai.Metadata = &apiresource.ApiResourceMetadata{}
	}

	isCreate := ai.Metadata.Id == ""

	client := agentinstancev1.NewAgentInstanceCommandControllerClient(conn)
	result, err := client.Apply(ctx, ai)
	if err != nil {
		return nil, errors.Wrap(err, "failed to apply agent instance")
	}

	return &applier.ApplyResult{
		Resource: result,
		Created:  isCreate,
	}, nil
}

func (h *applyHandler) BuildDryRunResult(msg proto.Message) *clioutput.CommandResult {
	ai := msg.(*agentinstancev1.AgentInstance)
	out := clioutput.Success("Dry run: %s is valid", ai.Metadata.Name)
	sec := out.AddSection("AgentInstance Preview")
	sec.Field("Name", ai.Metadata.Name)
	if ai.Spec != nil {
		sec.Field("Agent ID", ai.Spec.AgentId)
		if ai.Spec.Description != "" {
			sec.Field("Description", ai.Spec.Description)
		}
		if len(ai.Spec.EnvironmentRefs) > 0 {
			sec.Fieldf("Environments", "%d", len(ai.Spec.EnvironmentRefs))
		}
	}
	return out
}

func (h *applyHandler) BuildApplyResult(msg proto.Message, created bool) *clioutput.CommandResult {
	ai := msg.(*agentinstancev1.AgentInstance)
	action := "updated"
	if created {
		action = "created"
	}
	out := clioutput.Success("Agent instance %s successfully", action)
	out.AddSection("Resource Details").
		Field("ID", ai.Metadata.Id).
		Field("Name", ai.Metadata.Name).
		Field("Slug", ai.Metadata.Slug)
	if ai.Spec != nil {
		out.AddSection("Configuration").
			Field("Agent ID", ai.Spec.AgentId).
			Field("Environments", fmt.Sprintf("%d", len(ai.Spec.EnvironmentRefs)))
	}
	out.Hintf("View details: stigmer get agentinstance %s", ai.Metadata.Slug)
	out.Hintf("Delete:       stigmer delete agentinstance %s", ai.Metadata.Slug)
	return out
}

func init() {
	var _ applier.ApplyHandler = (*applyHandler)(nil)
}
