package root

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/auth"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
)

// NewAuthCommand creates the auth command and its subcommands.
func NewAuthCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "auth",
		Short: "Manage authentication with Stigmer Cloud",
		Long: `Authenticate with the Stigmer Cloud platform using browser-based PKCE OAuth.

The auth command provides subcommands to log in, log out, and check
your current authentication status.`,
		Example: `  # Login to Stigmer Cloud
  stigmer auth login

  # Check who you're logged in as
  stigmer auth whoami

  # Logout from Stigmer Cloud
  stigmer auth logout`,
	}

	cmd.AddCommand(newAuthLoginCommand())
	cmd.AddCommand(newAuthLogoutCommand())
	cmd.AddCommand(newAuthWhoamiCommand())

	return cmd
}

func newAuthLoginCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "login",
		Short: "Login to Stigmer Cloud",
		Long: `Authenticate with Stigmer Cloud using browser-based PKCE OAuth flow.

This command will:
1. Open your default web browser to the Stigmer login page
2. Wait for you to complete authentication
3. Save your access token to ~/.stigmer/config.yaml
4. Set the backend to cloud mode`,
		Example: "  stigmer auth login",
		Run: func(cmd *cobra.Command, args []string) {
			handleAuthLogin()
		},
	}
}

func newAuthLogoutCommand() *cobra.Command {
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:   "logout",
		Short: "Logout from Stigmer Cloud",
		Long: `Clear your authentication token and logout from Stigmer Cloud.

You will need to run 'stigmer auth login' again to use cloud commands.`,
		Example: "  stigmer auth logout",
		Run: func(cmd *cobra.Command, args []string) {
			handleAuthLogout(resolveResultFormat(jsonOutput, quietOutput))
		},
	}

	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)
	return cmd
}

func newAuthWhoamiCommand() *cobra.Command {
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:   "whoami",
		Short: "Display current user information",
		Long: `Show information about the currently authenticated user.

Fetches account details from the Stigmer Cloud backend using the
stored authentication token.`,
		Example: "  stigmer auth whoami",
		Run: func(cmd *cobra.Command, args []string) {
			handleAuthWhoami(resolveResultFormat(jsonOutput, quietOutput))
		},
	}

	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)
	return cmd
}

func handleAuthLogin() {
	_, err := auth.Login()
	clierr.Handle(err)

	renderer := clioutput.NewRenderer(clioutput.FormatHuman, os.Stdout, os.Stderr)
	result := clioutput.Success("Authenticated with Stigmer Cloud")
	result.Hint("Run commands against the cloud backend:")
	result.Hint("  stigmer list agents")
	renderer.Render(result)
}

func handleAuthLogout(format clioutput.OutputFormat) {
	renderer := clioutput.NewRenderer(format, os.Stdout, os.Stderr)

	cfg, err := config.Load()
	if err != nil {
		clierr.Handle(err)
		return
	}

	if cfg.Backend.Cloud == nil || cfg.Backend.Cloud.Token == "" {
		result := clioutput.Warning("Not currently logged in")
		result.Hint("Run 'stigmer auth login' to authenticate.")
		renderer.Render(result)
		return
	}

	cfg.Backend.Cloud.Token = ""

	if err := config.Save(cfg); err != nil {
		clierr.Handle(err)
		return
	}

	result := clioutput.Success("Logged out from Stigmer Cloud")
	result.Hint("Run 'stigmer auth login' to authenticate again.")
	renderer.Render(result)
}

func handleAuthWhoami(format clioutput.OutputFormat) {
	renderer := clioutput.NewRenderer(format, os.Stdout, os.Stderr)

	cfg, err := config.Load()
	if err != nil {
		clierr.Handle(err)
		return
	}

	if cfg.Backend.Cloud == nil || cfg.Backend.Cloud.Token == "" {
		result := clioutput.Error("Not authenticated")
		result.Hint("Run 'stigmer auth login' to authenticate with Stigmer Cloud.")
		renderer.Render(result)
		return
	}

	endpoint := cfg.Backend.Cloud.Endpoint
	if endpoint == "" {
		endpoint = "api.stigmer.ai:443"
	}

	account, err := auth.FetchIdentity(endpoint, cfg.Backend.Cloud.Token)
	if err != nil {
		result := clioutput.Error("Failed to fetch account information")
		result.Hint("Your token may have expired. Try: stigmer auth login")
		renderer.Render(result)
		return
	}

	result := clioutput.Success("Authenticated")
	sec := result.AddSection("")

	if account.Metadata != nil {
		sec.Field("Account ID", account.Metadata.Id)
		if account.Metadata.Name != "" {
			sec.Field("Name", account.Metadata.Name)
		}
	}

	if account.Spec != nil {
		if account.Spec.Email != "" {
			sec.Field("Email", account.Spec.Email)
		}
		if account.Spec.FirstName != "" || account.Spec.LastName != "" {
			sec.Field("Full Name", fmt.Sprintf("%s %s", account.Spec.FirstName, account.Spec.LastName))
		}
		if account.Spec.IsMachineAccount {
			sec.Field("Account Type", "Machine Account")
		} else {
			sec.Field("Account Type", "User Account")
		}
	}

	org := cfg.ResolveContextOrganization()
	if org != "" {
		sec.Field("Organization", org)
	} else {
		result.Hint("No organization set. Use: stigmer config context set --org <slug>")
	}

	renderer.Render(result)
}
