package identityprovider

import (
	"context"
	"fmt"
	"strings"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	identityproviderv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/identityprovider/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/applier"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

type applyHandler struct{}

// NewApplyHandler returns an ApplyHandler for IdentityProvider resources.
func NewApplyHandler() applier.ApplyHandler { return &applyHandler{} }

func (h *applyHandler) Kind() apiresourcekind.ApiResourceKind {
	return apiresourcekind.ApiResourceKind_identity_provider
}

func (h *applyHandler) LoadFromBytes(raw []byte) (proto.Message, error) {
	result, err := LoadFromBytes(raw)
	if err != nil {
		return nil, errors.Wrap(err, "failed to load identity provider")
	}
	return result.IdentityProvider, nil
}

func (h *applyHandler) Validate(proto.Message) error { return nil }

func (h *applyHandler) Metadata(msg proto.Message) *apiresource.ApiResourceMetadata {
	return msg.(*identityproviderv1.IdentityProvider).Metadata
}

func (h *applyHandler) Apply(ctx context.Context, conn grpc.ClientConnInterface, msg proto.Message) (*applier.ApplyResult, error) {
	idp := msg.(*identityproviderv1.IdentityProvider)

	if idp.Metadata == nil {
		idp.Metadata = &apiresource.ApiResourceMetadata{}
	}

	isCreate := idp.Metadata.Id == ""

	client := identityproviderv1.NewIdentityProviderCommandControllerClient(conn)
	result, err := client.Apply(ctx, idp)
	if err != nil {
		return nil, errors.Wrap(err, "failed to apply identity provider")
	}

	return &applier.ApplyResult{
		Resource: result,
		Created:  isCreate,
	}, nil
}

func (h *applyHandler) BuildDryRunResult(msg proto.Message) *clioutput.CommandResult {
	idp := msg.(*identityproviderv1.IdentityProvider)
	out := clioutput.Success("Dry run: %s is valid", idp.Metadata.Name)
	sec := out.AddSection("IdentityProvider Preview")
	sec.Field("Name", idp.Metadata.Name)
	if idp.Spec != nil {
		if idp.Spec.DisplayName != "" {
			sec.Field("Display Name", idp.Spec.DisplayName)
		}
		if idp.Spec.JwksUri != "" {
			sec.Field("JWKS URI", idp.Spec.JwksUri)
		}
		if len(idp.Spec.AllowedIssuers) > 0 {
			sec.Field("Allowed Issuers", strings.Join(idp.Spec.AllowedIssuers, ", "))
		}
		if idp.Spec.ExpectedAudience != "" {
			sec.Field("Expected Audience", idp.Spec.ExpectedAudience)
		}
		if idp.Spec.IsSsoProvider {
			sec.Field("SSO Provider", "true")
		}
	}
	return out
}

func (h *applyHandler) BuildApplyResult(msg proto.Message, created bool) *clioutput.CommandResult {
	idp := msg.(*identityproviderv1.IdentityProvider)
	action := "updated"
	if created {
		action = "created"
	}
	out := clioutput.Success("Identity provider %s successfully", action)
	out.AddSection("Resource Details").
		Field("ID", idp.Metadata.Id).
		Field("Name", idp.Metadata.Name).
		Field("Slug", idp.Metadata.Slug)
	out.Hintf("View details: stigmer get identityprovider %s", idp.Metadata.Slug)
	out.Hintf("Delete:       stigmer delete identityprovider %s", idp.Metadata.Slug)
	if idp.Spec != nil && idp.Spec.DisplayName != "" {
		out.AddSection("Configuration").
			Field("Display Name", idp.Spec.DisplayName).
			Field("SSO Provider", fmt.Sprintf("%t", idp.Spec.IsSsoProvider))
	}
	return out
}

func init() {
	var _ applier.ApplyHandler = (*applyHandler)(nil)
}
