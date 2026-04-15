package workflow

import (
	"context"

	"github.com/pkg/errors"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/applier"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

type applyHandler struct{}

// NewApplyHandler returns an ApplyHandler for Workflow resources.
func NewApplyHandler() applier.ApplyHandler { return &applyHandler{} }

func (h *applyHandler) Kind() apiresourcekind.ApiResourceKind {
	return apiresourcekind.ApiResourceKind_workflow
}

func (h *applyHandler) LoadFromBytes(raw []byte) (proto.Message, error) {
	result, err := LoadFromBytes(raw)
	if err != nil {
		return nil, errors.Wrap(err, "failed to load workflow")
	}
	return result.Workflow, nil
}

func (h *applyHandler) Validate(msg proto.Message) error {
	return Validate(msg.(*workflowv1.Workflow))
}

func (h *applyHandler) Metadata(msg proto.Message) *apiresource.ApiResourceMetadata {
	return msg.(*workflowv1.Workflow).Metadata
}

func (h *applyHandler) Apply(ctx context.Context, conn grpc.ClientConnInterface, msg proto.Message) (*applier.ApplyResult, error) {
	wf := msg.(*workflowv1.Workflow)

	if wf.Metadata == nil {
		wf.Metadata = &apiresource.ApiResourceMetadata{}
	}

	isCreate := wf.Metadata.Id == ""

	client := workflowv1.NewWorkflowCommandControllerClient(conn)
	result, err := client.Apply(ctx, wf)
	if err != nil {
		return nil, errors.Wrap(err, "failed to apply workflow")
	}

	return &applier.ApplyResult{
		Resource: result,
		Created:  isCreate,
	}, nil
}

func (h *applyHandler) BuildDryRunResult(msg proto.Message) *clioutput.CommandResult {
	wf := msg.(*workflowv1.Workflow)
	out := clioutput.Success("Dry run: %s is valid", wf.Metadata.Name)
	sec := out.AddSection("Workflow Preview")
	sec.Field("Name", wf.Metadata.Name)
	if wf.Spec != nil {
		if wf.Spec.Description != "" {
			sec.Field("Description", truncateForDisplay(wf.Spec.Description, 80))
		}
		if len(wf.Spec.Tasks) > 0 {
			sec.Fieldf("Tasks", "%d", len(wf.Spec.Tasks))
		}
		if wf.Spec.Document != nil && wf.Spec.Document.Version != "" {
			sec.Field("Version", wf.Spec.Document.Version)
		}
	}
	return out
}

func (h *applyHandler) BuildApplyResult(msg proto.Message, created bool) *clioutput.CommandResult {
	wf := msg.(*workflowv1.Workflow)
	action := "updated"
	if created {
		action = "created"
	}
	out := clioutput.Success("Workflow %s successfully", action)
	out.AddSection("Resource Details").
		Field("ID", wf.Metadata.Id).
		Field("Name", wf.Metadata.Name).
		Field("Slug", wf.Metadata.Slug)
	out.Hintf("View details: stigmer get workflow %s", wf.Metadata.Slug)
	out.Hintf("Run workflow: stigmer run workflow %s", wf.Metadata.Slug)
	out.Hintf("Delete:       stigmer delete workflow %s", wf.Metadata.Slug)
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
	var _ applier.ApplyHandler = (*applyHandler)(nil)
}
