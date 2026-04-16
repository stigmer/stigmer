package agent

import (
	"context"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/applier"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/protobuf/proto"
)

type applyHandler struct{}

// NewApplyHandler returns an ApplyHandler for Agent resources.
func NewApplyHandler() applier.ApplyHandler { return &applyHandler{} }

func (h *applyHandler) Kind() apiresourcekind.ApiResourceKind {
	return apiresourcekind.ApiResourceKind_agent
}

func (h *applyHandler) LoadFromBytes(raw []byte) (proto.Message, error) {
	result, err := LoadFromBytes(raw)
	if err != nil {
		return nil, errors.Wrap(err, "failed to load agent")
	}
	return result.Agent, nil
}

func (h *applyHandler) Validate(msg proto.Message) error {
	return Validate(msg.(*agentv1.Agent))
}

func (h *applyHandler) Metadata(msg proto.Message) *apiresource.ApiResourceMetadata {
	return msg.(*agentv1.Agent).Metadata
}

func (h *applyHandler) Apply(ctx context.Context, client *stigmer.Client, msg proto.Message) (*applier.ApplyResult, error) {
	a := msg.(*agentv1.Agent)

	if a.Metadata == nil {
		a.Metadata = &apiresource.ApiResourceMetadata{}
	}

	isCreate := a.Metadata.Id == ""

	result, err := client.Agent.Apply(ctx, stigmer.AgentInputFromProto(a))
	if err != nil {
		return nil, errors.Wrap(err, "failed to apply agent")
	}

	return &applier.ApplyResult{
		Resource: result,
		Created:  isCreate,
	}, nil
}

func (h *applyHandler) BuildDryRunResult(msg proto.Message) *clioutput.CommandResult {
	a := msg.(*agentv1.Agent)
	out := clioutput.Success("Dry run: %s is valid", a.Metadata.Name)
	sec := out.AddSection("Agent Preview")
	sec.Field("Name", a.Metadata.Name)
	if a.Spec != nil {
		if a.Spec.Description != "" {
			sec.Field("Description", a.Spec.Description)
		}
		if a.Spec.Instructions != "" {
			sec.Field("Instructions", truncateForDisplay(a.Spec.Instructions, 80))
		}
		if len(a.Spec.McpServerUsages) > 0 {
			sec.Fieldf("MCP Servers", "%d", len(a.Spec.McpServerUsages))
		}
		if len(a.Spec.SkillRefs) > 0 {
			sec.Fieldf("Skills", "%d", len(a.Spec.SkillRefs))
		}
		if len(a.Spec.SubAgents) > 0 {
			sec.Fieldf("Sub-agents", "%d", len(a.Spec.SubAgents))
		}
	}
	return out
}

func (h *applyHandler) BuildApplyResult(msg proto.Message, created bool) *clioutput.CommandResult {
	a := msg.(*agentv1.Agent)
	action := "updated"
	if created {
		action = "created"
	}
	out := clioutput.Success("Agent %s successfully", action)
	out.AddSection("Resource Details").
		Field("ID", a.Metadata.Id).
		Field("Name", a.Metadata.Name).
		Field("Slug", a.Metadata.Slug)
	out.Hintf("View details: stigmer get agent %s", a.Metadata.Slug)
	out.Hintf("Run agent:    stigmer run agent %s", a.Metadata.Slug)
	out.Hintf("Delete:       stigmer delete agent %s", a.Metadata.Slug)
	return out
}

func truncateForDisplay(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	if maxLen <= 3 {
		return "..."
	}
	return s[:maxLen-3] + "..."
}

func init() {
	// Ensure applyHandler satisfies the interface at compile time.
	var _ applier.ApplyHandler = (*applyHandler)(nil)
}
