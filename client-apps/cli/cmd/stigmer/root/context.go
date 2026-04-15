package root

import (
	"context"
	"os"
	"time"

	"github.com/spf13/cobra"
	orgv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/organization/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
	"google.golang.org/protobuf/types/known/emptypb"
)

// NewContextCommand creates the context command for managing active CLI context.
func NewContextCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "context",
		Short: "Manage active CLI context",
		Long: `Manage the active CLI context (organization, environment).

The context determines which organization's resources are targeted by
all commands. Set after first server start, or switch manually.`,
	}

	cmd.AddCommand(newContextShowCommand())
	cmd.AddCommand(newContextSetCommand())

	return cmd
}

func newContextShowCommand() *cobra.Command {
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:   "show",
		Short: "Show active context",
		Run: func(cmd *cobra.Command, args []string) {
			handleContextShow(resolveResultFormat(jsonOutput, quietOutput))
		},
	}

	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)
	return cmd
}

func newContextSetCommand() *cobra.Command {
	var orgSlug string
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:   "set",
		Short: "Set active context",
		Long: `Set the active CLI context.

The --org flag sets the active organization. The CLI validates that the
organization exists on the server before saving.`,
		Example: `  stigmer config context set --org my-org
  stigmer config context set --org default`,
		Run: func(cmd *cobra.Command, args []string) {
			handleContextSet(orgSlug, resolveResultFormat(jsonOutput, quietOutput))
		},
	}

	cmd.Flags().StringVar(&orgSlug, "org", "", "organization slug to set as active")
	_ = cmd.MarkFlagRequired("org")
	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)

	return cmd
}

func handleContextShow(format clioutput.OutputFormat) {
	renderer := clioutput.NewRenderer(format, os.Stdout, os.Stderr)

	cfg, err := config.Load()
	if err != nil {
		clierr.Handle(err)
		return
	}

	org := cfg.ResolveContextOrganization()
	if org == "" {
		org = "(not set)"
	}

	result := clioutput.Success("CLI context")
	result.AddSection("").
		Field("Organization", org).
		Field("Backend", string(cfg.Backend.Type))

	renderer.Render(result)
}

func handleContextSet(orgSlug string, format clioutput.OutputFormat) {
	renderer := clioutput.NewRenderer(format, os.Stdout, os.Stderr)

	if orgSlug == "" {
		result := clioutput.Error("No context value specified")
		result.Hint("Use --org to set the active organization")
		renderer.Render(result)
		return
	}

	cfg, err := config.Load()
	if err != nil {
		clierr.Handle(err)
		return
	}

	// Validate that the organization exists on the server.
	client, err := backend.NewStigmerClient()
	if err != nil {
		clierr.Handle(err)
		return
	}
	defer client.Close()
	conn := client.Conn()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	orgClient := orgv1.NewOrganizationQueryControllerClient(conn)
	resp, err := orgClient.FindMyOrganizations(ctx, &emptypb.Empty{})
	if err != nil {
		climsg.Error("Failed to query organizations: %v", err)
		clierr.Handle(err)
		return
	}

	var found bool
	for _, org := range resp.GetEntries() {
		if org.GetMetadata().GetSlug() == orgSlug {
			found = true
			break
		}
	}

	if !found {
		result := clioutput.Error("Organization '%s' not found", orgSlug)
		if entries := resp.GetEntries(); len(entries) > 0 {
			sec := result.AddSection("Available organizations")
			for _, org := range entries {
				sec.Item(org.GetMetadata().GetSlug())
			}
		}
		renderer.Render(result)
		return
	}

	cfg.Context.Organization = orgSlug
	if err := config.Save(cfg); err != nil {
		clierr.Handle(err)
		return
	}

	result := clioutput.Success("Active organization set to: %s", orgSlug)
	renderer.Render(result)
}
