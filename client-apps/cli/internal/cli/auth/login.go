package auth

import "github.com/pkg/errors"

// Login initiates the browser-based PKCE OAuth login flow.
//
// The full implementation (PKCE challenge generation, local callback server,
// browser redirect, token exchange, and config persistence) is coming in the
// next iteration. This stub exists so the command layer compiles and wires up
// correctly.
func Login() error {
	return errors.New("login is not yet implemented — run 'stigmer config backend set cloud' to configure cloud backend first")
}
