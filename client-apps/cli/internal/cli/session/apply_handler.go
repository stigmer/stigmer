package session

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	sessionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/applier"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

type applyHandler struct{}

// NewApplyHandler returns an ApplyHandler for Session resources.
func NewApplyHandler() applier.ApplyHandler { return &applyHandler{} }

func (h *applyHandler) Kind() apiresourcekind.ApiResourceKind {
	return apiresourcekind.ApiResourceKind_session
}

func (h *applyHandler) LoadFromBytes(raw []byte) (proto.Message, error) {
	result, err := LoadFromBytes(raw)
	if err != nil {
		return nil, errors.Wrap(err, "failed to load session")
	}
	return result.Session, nil
}

func (h *applyHandler) Validate(proto.Message) error { return nil }

func (h *applyHandler) Metadata(msg proto.Message) *apiresource.ApiResourceMetadata {
	return msg.(*sessionv1.Session).Metadata
}

func (h *applyHandler) Apply(ctx context.Context, conn grpc.ClientConnInterface, msg proto.Message) (*applier.ApplyResult, error) {
	s := msg.(*sessionv1.Session)

	if s.Metadata == nil {
		s.Metadata = &apiresource.ApiResourceMetadata{}
	}

	isCreate := s.Metadata.Id == ""

	client := sessionv1.NewSessionCommandControllerClient(conn)
	result, err := client.Apply(ctx, s)
	if err != nil {
		return nil, errors.Wrap(err, "failed to apply session")
	}

	return &applier.ApplyResult{
		Resource: result,
		Created:  isCreate,
	}, nil
}

func (h *applyHandler) BuildDryRunResult(msg proto.Message) *clioutput.CommandResult {
	s := msg.(*sessionv1.Session)
	out := clioutput.Success("Dry run: %s is valid", s.Metadata.Name)
	sec := out.AddSection("Session Preview")
	sec.Field("Name", s.Metadata.Name)
	if s.Spec != nil {
		if s.Spec.AgentInstanceId != "" {
			sec.Field("Agent Instance ID", s.Spec.AgentInstanceId)
		}
		if s.Spec.Subject != "" {
			sec.Field("Subject", s.Spec.Subject)
		}
		if len(s.Spec.WorkspaceEntries) > 0 {
			sec.Fieldf("Workspace Entries", "%d", len(s.Spec.WorkspaceEntries))
		}
		if len(s.Spec.McpServerUsages) > 0 {
			sec.Fieldf("MCP Servers", "%d", len(s.Spec.McpServerUsages))
		}
		if len(s.Spec.SkillRefs) > 0 {
			sec.Fieldf("Skills", "%d", len(s.Spec.SkillRefs))
		}
	}
	return out
}

func (h *applyHandler) BuildApplyResult(msg proto.Message, created bool) *clioutput.CommandResult {
	s := msg.(*sessionv1.Session)
	action := "updated"
	if created {
		action = "created"
	}
	out := clioutput.Success("Session %s successfully", action)
	out.AddSection("Resource Details").
		Field("ID", s.Metadata.Id).
		Field("Name", s.Metadata.Name).
		Field("Slug", s.Metadata.Slug)
	if s.Spec != nil && s.Spec.AgentInstanceId != "" {
		out.AddSection("Configuration").
			Field("Agent Instance ID", s.Spec.AgentInstanceId).
			Field("MCP Servers", fmt.Sprintf("%d", len(s.Spec.McpServerUsages))).
			Field("Workspace Entries", fmt.Sprintf("%d", len(s.Spec.WorkspaceEntries)))
	}
	out.Hintf("View details: stigmer get session %s", s.Metadata.Id)
	out.Hintf("Delete:       stigmer delete session %s", s.Metadata.Id)
	return out
}

func init() {
	var _ applier.ApplyHandler = (*applyHandler)(nil)
}
