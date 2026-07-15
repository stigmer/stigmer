package channelapp

import (
	agentchannelv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentchannel/v1"
	channelappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/channelapp/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	pipelinesteps "github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"

	"github.com/rs/zerolog/log"
	"google.golang.org/protobuf/proto"
)

// RedactedMarker is the sentinel the response path substitutes for secret
// values before they leave the server. A client sending it back on update
// means "keep the stored secret". Must equal the platform-wide marker
// (SecretEncryptionService.REDACTED_MARKER in the cloud edition and the
// oauthapp/environment steps here).
const RedactedMarker = "***REDACTED***"

// encryptChannelAppSecretsStep encrypts the ChannelApp secret fields before
// persistence — the oauthapp encryptClientSecretStep generalized to a
// provider oneof carrying multiple secrets (Slack: client_secret AND
// signing_secret).
//
// Each field is handled independently, per field:
//   - Create: encrypts the plaintext value; the redaction marker is
//     refused (nothing to preserve).
//   - Update with a new value: encrypts the new plaintext.
//   - Update with the marker: preserves the existing encrypted value from
//     the loaded resource. Independence matters: one request may rotate
//     one secret while keeping the other.
type encryptChannelAppSecretsStep struct {
	secretService *encryption.SecretService
	isCreate      bool
}

// NewEncryptChannelAppSecretsForCreateStep creates an encrypt step for
// create operations; the redaction marker is refused.
func NewEncryptChannelAppSecretsForCreateStep(secretService *encryption.SecretService) *encryptChannelAppSecretsStep {
	return &encryptChannelAppSecretsStep{secretService: secretService, isCreate: true}
}

// NewEncryptChannelAppSecretsForUpdateStep creates an encrypt step for
// update operations; the marker preserves the stored value per field.
func NewEncryptChannelAppSecretsForUpdateStep(secretService *encryption.SecretService) *encryptChannelAppSecretsStep {
	return &encryptChannelAppSecretsStep{secretService: secretService, isCreate: false}
}

func (s *encryptChannelAppSecretsStep) Name() string {
	return "EncryptChannelAppSecrets"
}

func (s *encryptChannelAppSecretsStep) Execute(ctx *pipeline.RequestContext[*channelappv1.ChannelApp]) error {
	app := ctx.NewState()
	slack := app.GetSpec().GetSlack()
	if slack == nil {
		return nil
	}

	clientSecret, err := s.resolveSecret(ctx, "client_secret", slack.GetClientSecret(),
		func(existing *channelappv1.ChannelApp) string {
			return existing.GetSpec().GetSlack().GetClientSecret()
		})
	if err != nil {
		return err
	}

	signingSecret, err := s.resolveSecret(ctx, "signing_secret", slack.GetSigningSecret(),
		func(existing *channelappv1.ChannelApp) string {
			return existing.GetSpec().GetSlack().GetSigningSecret()
		})
	if err != nil {
		return err
	}

	slack.ClientSecret = clientSecret
	slack.SigningSecret = signingSecret
	return nil
}

// resolveSecret computes the storage-ready value for one secret field.
func (s *encryptChannelAppSecretsStep) resolveSecret(
	ctx *pipeline.RequestContext[*channelappv1.ChannelApp],
	fieldName string,
	requestValue string,
	readExisting func(*channelappv1.ChannelApp) string,
) (string, error) {
	if requestValue == "" {
		return requestValue, nil
	}

	if requestValue == RedactedMarker {
		return s.preserveExistingSecret(ctx, fieldName, readExisting)
	}

	if s.secretService.IsEncrypted(requestValue) {
		return requestValue, nil
	}

	if !s.secretService.IsEnabled() {
		log.Warn().Msgf("Encryption disabled: %s will be stored in plaintext", fieldName)
		return requestValue, nil
	}

	encrypted, err := s.secretService.Encrypt(requestValue)
	if err != nil {
		return "", grpclib.InternalError(err, "failed to encrypt "+fieldName)
	}
	return encrypted, nil
}

// preserveExistingSecret copies the stored encrypted value when the client
// sends the redaction marker on update.
func (s *encryptChannelAppSecretsStep) preserveExistingSecret(
	ctx *pipeline.RequestContext[*channelappv1.ChannelApp],
	fieldName string,
	readExisting func(*channelappv1.ChannelApp) string,
) (string, error) {
	if s.isCreate {
		return "", grpclib.InvalidArgumentError(
			"cannot use the redaction marker as %s on create", fieldName)
	}

	existingVal := ctx.Get(pipelinesteps.ExistingResourceKey)
	existing, ok := existingVal.(*channelappv1.ChannelApp)
	if !ok || existing == nil {
		return "", grpclib.InternalError(nil,
			"cannot preserve "+fieldName+": existing resource not loaded")
	}

	existingSecret := readExisting(existing)
	if existingSecret == "" {
		return "", grpclib.InvalidArgumentError(
			"cannot preserve %s: no existing secret value found", fieldName)
	}
	return existingSecret, nil
}

// RedactChannelApp replaces every non-empty secret field with
// RedactedMarker on the given app — used in all API responses (get,
// getByReference, create, update, listByOrg), the RedactOAuthApp shape
// over the provider oneof.
func RedactChannelApp(app *channelappv1.ChannelApp) {
	slack := app.GetSpec().GetSlack()
	if slack == nil {
		return
	}
	if slack.GetClientSecret() != "" {
		slack.ClientSecret = RedactedMarker
	}
	if slack.GetSigningSecret() != "" {
		slack.SigningSecret = RedactedMarker
	}
}

// validateProviderImmutableStep rejects updates that change the provider
// arm: a slack app cannot become a whatsapp app — every referencing
// channel's install state and the webhook verification path are
// provider-shaped (the AgentChannel provider-arm rule, applied to the
// app). Runs after LoadExisting.
type validateProviderImmutableStep struct{}

func (s *validateProviderImmutableStep) Name() string {
	return "ValidateProviderImmutable"
}

func (s *validateProviderImmutableStep) Execute(ctx *pipeline.RequestContext[*channelappv1.ChannelApp]) error {
	existingVal := ctx.Get(pipelinesteps.ExistingResourceKey)
	existing, ok := existingVal.(*channelappv1.ChannelApp)
	if !ok || existing == nil {
		return grpclib.InternalError(nil, "existing channel app not found in context")
	}

	existingCase := existing.GetSpec().ProtoReflect().WhichOneof(
		existing.GetSpec().ProtoReflect().Descriptor().Oneofs().ByName("provider_config"))
	inputCase := ctx.Input().GetSpec().ProtoReflect().WhichOneof(
		ctx.Input().GetSpec().ProtoReflect().Descriptor().Oneofs().ByName("provider_config"))

	if existingCase != inputCase {
		return grpclib.InvalidArgumentError("the provider of a channel app cannot be changed")
	}
	return nil
}

// checkNoReferencingChannelsStep prevents deletion of a ChannelApp that is
// still referenced by any AgentChannel via spec.app_ref — a deleted app
// would break the referencing channels' webhook verification and any
// future re-install (the oauthapp checkNoReferencingMcpServers precedent).
//
// Requires LoadExistingForDeleteStep to have run first.
type checkNoReferencingChannelsStep struct {
	store store.Store
}

func NewCheckNoReferencingChannelsStep(store store.Store) *checkNoReferencingChannelsStep {
	return &checkNoReferencingChannelsStep{store: store}
}

func (s *checkNoReferencingChannelsStep) Name() string {
	return "CheckNoReferencingChannels"
}

func (s *checkNoReferencingChannelsStep) Execute(ctx *pipeline.RequestContext[*apiresource.ApiResourceDeleteInput]) error {
	existingVal := ctx.Get(pipelinesteps.ExistingResourceKey)
	existing, ok := existingVal.(*channelappv1.ChannelApp)
	if !ok || existing == nil {
		return grpclib.InternalError(nil, "existing ChannelApp not loaded in delete pipeline")
	}

	org := existing.GetMetadata().GetOrg()
	slug := existing.GetMetadata().GetSlug()

	resources, err := s.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_agent_channel)
	if err != nil {
		return grpclib.InternalError(err, "failed to list agent channels for referential integrity check")
	}

	for _, data := range resources {
		channel := &agentchannelv1.AgentChannel{}
		if err := proto.Unmarshal(data, channel); err != nil {
			log.Warn().Err(err).Msg("Failed to unmarshal agent channel during referential integrity check, skipping")
			continue
		}

		ref := channel.GetSpec().GetAppRef()
		if ref.GetSlug() == "" {
			continue
		}
		// An empty ref org means same-org; normalize before comparing so a
		// pre-normalization row still guards its app.
		refOrg := ref.GetOrg()
		if refOrg == "" {
			refOrg = channel.GetMetadata().GetOrg()
		}

		if refOrg == org && ref.GetSlug() == slug {
			return grpclib.FailedPreconditionError(
				"cannot delete ChannelApp '%s/%s': referenced by agent channel '%s'",
				org, slug, channel.GetMetadata().GetName())
		}
	}

	return nil
}
