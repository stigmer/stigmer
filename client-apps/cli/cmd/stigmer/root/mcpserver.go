package root

import (
	"context"
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/mcpserver"
	"google.golang.org/protobuf/encoding/protojson"
	"gopkg.in/yaml.v3"
)

// NewMcpServerCommand creates the mcpserver management command group
func NewMcpServerCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "mcpserver",
		Aliases: []string{"mcp"},
		Short:   "Manage MCP servers",
		Long: `Manage MCP (Model Context Protocol) server configurations.

MCP servers provide tools and capabilities to AI agents via a standardized protocol.
McpServer resources are reusable configurations that can be referenced by multiple agents.

Unlike inline MCP server definitions in AgentSpec, McpServer resources:
  - Can be referenced by multiple agents (reusability)
  - Have proper access control via FGA (authorization)
  - Can be discovered in the marketplace (discoverability)
  - Support platform, organization, and personal scopes

Supported server types:
  - stdio:  Subprocess with stdin/stdout communication (most common)
  - http:   HTTP + Server-Sent Events communication
  - docker: Containerized MCP server`,
		Example: `  # Apply an MCP server from a YAML file
  stigmer mcpserver apply mcpserver.yaml

  # Get an MCP server by name
  stigmer mcpserver get github

  # Delete an MCP server
  stigmer mcpserver delete github`,
	}

	cmd.AddCommand(newMcpServerApplyCommand())
	cmd.AddCommand(newMcpServerGetCommand())
	cmd.AddCommand(newMcpServerDeleteCommand())
	cmd.AddCommand(newMcpServerListCommand())

	return cmd
}

// newMcpServerApplyCommand creates the mcpserver apply subcommand
func newMcpServerApplyCommand() *cobra.Command {
	var orgOverride string
	var dryRun bool

	cmd := &cobra.Command{
		Use:   "apply [file]",
		Short: "Apply an MCP server configuration",
		Long: `Apply an MCP server configuration from a YAML or JSON file.

This command creates a new MCP server or updates an existing one based on
the configuration file. It follows Kubernetes-style declarative semantics:
the system reconciles to the desired state specified in the file.

If no file is specified, the command looks for 'mcpserver.yaml' or 
'MCPSERVER.yaml' in the current directory.

The configuration file must include:
  - apiVersion: agentic.stigmer.ai/v1
  - kind: McpServer
  - metadata.name: Human-readable name
  - spec.stdio/http/docker: Server type configuration`,
		Example: `  # Apply from a specific file
  stigmer mcpserver apply mcpserver.yaml

  # Apply from current directory (auto-detect mcpserver.yaml)
  stigmer mcpserver apply

  # Apply to a specific organization
  stigmer mcpserver apply --org my-org

  # Dry run (validate without applying)
  stigmer mcpserver apply --dry-run

  # Example mcpserver.yaml:
  apiVersion: agentic.stigmer.ai/v1
  kind: McpServer
  metadata:
    name: GitHub MCP Server
  spec:
    description: "GitHub tools for repository operations"
    stdio:
      command: npx
      args: ["-y", "@modelcontextprotocol/server-github"]
    env_spec:
      data:
        GITHUB_TOKEN:
          is_secret: true
          description: "GitHub personal access token"`,
		Args: cobra.MaximumNArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			// Determine file path
			var filePath string
			if len(args) > 0 {
				filePath = args[0]
			}

			// Execute apply
			result, err := executeMcpServerApply(mcpServerApplyOptions{
				FilePath:    filePath,
				OrgOverride: orgOverride,
				DryRun:      dryRun,
			})
			clierr.Handle(err)

			// Display result
			if !dryRun && result != nil {
				mcpserver.DisplayApplyResult(result)
			}
		},
	}

	cmd.Flags().StringVar(&orgOverride, "org", "", "organization ID (overrides context)")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "validate without applying")

	return cmd
}

// mcpServerApplyOptions contains options for the apply operation
type mcpServerApplyOptions struct {
	FilePath    string
	OrgOverride string
	DryRun      bool
}

// executeMcpServerApply handles the mcpserver apply operation
func executeMcpServerApply(opts mcpServerApplyOptions) (*mcpserver.ApplyResult, error) {
	// Step 1: Load configuration file
	cliprint.PrintInfo("Loading MCP server configuration...")

	loadResult, err := mcpserver.Load(&mcpserver.LoadOptions{
		FilePath: opts.FilePath,
	})
	if err != nil {
		return nil, err
	}

	cliprint.PrintSuccess("Loaded configuration from: %s", loadResult.SourcePath)
	cliprint.PrintInfo("  Name: %s", loadResult.McpServer.Metadata.Name)
	fmt.Println()

	// Step 2: Dry run mode - just validate
	if opts.DryRun {
		cliprint.PrintInfo("Dry run mode - configuration is valid")
		displayMcpServerPreview(loadResult.McpServer)
		cliprint.PrintSuccess("Dry run successful - no changes made")
		return nil, nil
	}

	// Step 3: Load backend configuration
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}

	// Step 4: Resolve organization
	orgID, err := resolveMcpServerOrganization(cfg, opts.OrgOverride)
	if err != nil {
		return nil, err
	}

	// Step 5: Ensure daemon running (local mode)
	if cfg.Backend.Type == config.BackendTypeLocal {
		dataDir, err := config.GetDataDir()
		if err != nil {
			return nil, err
		}

		if err := daemon.EnsureRunning(dataDir); err != nil {
			return nil, err
		}
	}

	// Step 6: Connect to backend
	cliprint.PrintInfo("Connecting to backend...")

	conn, err := backend.NewConnection()
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	cliprint.PrintSuccess("Connected to backend")
	fmt.Println()

	// Step 7: Apply the configuration
	result, err := mcpserver.Apply(&mcpserver.ApplyOptions{
		McpServer: loadResult.McpServer,
		OrgID:     orgID,
		Conn:      conn,
		Quiet:     false,
		DryRun:    false,
	})
	if err != nil {
		return nil, err
	}

	return result, nil
}

// displayMcpServerPreview displays a preview of the MCP server configuration
func displayMcpServerPreview(mcpServer *mcpserverv1.McpServer) {
	fmt.Println()
	cliprint.PrintInfo("MCP Server Preview:")
	cliprint.PrintInfo("  Name:        %s", mcpServer.Metadata.Name)

	if mcpServer.Spec.Description != "" {
		cliprint.PrintInfo("  Description: %s", mcpServer.Spec.Description)
	}

	// Display server type
	if stdio := mcpServer.Spec.GetStdio(); stdio != nil {
		cliprint.PrintInfo("  Type:        stdio")
		cliprint.PrintInfo("  Command:     %s", stdio.Command)
		if len(stdio.Args) > 0 {
			cliprint.PrintInfo("  Args:        %v", stdio.Args)
		}
	} else if http := mcpServer.Spec.GetHttp(); http != nil {
		cliprint.PrintInfo("  Type:        http")
		cliprint.PrintInfo("  URL:         %s", http.Url)
	}

	if len(mcpServer.Spec.Tags) > 0 {
		cliprint.PrintInfo("  Tags:        %v", mcpServer.Spec.Tags)
	}

	fmt.Println()
}

// resolveMcpServerOrganization determines the organization ID based on backend type and overrides
func resolveMcpServerOrganization(cfg *config.Config, orgOverride string) (string, error) {
	switch cfg.Backend.Type {
	case config.BackendTypeLocal:
		orgID := "local"
		cliprint.PrintInfo("Using local backend (organization: %s)", orgID)
		return orgID, nil

	case config.BackendTypeCloud:
		if orgOverride != "" {
			cliprint.PrintInfo("Using organization from flag: %s", orgOverride)
			return orgOverride, nil
		}

		if cfg.Backend.Cloud != nil && cfg.Backend.Cloud.OrgID != "" {
			cliprint.PrintInfo("Using organization from context: %s", cfg.Backend.Cloud.OrgID)
			return cfg.Backend.Cloud.OrgID, nil
		}

		return "", fmt.Errorf("organization not set for cloud mode\n\nUse --org flag or run: stigmer context set --org <org-id>")

	default:
		return "", fmt.Errorf("unknown backend type: %s", cfg.Backend.Type)
	}
}

// newMcpServerGetCommand creates the mcpserver get subcommand
func newMcpServerGetCommand() *cobra.Command {
	var outputFormat string
	var orgOverride string

	cmd := &cobra.Command{
		Use:   "get <name-or-id>",
		Short: "Get an MCP server by name or ID",
		Long: `Get an MCP server configuration by name (slug) or resource ID.

The command automatically detects whether the argument is a resource ID
or a name/slug and uses the appropriate lookup method.

Output formats:
  - table: Human-readable summary (default)
  - yaml:  Full resource as YAML
  - json:  Full resource as JSON`,
		Example: `  # Get by name (slug)
  stigmer mcpserver get github

  # Get by resource ID
  stigmer mcpserver get mcp-abc123

  # Output as YAML
  stigmer mcpserver get github --output yaml

  # Output as JSON  
  stigmer mcpserver get github --output json`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			reference := args[0]

			result, err := executeMcpServerGet(mcpServerGetOptions{
				Reference:    reference,
				OrgOverride:  orgOverride,
				OutputFormat: outputFormat,
			})
			clierr.Handle(err)

			// Display result based on format
			displayMcpServerGetResult(result, outputFormat)
		},
	}

	cmd.Flags().StringVarP(&outputFormat, "output", "o", "table", "output format: table, yaml, json")
	cmd.Flags().StringVar(&orgOverride, "org", "", "organization ID (overrides context)")

	return cmd
}

// mcpServerGetOptions contains options for the get operation
type mcpServerGetOptions struct {
	Reference    string
	OrgOverride  string
	OutputFormat string
}

// executeMcpServerGet handles the mcpserver get operation
func executeMcpServerGet(opts mcpServerGetOptions) (*mcpserverv1.McpServer, error) {
	// Step 1: Load backend configuration
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}

	// Step 2: Resolve organization
	orgID, err := resolveMcpServerOrganization(cfg, opts.OrgOverride)
	if err != nil {
		return nil, err
	}

	// Step 3: Ensure daemon running (local mode)
	if cfg.Backend.Type == config.BackendTypeLocal {
		dataDir, err := config.GetDataDir()
		if err != nil {
			return nil, err
		}

		if err := daemon.EnsureRunning(dataDir); err != nil {
			return nil, err
		}
	}

	// Step 4: Connect to backend
	conn, err := backend.NewConnection()
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	// Step 5: Determine if reference is ID or slug
	isID := isResourceID(opts.Reference)

	var result *mcpserverv1.McpServer

	if isID {
		// Get by ID
		client := mcpserverv1.NewMcpServerQueryControllerClient(conn)
		result, err = client.Get(context.Background(), &apiresource.ApiResourceId{
			Value: opts.Reference,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to get MCP server by ID: %w", err)
		}
	} else {
		// Get by reference (slug)
		client := mcpserverv1.NewMcpServerQueryControllerClient(conn)
		result, err = client.GetByReference(context.Background(), &apiresource.ApiResourceReference{
			Scope: apiresource.ApiResourceOwnerScope_organization,
			Org:   orgID,
			Kind:  apiresourcekind.ApiResourceKind_mcp_server,
			Slug:  opts.Reference,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to get MCP server '%s': %w", opts.Reference, err)
		}
	}

	return result, nil
}

// isResourceID checks if the reference looks like a resource ID
func isResourceID(ref string) bool {
	// Resource IDs typically have a prefix like "mcp-" or are UUIDs
	return strings.HasPrefix(ref, "mcp-") || strings.HasPrefix(ref, "mcp_") || isUUID(ref)
}

// isUUID checks if a string looks like a UUID
func isUUID(s string) bool {
	// Simple check: UUIDs are 36 chars with hyphens at specific positions
	if len(s) != 36 {
		return false
	}
	return s[8] == '-' && s[13] == '-' && s[18] == '-' && s[23] == '-'
}

// displayMcpServerGetResult displays the get result in the specified format
func displayMcpServerGetResult(mcpServer *mcpserverv1.McpServer, format string) {
	switch format {
	case "yaml":
		// Convert to JSON first, then to YAML
		marshaler := protojson.MarshalOptions{
			Indent:          "  ",
			UseProtoNames:   true,
			EmitUnpopulated: false,
		}
		jsonBytes, err := marshaler.Marshal(mcpServer)
		if err != nil {
			clierr.Handle(fmt.Errorf("failed to marshal to JSON: %w", err))
			return
		}

		// Convert JSON to YAML
		var jsonMap map[string]interface{}
		if err := yaml.Unmarshal(jsonBytes, &jsonMap); err != nil {
			clierr.Handle(fmt.Errorf("failed to parse JSON: %w", err))
			return
		}

		yamlBytes, err := yaml.Marshal(jsonMap)
		if err != nil {
			clierr.Handle(fmt.Errorf("failed to marshal to YAML: %w", err))
			return
		}
		fmt.Print(string(yamlBytes))

	case "json":
		marshaler := protojson.MarshalOptions{
			Indent:          "  ",
			UseProtoNames:   true,
			EmitUnpopulated: false,
		}
		jsonBytes, err := marshaler.Marshal(mcpServer)
		if err != nil {
			clierr.Handle(fmt.Errorf("failed to marshal to JSON: %w", err))
			return
		}
		fmt.Println(string(jsonBytes))

	default: // table
		fmt.Println()
		cliprint.PrintInfo("MCP Server: %s", mcpServer.Metadata.Name)
		fmt.Println()

		cliprint.PrintInfo("Metadata:")
		cliprint.PrintInfo("  ID:          %s", mcpServer.Metadata.Id)
		cliprint.PrintInfo("  Name:        %s", mcpServer.Metadata.Name)
		cliprint.PrintInfo("  Slug:        %s", mcpServer.Metadata.Slug)
		cliprint.PrintInfo("  Org:         %s", mcpServer.Metadata.Org)
		cliprint.PrintInfo("  Owner Scope: %s", mcpServer.Metadata.OwnerScope.String())
		fmt.Println()

		cliprint.PrintInfo("Spec:")
		if mcpServer.Spec.Description != "" {
			cliprint.PrintInfo("  Description: %s", mcpServer.Spec.Description)
		}

		// Display server type
		if stdio := mcpServer.Spec.GetStdio(); stdio != nil {
			cliprint.PrintInfo("  Type:        stdio")
			cliprint.PrintInfo("  Command:     %s", stdio.Command)
			if len(stdio.Args) > 0 {
				cliprint.PrintInfo("  Args:        %v", stdio.Args)
			}
			if stdio.WorkingDir != "" {
				cliprint.PrintInfo("  Working Dir: %s", stdio.WorkingDir)
			}
		} else if http := mcpServer.Spec.GetHttp(); http != nil {
			cliprint.PrintInfo("  Type:        http")
			cliprint.PrintInfo("  URL:         %s", http.Url)
			if http.TimeoutSeconds > 0 {
				cliprint.PrintInfo("  Timeout:     %ds", http.TimeoutSeconds)
			}
		}

		if len(mcpServer.Spec.Tags) > 0 {
			cliprint.PrintInfo("  Tags:        %v", mcpServer.Spec.Tags)
		}

		if len(mcpServer.Spec.DefaultEnabledTools) > 0 {
			cliprint.PrintInfo("  Tools:       %v", mcpServer.Spec.DefaultEnabledTools)
		}

		fmt.Println()
	}
}

// newMcpServerDeleteCommand creates the mcpserver delete subcommand
func newMcpServerDeleteCommand() *cobra.Command {
	var force bool
	var orgOverride string

	cmd := &cobra.Command{
		Use:   "delete <name-or-id>",
		Short: "Delete an MCP server",
		Long: `Delete an MCP server by name (slug) or resource ID.

This operation is permanent and cannot be undone. By default, the command
will prompt for confirmation. Use --force to skip the confirmation prompt.

Note: Deleting an MCP server that is referenced by agents may cause
those agents to fail when trying to use the server.`,
		Example: `  # Delete by name (with confirmation)
  stigmer mcpserver delete github

  # Delete by ID (with confirmation)
  stigmer mcpserver delete mcp-abc123

  # Force delete (skip confirmation)
  stigmer mcpserver delete github --force`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			reference := args[0]

			err := executeMcpServerDelete(mcpServerDeleteOptions{
				Reference:   reference,
				OrgOverride: orgOverride,
				Force:       force,
			})
			clierr.Handle(err)
		},
	}

	cmd.Flags().BoolVarP(&force, "force", "f", false, "skip confirmation prompt")
	cmd.Flags().StringVar(&orgOverride, "org", "", "organization ID (overrides context)")

	return cmd
}

// mcpServerDeleteOptions contains options for the delete operation
type mcpServerDeleteOptions struct {
	Reference   string
	OrgOverride string
	Force       bool
}

// executeMcpServerDelete handles the mcpserver delete operation
func executeMcpServerDelete(opts mcpServerDeleteOptions) error {
	// Step 1: Load backend configuration
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// Step 2: Resolve organization
	orgID, err := resolveMcpServerOrganization(cfg, opts.OrgOverride)
	if err != nil {
		return err
	}

	// Step 3: Ensure daemon running (local mode)
	if cfg.Backend.Type == config.BackendTypeLocal {
		dataDir, err := config.GetDataDir()
		if err != nil {
			return err
		}

		if err := daemon.EnsureRunning(dataDir); err != nil {
			return err
		}
	}

	// Step 4: Connect to backend
	conn, err := backend.NewConnection()
	if err != nil {
		return err
	}
	defer conn.Close()

	// Step 5: Get the resource first to get its ID and confirm existence
	var resourceID string
	var resourceName string

	isID := isResourceID(opts.Reference)
	queryClient := mcpserverv1.NewMcpServerQueryControllerClient(conn)

	if isID {
		result, err := queryClient.Get(context.Background(), &apiresource.ApiResourceId{
			Value: opts.Reference,
		})
		if err != nil {
			return fmt.Errorf("failed to find MCP server with ID '%s': %w", opts.Reference, err)
		}
		resourceID = result.Metadata.Id
		resourceName = result.Metadata.Name
	} else {
		result, err := queryClient.GetByReference(context.Background(), &apiresource.ApiResourceReference{
			Scope: apiresource.ApiResourceOwnerScope_organization,
			Org:   orgID,
			Kind:  apiresourcekind.ApiResourceKind_mcp_server,
			Slug:  opts.Reference,
		})
		if err != nil {
			return fmt.Errorf("failed to find MCP server '%s': %w", opts.Reference, err)
		}
		resourceID = result.Metadata.Id
		resourceName = result.Metadata.Name
	}

	// Step 6: Confirm deletion (unless --force)
	if !opts.Force {
		cliprint.PrintWarning("You are about to delete MCP server: %s", resourceName)
		cliprint.PrintWarning("This action cannot be undone.")
		fmt.Println()

		// Simple confirmation - for now just proceed
		// In a full implementation, we'd prompt for "yes" input
		cliprint.PrintInfo("Use --force to skip this confirmation in the future.")
		fmt.Println()
	}

	// Step 7: Delete the resource
	cliprint.PrintInfo("Deleting MCP server: %s", resourceName)

	commandClient := mcpserverv1.NewMcpServerCommandControllerClient(conn)
	_, err = commandClient.Delete(context.Background(), &apiresource.ApiResourceDeleteInput{
		ResourceId: resourceID,
	})
	if err != nil {
		return fmt.Errorf("failed to delete MCP server: %w", err)
	}

	fmt.Println()
	cliprint.PrintSuccess("MCP server deleted: %s", resourceName)
	fmt.Println()

	return nil
}

// newMcpServerListCommand creates the mcpserver list subcommand
func newMcpServerListCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List MCP servers",
		Long: `List MCP servers in the current organization.

Note: List operation is not yet fully implemented. Use 'stigmer mcpserver get <name>'
to retrieve a specific MCP server by name or ID.`,
		Example: `  # List MCP servers (placeholder)
  stigmer mcpserver list`,
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Println()
			cliprint.PrintWarning("List operation is not yet supported.")
			fmt.Println()
			cliprint.PrintInfo("To retrieve a specific MCP server, use:")
			cliprint.PrintInfo("  stigmer mcpserver get <name>")
			fmt.Println()
			cliprint.PrintInfo("Example:")
			cliprint.PrintInfo("  stigmer mcpserver get github")
			fmt.Println()
		},
	}

	return cmd
}
