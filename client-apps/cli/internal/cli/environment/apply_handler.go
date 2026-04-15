package environment

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	environmentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/applier"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
	"google.golang.org/protobuf/proto"
)

type applyHandler struct{}

// NewApplyHandler returns an ApplyHandler for Environment resources.
func NewApplyHandler() applier.ApplyHandler { return &applyHandler{} }

func (h *applyHandler) Kind() apiresourcekind.ApiResourceKind {
	return apiresourcekind.ApiResourceKind_environment
}

func (h *applyHandler) LoadFromBytes(raw []byte) (proto.Message, error) {
	result, err := LoadFromBytes(raw)
	if err != nil {
		return nil, errors.Wrap(err, "failed to load environment")
	}
	return result.Environment, nil
}

func (h *applyHandler) Validate(proto.Message) error { return nil }

func (h *applyHandler) Metadata(msg proto.Message) *apiresource.ApiResourceMetadata {
	return msg.(*environmentv1.Environment).Metadata
}

func (h *applyHandler) Apply(ctx context.Context, client *stigmer.Client, msg proto.Message) (*applier.ApplyResult, error) {
	env := msg.(*environmentv1.Environment)

	if env.Metadata == nil {
		env.Metadata = &apiresource.ApiResourceMetadata{}
	}

	isCreate := env.Metadata.Id == ""

	result, err := client.Environment.Apply(ctx, stigmer.EnvironmentInputFromProto(env))
	if err != nil {
		return nil, errors.Wrap(err, "failed to apply environment")
	}

	return &applier.ApplyResult{
		Resource: result,
		Created:  isCreate,
	}, nil
}

func (h *applyHandler) BuildDryRunResult(msg proto.Message) *clioutput.CommandResult {
	env := msg.(*environmentv1.Environment)
	out := clioutput.Success("Dry run: %s is valid", env.Metadata.Name)
	sec := out.AddSection("Environment Preview")
	sec.Field("Name", env.Metadata.Name)
	if env.Spec != nil {
		if env.Spec.Description != "" {
			sec.Field("Description", env.Spec.Description)
		}
		varCount := len(env.Spec.Data)
		if varCount > 0 {
			secretCount := 0
			for _, v := range env.Spec.Data {
				if v.IsSecret {
					secretCount++
				}
			}
			sec.Fieldf("Variables", "%d (%d secrets)", varCount, secretCount)
		}
	}
	return out
}

func (h *applyHandler) BuildApplyResult(msg proto.Message, created bool) *clioutput.CommandResult {
	env := msg.(*environmentv1.Environment)
	action := "updated"
	if created {
		action = "created"
	}
	out := clioutput.Success("Environment %s successfully", action)
	out.AddSection("Resource Details").
		Field("ID", env.Metadata.Id).
		Field("Name", env.Metadata.Name).
		Field("Slug", env.Metadata.Slug)
	if env.Spec != nil {
		out.AddSection("Configuration").
			Field("Variables", fmt.Sprintf("%d", len(env.Spec.Data)))
	}
	out.Hintf("View details: stigmer get environment %s", env.Metadata.Slug)
	out.Hintf("Delete:       stigmer delete environment %s", env.Metadata.Slug)
	return out
}

func init() {
	var _ applier.ApplyHandler = (*applyHandler)(nil)
}
