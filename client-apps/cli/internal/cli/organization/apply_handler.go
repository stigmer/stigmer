package organization

import (
	"context"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/applier"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

type applyHandler struct{}

// NewApplyHandler returns an ApplyHandler for Organization resources.
func NewApplyHandler() applier.ApplyHandler { return &applyHandler{} }

func (h *applyHandler) Kind() apiresourcekind.ApiResourceKind {
	return apiresourcekind.ApiResourceKind_organization
}

func (h *applyHandler) LoadFromBytes(raw []byte) (proto.Message, error) {
	result, err := LoadFromBytes(raw)
	if err != nil {
		return nil, errors.Wrap(err, "failed to load organization")
	}
	return result.Organization, nil
}

// Validate is a no-op: protovalidate runs inside the loader and organization
// has no cross-field business rules beyond schema validation.
func (h *applyHandler) Validate(proto.Message) error { return nil }

func (h *applyHandler) Metadata(msg proto.Message) *apiresource.ApiResourceMetadata {
	return msg.(*organizationv1.Organization).Metadata
}

func (h *applyHandler) Apply(ctx context.Context, conn grpc.ClientConnInterface, msg proto.Message) (*applier.ApplyResult, error) {
	org := msg.(*organizationv1.Organization)

	if org.Metadata == nil {
		org.Metadata = &apiresource.ApiResourceMetadata{}
	}

	isCreate := org.Metadata.Id == ""

	client := organizationv1.NewOrganizationCommandControllerClient(conn)
	result, err := client.Apply(ctx, org)
	if err != nil {
		return nil, errors.Wrap(err, "failed to apply organization")
	}

	return &applier.ApplyResult{
		Resource: result,
		Created:  isCreate,
	}, nil
}

func (h *applyHandler) BuildDryRunResult(msg proto.Message) *clioutput.CommandResult {
	org := msg.(*organizationv1.Organization)
	out := clioutput.Success("Dry run: %s is valid", org.Metadata.Name)
	sec := out.AddSection("Organization Preview")
	sec.Field("Name", org.Metadata.Name)
	if org.Spec != nil {
		if org.Spec.Description != "" {
			sec.Field("Description", truncateForDisplay(org.Spec.Description, 80))
		}
	}
	return out
}

func (h *applyHandler) BuildApplyResult(msg proto.Message, created bool) *clioutput.CommandResult {
	org := msg.(*organizationv1.Organization)
	action := "updated"
	if created {
		action = "created"
	}
	out := clioutput.Success("Organization %s successfully", action)
	out.AddSection("Resource Details").
		Field("ID", org.Metadata.Id).
		Field("Name", org.Metadata.Name).
		Field("Slug", org.Metadata.Slug)
	out.Hintf("View details: stigmer get organization %s", org.Metadata.Slug)
	out.Hintf("Delete:       stigmer delete organization %s", org.Metadata.Slug)
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
