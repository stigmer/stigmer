package steps

import (
	oauthappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
)

// RedactOAuthApp replaces the client_secret with RedactedMarker on the given app.
//
// Used in all API responses (get, getByReference, create, update, listByOrg)
// to prevent encrypted (or plaintext) secrets from leaking.
//
// This is a function rather than a pipeline step because redaction applies
// at different points depending on the operation:
//   - Create/Update: after persist, on NewState()
//   - Get/GetByReference: after load, on the target resource from TargetResourceKey
//   - ListByOrg: per-entry in the custom list step
func RedactOAuthApp(app *oauthappv1.OAuthApp) {
	if app != nil && app.GetSpec() != nil && app.GetSpec().GetClientSecret() != "" {
		app.Spec.ClientSecret = RedactedMarker
	}
}
