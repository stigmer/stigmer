package auth

import (
	"context"
	"fmt"
	"net"
	"net/http"

	"github.com/pkg/errors"
)

// callbackResult holds the authorization code and state returned by the OAuth
// provider's redirect to our local callback server.
type callbackResult struct {
	code  string
	state string
}

// callbackServer manages a short-lived HTTP server on localhost that receives
// the OAuth authorization code redirect from Auth0.
//
// Lifecycle: newCallbackServer → Start → WaitForCallback → Shutdown.
type callbackServer struct {
	port     string
	server   *http.Server
	resultCh chan callbackResult
	errCh    chan error
}

// newCallbackServer creates a callback server bound to the given port.
// Call Start() to begin listening.
func newCallbackServer(port string) *callbackServer {
	return &callbackServer{
		port:     port,
		resultCh: make(chan callbackResult, 1),
		errCh:    make(chan error, 1),
	}
}

// Start begins listening on localhost:{port} in a background goroutine.
// It returns once the listener is bound (or fails to bind).
func (s *callbackServer) Start() error {
	mux := http.NewServeMux()

	mux.HandleFunc("/", s.handleRoot)
	mux.HandleFunc(CallbackPath, s.handleCallback)

	s.server = &http.Server{
		Addr:    net.JoinHostPort("127.0.0.1", s.port),
		Handler: mux,
	}

	// Bind the listener eagerly so Start() can report port-in-use immediately
	// rather than racing in the background goroutine.
	ln, err := net.Listen("tcp", s.server.Addr)
	if err != nil {
		return errors.Wrapf(err, "failed to listen on %s (is another process using port %s?)", s.server.Addr, s.port)
	}

	go func() {
		if err := s.server.Serve(ln); err != nil && err != http.ErrServerClosed {
			s.errCh <- errors.Wrap(err, "callback server error")
		}
	}()

	return nil
}

// WaitForCallback blocks until the OAuth callback is received, a server error
// occurs, or the context is cancelled (timeout / Ctrl-C).
func (s *callbackServer) WaitForCallback(ctx context.Context) (callbackResult, error) {
	select {
	case result := <-s.resultCh:
		return result, nil
	case err := <-s.errCh:
		return callbackResult{}, err
	case <-ctx.Done():
		return callbackResult{}, errors.New("timed out waiting for authentication — please try again")
	}
}

// Shutdown gracefully stops the HTTP server.
func (s *callbackServer) Shutdown(ctx context.Context) error {
	if s.server != nil {
		return s.server.Shutdown(ctx)
	}
	return nil
}

// handleRoot serves a minimal holding page while the user authenticates in
// their browser.  This page is only visible if someone navigates directly to
// localhost:8088 (which the normal flow never does).
func (s *callbackServer) handleRoot(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, `<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Stigmer CLI</h2><p>Waiting for authentication…</p></body></html>`)
}

// handleCallback processes the OAuth redirect from Auth0.
//
// On success it extracts the authorization code and state, sends them to
// resultCh, and renders the success page.  On error (missing code, Auth0
// error param) it renders the error page and still sends to errCh so the
// CLI can surface the failure.
func (s *callbackServer) handleCallback(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")

	// Auth0 may redirect with ?error=access_denied&error_description=…
	if errCode := r.URL.Query().Get("error"); errCode != "" {
		errDesc := r.URL.Query().Get("error_description")
		userMsg := "Authentication was cancelled or denied."
		if errCode == "access_denied" {
			userMsg = "You cancelled the login process."
		}
		fmt.Fprintf(w, errorPage, userMsg, errCode, errDesc)
		s.errCh <- errors.Errorf("authentication failed: %s — %s", errCode, errDesc)
		return
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		fmt.Fprintf(w, errorPage, "No authorization code received.", "missing_code", "The callback did not contain an authorization code.")
		s.errCh <- errors.New("callback did not contain an authorization code")
		return
	}

	state := r.URL.Query().Get("state")

	fmt.Fprint(w, successPage)

	s.resultCh <- callbackResult{code: code, state: state}
}
