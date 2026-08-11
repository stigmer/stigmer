package mcpserver

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"net/url"
	"strings"

	"github.com/rs/zerolog/log"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	oauthappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/mcpserver/oauth"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
	"google.golang.org/protobuf/proto"
)

// InitiateOAuthConnect starts the OAuth authorization flow for an MCP server.
//
// For DCR servers (no oauth_app_ref): discovers the authorization server,
// registers a client via DCR, generates PKCE, and returns the auth URL.
//
// For vendor OAuth servers (oauth_app_ref set): loads the OAuthApp for
// client credentials, generates PKCE, and returns the auth URL.
func (c *McpServerController) InitiateOAuthConnect(
	ctx context.Context,
	input *mcpserverv1.InitiateOAuthConnectInput,
) (*mcpserverv1.InitiateOAuthConnectOutput, error) {
	if c.oauthRedirectURI == "" {
		return nil, grpclib.FailedPreconditionError(
			"OAuth Connect is not configured: STIGMER_OAUTH_REDIRECT_URI is not set",
		)
	}
	if c.pendingOAuthStateStore == nil {
		return nil, grpclib.FailedPreconditionError(
			"OAuth Connect dependencies not initialized",
		)
	}

	mcpServerID := input.GetMcpServerId()
	if mcpServerID == "" {
		return nil, grpclib.InvalidArgumentError("mcp_server_id is required")
	}

	mcpServer := &mcpserverv1.McpServer{}
	if err := c.store.GetResource(ctx, apiresourcekind.ApiResourceKind_mcp_server, mcpServerID, mcpServer); err != nil {
		return nil, grpclib.NotFoundError("mcp_server", mcpServerID)
	}

	auth := mcpServer.GetSpec().GetAuth()
	if auth == nil {
		return nil, grpclib.FailedPreconditionError(
			"MCP server '%s' does not have an auth block configured", mcpServerID,
		)
	}

	pkcePair, err := oauth.GeneratePKCE()
	if err != nil {
		return nil, grpclib.InternalError(err, "failed to generate PKCE pair")
	}

	stateParam, err := generateState()
	if err != nil {
		return nil, grpclib.InternalError(err, "failed to generate state parameter")
	}

	var (
		authorizationURL string
		providerName     string
		scopes           []string
		clientID         string
		clientSecret     string
		tokenEndpoint    string
		authMethod       string
	)

	oauthAppRef := auth.GetOauthAppRef()
	if oauthAppRef == nil || oauthAppRef.GetSlug() == "" {
		// DCR path: discover authorization server and register client
		result, err := c.initiateDCR(ctx, mcpServer, pkcePair, stateParam)
		if err != nil {
			return nil, err
		}
		authorizationURL = result.authorizationURL
		providerName = result.providerName
		scopes = result.scopes
		clientID = result.clientID
		clientSecret = ""
		tokenEndpoint = result.tokenEndpoint
		authMethod = "mcp_oauth"
	} else {
		// Vendor OAuth path: load OAuthApp credentials
		result, err := c.initiateVendorOAuth(ctx, mcpServer, pkcePair, stateParam)
		if err != nil {
			return nil, err
		}
		authorizationURL = result.authorizationURL
		providerName = result.providerName
		scopes = result.scopes
		clientID = result.clientID
		clientSecret = result.clientSecret
		tokenEndpoint = result.tokenEndpoint
		authMethod = "vendor_oauth"
	}

	pendingState := &oauth.PendingOAuthState{
		State:             stateParam,
		CodeVerifier:      pkcePair.CodeVerifier,
		ClientID:          clientID,
		ClientSecret:      clientSecret,
		TokenEndpoint:     tokenEndpoint,
		McpServerID:       mcpServerID,
		IdentityAccountID: "", // OSS mode: single user, no identity account
		TargetEnvVar:      auth.GetTargetEnvVar(),
		AuthMethod:        authMethod,
		RedirectURI:       c.oauthRedirectURI,
		Org:               input.GetOrg(),
	}

	// Fail-closed: an encryption error fails the request; plaintext never
	// reaches the store.
	if err := sealPendingOAuthState(c.encryptionService, pendingState); err != nil {
		return nil, grpclib.InternalError(err, "failed to encrypt OAuth handshake secrets")
	}

	if err := c.pendingOAuthStateStore.Save(ctx, pendingState); err != nil {
		return nil, grpclib.InternalError(err, "failed to save pending OAuth state")
	}

	log.Info().
		Str("mcp_server_id", mcpServerID).
		Str("auth_method", authMethod).
		Str("provider", providerName).
		Msg("Initiated OAuth Connect flow")

	return &mcpserverv1.InitiateOAuthConnectOutput{
		AuthorizationUrl: authorizationURL,
		State:            stateParam,
		Scopes:           scopes,
		ProviderName:     providerName,
	}, nil
}

type initiateResult struct {
	authorizationURL string
	providerName     string
	scopes           []string
	clientID         string
	clientSecret     string
	tokenEndpoint    string
}

func (c *McpServerController) initiateDCR(
	ctx context.Context,
	mcpServer *mcpserverv1.McpServer,
	pkcePair *oauth.PKCEPair,
	stateParam string,
) (*initiateResult, error) {
	// Resolve the URL for OAuth authorization server discovery.
	// Priority: auth.discovery_url > http.url.
	// discovery_url enables DCR for stdio servers that have no HTTP URL.
	serverURL := mcpServer.GetSpec().GetAuth().GetDiscoveryUrl()
	if serverURL == "" {
		httpConfig := mcpServer.GetSpec().GetHttp()
		if httpConfig != nil {
			serverURL = httpConfig.GetUrl()
		}
	}
	if serverURL == "" {
		return nil, grpclib.FailedPreconditionError(
			"DCR requires a discoverable URL. MCP server '%s' has no http.url and no auth.discovery_url. "+
				"Set auth.discovery_url for stdio servers, oauth_app_ref for vendor OAuth, or switch to HTTP transport",
			mcpServer.GetMetadata().GetId(),
		)
	}
	metadata, err := oauth.DiscoverAuthorizationServer(ctx, serverURL)
	if err != nil {
		return nil, grpclib.FailedPreconditionError(
			"OAuth authorization server discovery failed for %s: %v", serverURL, err,
		)
	}

	if metadata.RegistrationEndpoint == "" {
		return nil, grpclib.FailedPreconditionError(
			"MCP server at %s does not advertise a registration_endpoint for DCR", serverURL,
		)
	}

	clientName := fmt.Sprintf("Stigmer (%s)", mcpServer.GetMetadata().GetName())
	dcrResp, err := oauth.RegisterClient(ctx, metadata.RegistrationEndpoint, c.oauthRedirectURI, clientName)
	if err != nil {
		return nil, grpclib.FailedPreconditionError("DCR registration failed: %v", err)
	}

	scopes := mcpServer.GetSpec().GetAuth().GetScopeHints()
	if len(scopes) == 0 && len(metadata.ScopesSupported) > 0 {
		scopes = metadata.ScopesSupported
	}

	authURL := buildAuthorizationURL(
		metadata.AuthorizationEndpoint,
		dcrResp.ClientID,
		c.oauthRedirectURI,
		pkcePair.CodeChallenge,
		stateParam,
		scopes,
		"scope",
	)

	// Some providers accept DCR for any redirect URI but enforce a
	// redirect-host allowlist at the authorization endpoint; without this
	// pre-flight the rejection would surface only as a vendor error page
	// inside the popup, which never redirects back (stigmer/stigmer#235).
	// Fail-open by contract: only a definite rejection blocks initiate.
	if rejection, probeErr := oauth.PreflightAuthorize(ctx, authURL); probeErr != nil {
		log.Debug().Err(probeErr).
			Str("mcp_server_id", mcpServer.GetMetadata().GetId()).
			Msg("authorize pre-flight probe inconclusive; proceeding")
	} else if rejection != nil {
		log.Warn().
			Int("status_code", rejection.StatusCode).
			Str("mcp_server_id", mcpServer.GetMetadata().GetId()).
			Str("body_snippet", rejection.BodySnippet).
			Msg("authorization endpoint rejected the sign-in request pre-flight")
		return nil, grpclib.FailedPreconditionError(
			"%s", dcrRejectionMessage(mcpServer.GetMetadata().GetName(), c.oauthRedirectURI, rejection),
		)
	}

	return &initiateResult{
		authorizationURL: authURL,
		providerName:     mcpServer.GetMetadata().GetName(),
		scopes:           scopes,
		clientID:         dcrResp.ClientID,
		tokenEndpoint:    metadata.TokenEndpoint,
	}, nil
}

func (c *McpServerController) initiateVendorOAuth(
	ctx context.Context,
	mcpServer *mcpserverv1.McpServer,
	pkcePair *oauth.PKCEPair,
	stateParam string,
) (*initiateResult, error) {
	ref := mcpServer.GetSpec().GetAuth().GetOauthAppRef()

	oauthApps, err := c.store.ListResources(ctx, apiresourcekind.ApiResourceKind_oauth_app)
	if err != nil {
		return nil, grpclib.InternalError(err, "failed to list oauth apps")
	}

	var oauthApp *oauthappv1.OAuthApp
	for _, data := range oauthApps {
		app := &oauthappv1.OAuthApp{}
		if err := proto.Unmarshal(data, app); err != nil {
			continue
		}
		if app.GetMetadata().GetSlug() == ref.GetSlug() &&
			(ref.GetOrg() == "" || app.GetMetadata().GetOrg() == ref.GetOrg()) {
			oauthApp = app
			break
		}
	}

	if oauthApp == nil {
		return nil, grpclib.NotFoundError("oauth_app", ref.GetSlug())
	}

	approvalStatus := oauthApp.GetSpec().GetVendorApprovalStatus()
	if approvalStatus == oauthappv1.VendorApprovalStatus_VENDOR_APPROVAL_STATUS_PENDING ||
		approvalStatus == oauthappv1.VendorApprovalStatus_VENDOR_APPROVAL_STATUS_REJECTED {
		statusLabel := "pending approval"
		if approvalStatus == oauthappv1.VendorApprovalStatus_VENDOR_APPROVAL_STATUS_REJECTED {
			statusLabel = "rejected"
		}
		return nil, grpclib.FailedPreconditionError(
			"OAuth sign-in is unavailable: the platform's OAuth app for '%s' is %s by the vendor. "+
				"Please enter a token manually instead.",
			oauthApp.GetSpec().GetProvider(), statusLabel)
	}

	clientSecret := oauthApp.GetSpec().GetClientSecret()
	if c.encryptionService != nil && c.encryptionService.IsEncrypted(clientSecret) {
		decrypted, err := c.encryptionService.Decrypt(clientSecret)
		if err != nil {
			return nil, grpclib.InternalError(err, "failed to decrypt OAuthApp client secret")
		}
		clientSecret = decrypted
	}

	scopes := oauthApp.GetSpec().GetScopes()
	scopeParamName := oauthApp.GetSpec().GetScopeParameterName()
	authURL := buildAuthorizationURL(
		oauthApp.GetSpec().GetAuthorizationUrl(),
		oauthApp.GetSpec().GetClientId(),
		c.oauthRedirectURI,
		pkcePair.CodeChallenge,
		stateParam,
		scopes,
		scopeParamName,
	)

	return &initiateResult{
		authorizationURL: authURL,
		providerName:     oauthApp.GetSpec().GetProvider(),
		scopes:           scopes,
		clientID:         oauthApp.GetSpec().GetClientId(),
		clientSecret:     clientSecret,
		tokenEndpoint:    oauthApp.GetSpec().GetTokenUrl(),
	}, nil
}

func buildAuthorizationURL(
	authEndpoint, clientID, redirectURI, codeChallenge, state string,
	scopes []string,
	scopeParamName string,
) string {
	if scopeParamName == "" {
		scopeParamName = "scope"
	}

	params := url.Values{
		"response_type":         {"code"},
		"client_id":             {clientID},
		"redirect_uri":          {redirectURI},
		"code_challenge":        {codeChallenge},
		"code_challenge_method": {"S256"},
		"state":                 {state},
	}
	if len(scopes) > 0 {
		params.Set(scopeParamName, strings.Join(scopes, " "))
	}

	separator := "?"
	if strings.Contains(authEndpoint, "?") {
		separator = "&"
	}
	return authEndpoint + separator + params.Encode()
}

// dcrRejectionMessage renders the user-facing copy for a pre-flight
// authorize rejection (see oauth.PreflightAuthorize). The wording is hedged
// — a 400 can in principle have other causes — but leads with the
// redirect-host allowlist because it is the only cause observed in the wild
// (Canva, stigmer/stigmer#235), and it names this deployment's callback host
// so self-hosted operators can act on it. Surfaces which render initiate
// errors pass this text through verbatim (getUserMessage in @stigmer/sdk),
// so it must stand on its own for an end user.
func dcrRejectionMessage(providerName, redirectURI string, rejection *oauth.AuthorizeRejection) string {
	callbackHost := redirectURI
	if parsed, err := url.Parse(redirectURI); err == nil && parsed.Host != "" {
		callbackHost = parsed.Host
	}
	msg := fmt.Sprintf(
		"%s rejected the sign-in request before showing a login page (HTTP %d). "+
			"The most common cause is a redirect-host allowlist: this deployment's OAuth callback host (%s) "+
			"is not on the provider's approved list. Self-hosted deployments with a localhost callback are typically unaffected.",
		providerName, rejection.StatusCode, callbackHost,
	)
	if rejection.VendorDetail != "" {
		msg += " Provider detail: " + rejection.VendorDetail
	}
	return msg
}

func generateState() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// sealPendingOAuthState encrypts the two real secrets in the pending row —
// code_verifier (every flow) and client_secret (vendor flow) — before they
// rest in SQLite, so handshake secrets never leak through filesystem backups
// of the database (oss#394; ports stigmer-cloud#294). The store itself stays
// a byte-faithful adapter; this call site is the single write seam.
//
// The row is a self-contained SNAPSHOT, never an alias of the OAuthApp's
// stored ciphertext: initiateVendorOAuth decrypts the app's secret (failing
// loudly if the key is unavailable), and the seal re-encrypts that plaintext
// with a fresh nonce. The token exchange must use the credentials the
// authorization code was minted for, not whatever a later resolution of the
// OAuthApp would return.
//
// The DCR path's empty client secret stays empty — never ciphertext-of-"" —
// so completeOAuthConnect and the token exchange keep seeing the emptiness
// that means "public client".
//
// Disabled encryption (no key configured) passes plaintext through with a
// WARN, matching the deployment-wide posture for environment, OAuthApp and
// ChannelApp secrets under the same key (see the channelapp resolveSecret
// step). A real encryption error while enabled is returned so the caller
// fails the request instead of persisting plaintext.
func sealPendingOAuthState(svc *encryption.SecretService, state *oauth.PendingOAuthState) error {
	if svc == nil || !svc.IsEnabled() {
		log.Warn().Msg("Encryption disabled: pending OAuth state secrets will be stored in plaintext")
		return nil
	}

	sealedVerifier, err := svc.Encrypt(state.CodeVerifier)
	if err != nil {
		return fmt.Errorf("failed to encrypt code_verifier: %w", err)
	}
	state.CodeVerifier = sealedVerifier

	if state.ClientSecret != "" {
		sealedSecret, err := svc.Encrypt(state.ClientSecret)
		if err != nil {
			return fmt.Errorf("failed to encrypt client_secret: %w", err)
		}
		state.ClientSecret = sealedSecret
	}

	return nil
}
