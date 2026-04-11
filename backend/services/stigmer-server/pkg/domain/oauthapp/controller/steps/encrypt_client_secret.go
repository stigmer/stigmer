package steps

import (
	"github.com/rs/zerolog/log"
	oauthappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	pipelinesteps "github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
)

// RedactedMarker is the sentinel string used by the response pipeline to
// replace client_secret values before they leave the server. If a client sends
// this value back in an update request, the intent is "keep the existing
// secret" -- not "store the literal marker".
const RedactedMarker = "***REDACTED***"

// encryptClientSecretStep encrypts the OAuthApp client_secret before persistence.
//
// On create:
//   - Encrypts the plaintext client_secret using AES-256-GCM.
//   - Rejects the redaction marker (there is no existing secret to preserve).
//
// On update:
//   - If the client sends RedactedMarker, copies the existing encrypted
//     value from the loaded resource (ExistingResourceKey).
//   - If the client sends a new plaintext value, encrypts it.
//   - If the value is already encrypted, leaves it unchanged.
//
// The isCreate flag controls which mode is active.
type encryptClientSecretStep struct {
	secretService *encryption.SecretService
	isCreate      bool
}

// NewEncryptClientSecretForCreateStep creates an encrypt step for create operations.
// Rejects the redaction marker since there is no existing secret to preserve.
func NewEncryptClientSecretForCreateStep(secretService *encryption.SecretService) *encryptClientSecretStep {
	return &encryptClientSecretStep{
		secretService: secretService,
		isCreate:      true,
	}
}

// NewEncryptClientSecretForUpdateStep creates an encrypt step for update operations.
// Allows the redaction marker and preserves the existing encrypted value.
func NewEncryptClientSecretForUpdateStep(secretService *encryption.SecretService) *encryptClientSecretStep {
	return &encryptClientSecretStep{
		secretService: secretService,
		isCreate:      false,
	}
}

func (s *encryptClientSecretStep) Name() string {
	return "EncryptClientSecret"
}

func (s *encryptClientSecretStep) Execute(ctx *pipeline.RequestContext[*oauthappv1.OAuthApp]) error {
	app := ctx.NewState()
	if app == nil || app.GetSpec() == nil {
		return nil
	}

	clientSecret := app.GetSpec().GetClientSecret()
	if clientSecret == "" {
		return nil
	}

	if clientSecret == RedactedMarker {
		return s.preserveExistingSecret(ctx, app)
	}

	if s.secretService.IsEncrypted(clientSecret) {
		return nil
	}

	if !s.secretService.IsEnabled() {
		log.Warn().Msg("Encryption disabled: client_secret will be stored in plaintext")
		return nil
	}

	encrypted, err := s.secretService.Encrypt(clientSecret)
	if err != nil {
		return grpclib.InternalError(err, "failed to encrypt client_secret")
	}

	app.Spec.ClientSecret = encrypted
	return nil
}

// preserveExistingSecret copies the encrypted client_secret from the existing
// resource when the client sends the redaction marker.
func (s *encryptClientSecretStep) preserveExistingSecret(
	ctx *pipeline.RequestContext[*oauthappv1.OAuthApp],
	app *oauthappv1.OAuthApp,
) error {
	if s.isCreate {
		return grpclib.InvalidArgumentError(
			"cannot use the redaction marker as client_secret on create")
	}

	existingVal := ctx.Get(pipelinesteps.ExistingResourceKey)
	existing, ok := existingVal.(*oauthappv1.OAuthApp)
	if !ok || existing == nil {
		return grpclib.InternalError(nil,
			"cannot preserve client_secret: existing resource not loaded")
	}

	existingSecret := existing.GetSpec().GetClientSecret()
	if existingSecret == "" {
		return grpclib.InvalidArgumentError(
			"cannot preserve client_secret: no existing secret value found")
	}

	app.Spec.ClientSecret = existingSecret

	log.Debug().
		Str("oauth_app_id", app.GetMetadata().GetId()).
		Msg("Preserved existing encrypted client_secret")

	return nil
}
