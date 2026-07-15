// Package channelapp provides the controller implementation for ChannelApp
// resources.
//
// ChannelApp is an organization-scoped resource in the agentic bounded
// context that holds a customer's own messaging-platform app credentials
// (for Slack: OAuth client id/secret and the webhook signing secret).
// Agent channels reference it via spec.app_ref to install through the
// customer's app instead of the shared platform app — the bot carries the
// customer's name and icon, and each app is its own bot identity, so
// multiple agents can serve one workspace (channel-integrations T04
// item 2).
//
// ChannelApp is the channel-domain sibling of OAuthApp (iam): both are
// org-owned credential holders with inline encrypted secrets, but they
// model different trust surfaces — OAuthApp carries user-authorization
// OAuth endpoints; ChannelApp carries webhook signing secrets and install
// credentials. The provider variance is a required oneof
// (spec.provider_config), the AgentChannelSpec idiom; WhatsApp (T05)
// extends the oneof and touches zero kinds.
//
// Security (the OAuthApp posture):
//   - client_secret and signing_secret are encrypted at rest (AES-256-GCM)
//   - both are redacted (***REDACTED***) in all API responses
//   - deletion is blocked while any AgentChannel references the app
//
// Edition posture: OSS stores and round-trips ChannelApps with full CRUD
// parity, but has no channel runtime — the webhook receiver and install
// flow that consume these credentials are cloud-only, and the agent
// channel install RPCs refuse in OSS (see the agentchannel package
// comment). A ChannelApp is exactly what a future OSS channel runtime
// would need, since OSS has no platform Slack app to fall back on.
package channelapp

import (
	channelappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/channelapp/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
)

// ChannelAppController implements ChannelAppCommandController and
// ChannelAppQueryController.
//
// Like every OSS controller it implements no FGA authorization and no
// event publishing (single-user local posture). Validation, secret
// encryption/redaction, and the referential-integrity delete block are
// byte-compatible with the cloud edition.
type ChannelAppController struct {
	channelappv1.UnimplementedChannelAppCommandControllerServer
	channelappv1.UnimplementedChannelAppQueryControllerServer
	store         store.Store
	secretService *encryption.SecretService
}

// NewChannelAppController creates a new ChannelAppController with the given
// store and encryption service.
//
// The secretService encrypts the Slack client_secret and signing_secret
// before persistence and is the same instance used by the Environment and
// OAuthApp controllers (one key, one format: enc:v1:).
func NewChannelAppController(store store.Store, secretService *encryption.SecretService) *ChannelAppController {
	return &ChannelAppController{
		store:         store,
		secretService: secretService,
	}
}
