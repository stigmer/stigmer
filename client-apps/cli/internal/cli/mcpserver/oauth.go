package mcpserver

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	mcpserverv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/browser"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
)

const (
	// DefaultCloudConsoleURL is the well-known URL for the Stigmer Cloud web console.
	DefaultCloudConsoleURL = "https://app.stigmer.ai"

	oauthPollInterval   = 3 * time.Second
	oauthPollTimeout    = 5 * time.Minute
	consoleProbeTimeout = 2 * time.Second
)

// CheckOAuthRequired returns true if the MCP server has an auth block
// configured, indicating it requires OAuth-based credential acquisition.
func CheckOAuthRequired(server *mcpserverv1.McpServer) bool {
	auth := server.GetSpec().GetAuth()
	if auth == nil {
		return false
	}
	return auth.GetTargetEnvVar() != ""
}

// CheckOAuthGrantExists queries the backend to determine whether the
// authenticated user already has an active OAuth grant for the given
// MCP server in the specified org.
func CheckOAuthGrantExists(
	ctx context.Context,
	client *stigmer.Client,
	mcpServerID string,
	org string,
) (bool, error) {
	resp, err := client.McpServer.GetOAuthGrantStatus(ctx, &mcpserverv1.GetOAuthGrantStatusInput{
		ResourceId: mcpServerID,
		Org:        org,
	})
	if err != nil {
		return false, errors.Wrap(err, "failed to check OAuth grant status")
	}
	return resp.GetConnected(), nil
}

// RunOAuthFlow opens the web console for the user to complete the OAuth
// flow, then polls getOAuthGrantStatus until the grant appears or the
// context is cancelled.
func RunOAuthFlow(
	ctx context.Context,
	client *stigmer.Client,
	server *mcpserverv1.McpServer,
	org string,
	cfg *config.Config,
) error {
	consoleURL := ResolveConsoleURL(cfg)

	if cfg.Backend.Type == config.BackendTypeLocal {
		if err := checkWebConsoleAvailable(consoleURL); err != nil {
			return err
		}
	}

	slug := server.GetMetadata().GetSlug()
	pageURL := fmt.Sprintf("%s/%s/mcp-servers/%s", consoleURL, org, slug)

	climsg.Info("OAuth authentication required for '%s'.", server.GetMetadata().GetName())
	climsg.Info("Opening web console to complete authentication...")
	fmt.Fprintf(os.Stderr, "\n  If the browser doesn't open automatically, visit:\n  %s\n\n", pageURL)

	if err := browser.Open(pageURL); err != nil {
		fmt.Fprintf(os.Stderr, "  Could not open browser automatically: %v\n", err)
		fmt.Fprintln(os.Stderr, "  Please open the URL above in your browser.")
	}

	return WaitForOAuthGrant(ctx, client, server.GetMetadata().GetId(), org)
}

// WaitForOAuthGrant polls getOAuthGrantStatus until the grant is connected
// or the timeout expires. The poll loop respects context cancellation
// (Ctrl+C).
func WaitForOAuthGrant(
	ctx context.Context,
	client *stigmer.Client,
	mcpServerID string,
	org string,
) error {
	ctx, cancel := context.WithTimeout(ctx, oauthPollTimeout)
	defer cancel()

	climsg.Info("Waiting for OAuth connection... (press Ctrl+C to cancel)")

	ticker := time.NewTicker(oauthPollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return errors.New("timed out waiting for OAuth connection — please try again")
		case <-ticker.C:
			connected, err := CheckOAuthGrantExists(ctx, client, mcpServerID, org)
			if err != nil {
				return err
			}
			if connected {
				climsg.Success("OAuth connection established.")
				fmt.Fprintln(os.Stderr)
				return nil
			}
		}
	}
}

// ResolveConsoleURL determines the web console URL based on backend type.
//
// Resolution order:
//  1. STIGMER_CONSOLE_URL environment variable (explicit override)
//  2. Local mode: http://localhost:{WebConsolePort}
//  3. Cloud mode: DefaultCloudConsoleURL
func ResolveConsoleURL(cfg *config.Config) string {
	if url := os.Getenv("STIGMER_CONSOLE_URL"); url != "" {
		return url
	}
	if cfg.Backend.Type == config.BackendTypeLocal {
		return fmt.Sprintf("http://localhost:%d", daemon.WebConsolePort)
	}
	return DefaultCloudConsoleURL
}

// checkWebConsoleAvailable probes the web console URL to verify it is
// responding. Returns a user-friendly error with remediation steps if
// the console is unreachable.
func checkWebConsoleAvailable(consoleURL string) error {
	httpClient := &http.Client{Timeout: consoleProbeTimeout}
	resp, err := httpClient.Get(consoleURL)
	if err != nil {
		return fmt.Errorf(
			"OAuth authentication requires the web console, which is not running.\n\n" +
				"To fix:\n" +
				"  - Restart the server without --no-web: stigmer server\n" +
				"  - Or provide credentials manually: stigmer connect mcp-server <slug> --env TOKEN=...",
		)
	}
	resp.Body.Close()
	return nil
}
