package auth

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/pkg/errors"
	"golang.org/x/oauth2"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
)

// LoginResult conveys the outcome of a Login() call to the command layer.
//
// Intentionally minimal today. As the auth system evolves (refresh tokens,
// session management), new fields can be added without changing the function
// signature across callers.
type LoginResult struct{}

// loginTimeout is how long Login waits for the user to complete the browser
// authentication before giving up.
const loginTimeout = 5 * time.Minute

// Login initiates the browser-based PKCE OAuth login flow.
//
// The flow is:
//  1. Start a local HTTP server to receive the Auth0 callback
//  2. Open the user's browser to Auth0 /authorize with a PKCE code_challenge
//  3. Wait for Auth0 to redirect back with an authorization code
//  4. Exchange the code + code_verifier for an access token (no client_secret)
//  5. Persist the token and switch the backend to cloud mode
//
// Progress messages are written to stderr. The caller (command layer) is
// responsible for rendering the final success/error result via clioutput.
func Login() (*LoginResult, error) {
	// PKCE: generate a random code_verifier. The corresponding code_challenge
	// (SHA-256 hash) is added to the authorization URL by S256ChallengeOption.
	verifier := oauth2.GenerateVerifier()

	// OAuth state parameter for CSRF protection.  We reuse GenerateVerifier
	// because it produces a cryptographically random string of suitable length.
	state := oauth2.GenerateVerifier()

	// --- 1. Start the local callback server ---
	srv := newCallbackServer(CallbackPort)
	if err := srv.Start(); err != nil {
		return nil, err
	}
	defer srv.Shutdown(context.Background()) //nolint:errcheck

	// --- 2. Build the Auth0 authorization URL ---
	oauthCfg := NewOAuthConfig()
	authURL := oauthCfg.AuthCodeURL(
		state,
		oauth2.S256ChallengeOption(verifier),
		oauth2.SetAuthURLParam("audience", Audience),
		// prompt=login forces the Auth0 login page even when an active browser
		// session exists, enabling account switching.
		oauth2.SetAuthURLParam("prompt", "login"),
	)

	// --- 3. Open the browser ---
	fmt.Fprintln(os.Stderr, "Opening browser for authentication...")
	fmt.Fprintf(os.Stderr, "If the browser doesn't open automatically, visit:\n%s\n\n", authURL)

	if err := openBrowser(authURL); err != nil {
		fmt.Fprintf(os.Stderr, "Could not open browser automatically: %v\n", err)
		fmt.Fprintln(os.Stderr, "Please open the URL above in your browser.")
	}

	// --- 4. Wait for the callback ---
	ctx, cancel := context.WithTimeout(context.Background(), loginTimeout)
	defer cancel()

	cb, err := srv.WaitForCallback(ctx)
	if err != nil {
		return nil, err
	}

	// --- 5. Validate the state parameter (CSRF check) ---
	if cb.state != state {
		return nil, errors.New("OAuth state mismatch — possible CSRF attack, aborting login")
	}

	// --- 6. Exchange authorization code for access token ---
	// VerifierOption sends the raw code_verifier so Auth0 can verify it
	// against the code_challenge we sent in step 2.  No client_secret is
	// transmitted — this is the core benefit of PKCE.
	token, err := oauthCfg.Exchange(ctx, cb.code, oauth2.VerifierOption(verifier))
	if err != nil {
		return nil, errors.Wrap(err, "failed to exchange authorization code for token")
	}

	if !token.Valid() {
		return nil, errors.New("received invalid token from Auth0")
	}

	// --- 7. Persist token and switch to cloud backend ---
	appCfg, err := config.Load()
	if err != nil {
		return nil, errors.Wrap(err, "failed to load config")
	}

	if appCfg.Backend.Cloud == nil {
		appCfg.Backend.Cloud = &config.CloudBackendConfig{}
	}
	appCfg.Backend.Cloud.Token = token.AccessToken
	appCfg.Backend.Type = config.BackendTypeCloud

	if err := config.Save(appCfg); err != nil {
		return nil, errors.Wrap(err, "failed to save authentication token")
	}

	return &LoginResult{}, nil
}
