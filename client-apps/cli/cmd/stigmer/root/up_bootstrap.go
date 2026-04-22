package root

import (
	"context"
	"time"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/mcpserver"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
)

// runBootstrapDiscovery discovers capabilities for all bootstrapped MCP
// servers. Runs synchronously after daemon start so tool metadata is
// immediately available. Failures are logged but do not block success.
func runBootstrapDiscovery(cfg *config.Config) {
	client, err := backend.NewStigmerClient()
	if err != nil {
		climsg.Warning("Skipping MCP discovery: %v", err)
		return
	}
	defer client.Close()

	orgID := cfg.ResolveContextOrganization()
	if orgID == "" {
		climsg.Warning("Skipping MCP discovery: no organization context set")
		return
	}

	result := mcpserver.ConnectAll(context.Background(), &mcpserver.ConnectAllOptions{
		Client:  client,
		OrgID:   orgID,
		Timeout: 30 * time.Second,
	})

	if result.Succeeded > 0 {
		climsg.Success("Discovered capabilities for %d MCP server(s)", result.Succeeded)
	}
	if result.Attempted > result.Succeeded {
		climsg.Warning("Discovery failed for %d MCP server(s)", result.Attempted-result.Succeeded)
	}
	for _, msg := range result.SkipMessages {
		climsg.Warning("%s", msg)
	}
}

// autoSetOrgContext ensures the CLI has an active organization context. If
// context.organization is already set, this is a no-op. Otherwise, it queries
// the server for available organizations and auto-sets the context when exactly
// one is found. With multiple orgs, it warns the user to choose explicitly.
func autoSetOrgContext(cfg *config.Config) {
	if cfg.ResolveContextOrganization() != "" {
		return
	}

	stigmerClient, err := backend.NewStigmerClient()
	if err != nil {
		climsg.Warning("Skipping org context auto-detection: %v", err)
		return
	}
	defer stigmerClient.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	resp, err := stigmerClient.Organization.FindMyOrganizations(ctx)
	if err != nil {
		climsg.Warning("Failed to detect organizations: %v", err)
		return
	}

	switch len(resp.GetEntries()) {
	case 0:
		climsg.Warning("No organizations found. Resources cannot be applied until an organization exists.")
	case 1:
		org := resp.GetEntries()[0]
		slug := org.GetMetadata().GetSlug()
		cfg.Context.Organization = slug
		if err := config.Save(cfg); err != nil {
			climsg.Warning("Failed to save organization context: %v", err)
			return
		}
		climsg.Success("Active organization: %s", slug)
	default:
		climsg.Warning("Multiple organizations found. Set the active organization:")
		for _, org := range resp.GetEntries() {
			climsg.Info("  - %s", org.GetMetadata().GetSlug())
		}
		climsg.Info("")
		climsg.Info("Run: stigmer config context set --org <slug>")
	}
}
