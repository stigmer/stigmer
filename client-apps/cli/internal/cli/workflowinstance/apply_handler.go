package workflowinstance

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/applier"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	workflowinstancev1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/protobuf/proto"
)

type applyHandler struct{}

// NewApplyHandler returns an ApplyHandler for WorkflowInstance resources.
func NewApplyHandler() applier.ApplyHandler { return &applyHandler{} }

func (h *applyHandler) Kind() apiresourcekind.ApiResourceKind {
	return apiresourcekind.ApiResourceKind_workflow_instance
}

func (h *applyHandler) LoadFromBytes(raw []byte) (proto.Message, error) {
	result, err := LoadFromBytes(raw)
	if err != nil {
		return nil, errors.Wrap(err, "failed to load workflow instance")
	}
	return result.WorkflowInstance, nil
}

func (h *applyHandler) Validate(proto.Message) error { return nil }

func (h *applyHandler) Metadata(msg proto.Message) *apiresource.ApiResourceMetadata {
	return msg.(*workflowinstancev1.WorkflowInstance).Metadata
}

func (h *applyHandler) Apply(ctx context.Context, client *stigmer.Client, msg proto.Message) (*applier.ApplyResult, error) {
	wi := msg.(*workflowinstancev1.WorkflowInstance)

	if wi.Metadata == nil {
		wi.Metadata = &apiresource.ApiResourceMetadata{}
	}

	isCreate := wi.Metadata.Id == ""

	result, err := client.WorkflowInstance.Apply(ctx, stigmer.WorkflowInstanceInputFromProto(wi))
	if err != nil {
		return nil, errors.Wrap(err, "failed to apply workflow instance")
	}

	return &applier.ApplyResult{
		Resource: result,
		Created:  isCreate,
	}, nil
}

func (h *applyHandler) BuildDryRunResult(msg proto.Message) *clioutput.CommandResult {
	wi := msg.(*workflowinstancev1.WorkflowInstance)
	out := clioutput.Success("Dry run: %s is valid", wi.Metadata.Name)
	sec := out.AddSection("WorkflowInstance Preview")
	sec.Field("Name", wi.Metadata.Name)
	if wi.Spec != nil {
		sec.Field("Workflow ID", wi.Spec.WorkflowId)
		if wi.Spec.Description != "" {
			sec.Field("Description", wi.Spec.Description)
		}
		if len(wi.Spec.EnvironmentRefs) > 0 {
			sec.Fieldf("Environments", "%d", len(wi.Spec.EnvironmentRefs))
		}
	}
	return out
}

func (h *applyHandler) BuildApplyResult(msg proto.Message, created bool) *clioutput.CommandResult {
	wi := msg.(*workflowinstancev1.WorkflowInstance)
	action := "updated"
	if created {
		action = "created"
	}
	out := clioutput.Success("Workflow instance %s successfully", action)
	out.AddSection("Resource Details").
		Field("ID", wi.Metadata.Id).
		Field("Name", wi.Metadata.Name).
		Field("Slug", wi.Metadata.Slug)
	if wi.Spec != nil {
		out.AddSection("Configuration").
			Field("Workflow ID", wi.Spec.WorkflowId).
			Field("Environments", fmt.Sprintf("%d", len(wi.Spec.EnvironmentRefs)))
	}
	out.Hintf("View details: stigmer get workflowinstance %s", wi.Metadata.Slug)
	out.Hintf("Delete:       stigmer delete workflowinstance %s", wi.Metadata.Slug)
	return out
}

func init() {
	var _ applier.ApplyHandler = (*applyHandler)(nil)
}
