package oauthapp

import (
	"context"
	"fmt"
	"strings"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	oauthappv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/iam/oauthapp/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/applier"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
	"google.golang.org/protobuf/proto"
)

type applyHandler struct{}

// NewApplyHandler returns an ApplyHandler for OAuthApp resources.
func NewApplyHandler() applier.ApplyHandler { return &applyHandler{} }

func (h *applyHandler) Kind() apiresourcekind.ApiResourceKind {
	return apiresourcekind.ApiResourceKind_oauth_app
}

func (h *applyHandler) LoadFromBytes(raw []byte) (proto.Message, error) {
	result, err := LoadFromBytes(raw)
	if err != nil {
		return nil, errors.Wrap(err, "failed to load oauth app")
	}
	return result.OAuthApp, nil
}

func (h *applyHandler) Validate(proto.Message) error { return nil }

func (h *applyHandler) Metadata(msg proto.Message) *apiresource.ApiResourceMetadata {
	return msg.(*oauthappv1.OAuthApp).Metadata
}

func (h *applyHandler) Apply(ctx context.Context, client *stigmer.Client, msg proto.Message) (*applier.ApplyResult, error) {
	app := msg.(*oauthappv1.OAuthApp)

	if app.Metadata == nil {
		app.Metadata = &apiresource.ApiResourceMetadata{}
	}

	isCreate := app.Metadata.Id == ""

	result, err := client.OAuthApp.Apply(ctx, stigmer.OAuthAppInputFromProto(app))
	if err != nil {
		return nil, errors.Wrap(err, "failed to apply oauth app")
	}

	return &applier.ApplyResult{
		Resource: result,
		Created:  isCreate,
	}, nil
}

func (h *applyHandler) BuildDryRunResult(msg proto.Message) *clioutput.CommandResult {
	app := msg.(*oauthappv1.OAuthApp)
	out := clioutput.Success("Dry run: %s is valid", app.Metadata.Name)
	sec := out.AddSection("OAuthApp Preview")
	sec.Field("Name", app.Metadata.Name)
	if app.Spec != nil {
		if app.Spec.Provider != "" {
			sec.Field("Provider", app.Spec.Provider)
		}
		sec.Field("Client ID", app.Spec.ClientId)
		sec.Field("Client Secret", "[REDACTED]")
		if app.Spec.AuthorizationUrl != "" {
			sec.Field("Authorization URL", app.Spec.AuthorizationUrl)
		}
		if len(app.Spec.Scopes) > 0 {
			sec.Field("Scopes", strings.Join(app.Spec.Scopes, ", "))
		}
	}
	return out
}

func (h *applyHandler) BuildApplyResult(msg proto.Message, created bool) *clioutput.CommandResult {
	app := msg.(*oauthappv1.OAuthApp)
	action := "updated"
	if created {
		action = "created"
	}
	out := clioutput.Success("OAuth app %s successfully", action)
	out.AddSection("Resource Details").
		Field("ID", app.Metadata.Id).
		Field("Name", app.Metadata.Name).
		Field("Slug", app.Metadata.Slug)
	if app.Spec != nil {
		sec := out.AddSection("Configuration")
		sec.Field("Provider", app.Spec.Provider)
		sec.Field("Client ID", app.Spec.ClientId)
		if len(app.Spec.Scopes) > 0 {
			sec.Field("Scopes", fmt.Sprintf("%d", len(app.Spec.Scopes)))
		}
	}
	out.Hintf("View details: stigmer get oauthapp %s", app.Metadata.Slug)
	out.Hintf("Delete:       stigmer delete oauthapp %s", app.Metadata.Slug)
	return out
}

func init() {
	var _ applier.ApplyHandler = (*applyHandler)(nil)
}
