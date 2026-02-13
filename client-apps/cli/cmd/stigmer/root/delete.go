package root

import (
	"fmt"
	"strings"

	"github.com/pkg/errors"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/agent"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/execution"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/mcpserver"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/project"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/skill"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/workflow"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	"google.golang.org/grpc"
)

// NewDeleteCommand creates the unified delete command.
func NewDeleteCommand() *cobra.Command {
	var force bool
	var orgOverride string

	cmd := &cobra.Command{
		Use:   "delete <type> <name-or-id>",
		Short: "Delete a resource by type and reference",
		Long: `Delete a resource by type and name or ID.

The type can be specified using any alias:
  - agent, agt, agents
  - workflow, wf, workflows
  - mcpserver, mcp, mcp-server
  - project, proj, projects
  - skill, skills
  - execution, exec (cancels running execution)

The reference can be:
  - Resource ID (e.g., agt_abc123, aex_xyz789)
  - Slug (e.g., my-agent) - not for executions
  - Org/slug (e.g., stigmer/my-agent) - not for executions

WARNING: This operation is permanent and cannot be undone.
For executions, this gracefully cancels the running agent.`,
		Example: `  # Delete agent by slug
  stigmer delete agent my-agent

  # Delete workflow by ID
  stigmer delete workflow wfl_abc123

  # Cancel a running execution
  stigmer delete execution aex_01abc123

  # Force delete (skip confirmation)
  stigmer delete agent my-agent --force`,
		Args: cobra.ExactArgs(2),
		Run: func(cmd *cobra.Command, args []string) {
			err := executeDelete(deleteOptions{
				TypeArg:     args[0],
				Reference:   args[1],
				OrgOverride: orgOverride,
				Force:       force,
			})
			clierr.Handle(err)
		},
	}

	cmd.Flags().BoolVarP(&force, "force", "f", false, "skip confirmation prompt")
	cmd.Flags().StringVar(&orgOverride, "org", "", "organization ID override")

	return cmd
}

// deleteOptions contains options for the delete command.
type deleteOptions struct {
	TypeArg     string
	Reference   string
	OrgOverride string
	Force       bool
}

// isDeleteExecutionType checks if the type arg refers to executions.
func isDeleteExecutionType(typeArg string) bool {
	normalized := strings.ToLower(strings.TrimSpace(typeArg))
	return normalized == "execution" || normalized == "executions" || normalized == "exec"
}

// executeDelete deletes a resource by type and reference.
func executeDelete(opts deleteOptions) error {
	// Special case: Executions map delete to cancel
	// They use their own AgentExecutionCommandController.cancel() RPC
	if isDeleteExecutionType(opts.TypeArg) {
		return executeCancelExecution(opts)
	}

	// Step 1: Resolve type from alias
	reg := types.DefaultRegistry()
	info, ok := reg.GetByAlias(opts.TypeArg)
	if !ok {
		return fmt.Errorf("unknown resource type: %s\n\nAvailable types: agent, workflow, mcpserver, project, skill, execution", opts.TypeArg)
	}

	// Step 2: Check verb support
	if !info.SupportsVerb(types.VerbDelete) {
		return formatUnsupportedVerbError(info, types.VerbDelete)
	}

	// Step 3: Setup backend connection
	cfg, err := config.Load()
	if err != nil {
		return errors.Wrap(err, "failed to load configuration")
	}

	orgID, err := resolveOrganization(cfg, opts.OrgOverride)
	if err != nil {
		return err
	}

	if cfg.Backend.Type == config.BackendTypeLocal {
		dataDir, err := config.GetDataDir()
		if err != nil {
			return errors.Wrap(err, "failed to get data directory")
		}
		if err := daemon.EnsureRunning(dataDir); err != nil {
			return errors.Wrap(err, "failed to start daemon")
		}
	}

	conn, err := backend.NewConnection()
	if err != nil {
		return errors.Wrap(err, "failed to connect to backend")
	}
	defer conn.Close()

	// Step 4: Route to appropriate handler
	return routeDelete(info, opts.Reference, orgID, opts.Force, conn)
}

// routeDelete routes to the appropriate delete handler based on kind.
func routeDelete(info *types.TypeInfo, ref, orgID string, force bool, conn *grpc.ClientConn) error {
	switch info.ProtoKind {
	case apiresourcekind.ApiResourceKind_agent:
		return deleteAgent(ref, orgID, force, conn)

	case apiresourcekind.ApiResourceKind_workflow:
		return deleteWorkflow(ref, orgID, force, conn)

	case apiresourcekind.ApiResourceKind_mcp_server:
		return deleteMcpServer(ref, orgID, force, conn)

	case apiresourcekind.ApiResourceKind_project:
		return deleteProject(ref, orgID, force, conn)

	case apiresourcekind.ApiResourceKind_skill:
		return deleteSkill(ref, orgID, force, conn)

	default:
		return fmt.Errorf("delete not implemented for %s", info.DisplayName)
	}
}

// deleteAgent deletes an agent.
func deleteAgent(ref, orgID string, force bool, conn *grpc.ClientConn) error {
	// Get the agent first to show confirmation and resolve the ID
	agentRes, err := agent.GetFromBackend(conn, orgID, ref)
	if err != nil {
		return err
	}

	if !force {
		agent.DisplayDeleteConfirmation(agentRes)
		cliprint.PrintInfo("Use --force to skip this confirmation")
		fmt.Println()
	}

	result, err := agent.Delete(&agent.DeleteOptions{
		AgentID: agentRes.Metadata.Id,
		Conn:    conn,
	})
	if err != nil {
		return err
	}

	agent.DisplayDeleteResult(result)
	return nil
}

// deleteWorkflow deletes a workflow.
func deleteWorkflow(ref, orgID string, force bool, conn *grpc.ClientConn) error {
	// Get the workflow first to show confirmation and resolve the ID
	workflowRes, err := workflow.GetFromBackend(conn, orgID, ref)
	if err != nil {
		return err
	}

	if !force {
		workflow.DisplayDeleteConfirmation(workflowRes)
		cliprint.PrintInfo("Use --force to skip this confirmation")
		fmt.Println()
	}

	result, err := workflow.Delete(&workflow.DeleteOptions{
		WorkflowID: workflowRes.Metadata.Id,
		Conn:       conn,
	})
	if err != nil {
		return err
	}

	workflow.DisplayDeleteResult(result)
	return nil
}

// deleteMcpServer deletes an MCP server.
func deleteMcpServer(ref, orgID string, force bool, conn *grpc.ClientConn) error {
	// Get the mcp server first to show confirmation
	mcpRes, err := mcpserver.GetFromBackend(conn, orgID, ref)
	if err != nil {
		return err
	}

	if !force {
		mcpserver.DisplayDeleteConfirmation(mcpRes)
		cliprint.PrintInfo("Use --force to skip this confirmation")
		fmt.Println()
	}

	result, err := mcpserver.Delete(&mcpserver.DeleteOptions{
		Reference: ref,
		OrgID:     orgID,
		Conn:      conn,
	})
	if err != nil {
		return err
	}

	mcpserver.DisplayDeleteResult(result)
	return nil
}

// deleteProject deletes a project.
func deleteProject(ref, orgID string, force bool, conn *grpc.ClientConn) error {
	// Get the project first to show confirmation and resolve the ID
	projectRes, err := project.GetFromBackend(conn, orgID, ref)
	if err != nil {
		return err
	}

	if !force {
		project.DisplayDeleteConfirmation(projectRes)
		cliprint.PrintInfo("Use --force to skip this confirmation")
		fmt.Println()
	}

	result, err := project.Delete(&project.DeleteOptions{
		ProjectID: projectRes.Metadata.Id,
		Conn:      conn,
	})
	if err != nil {
		return err
	}

	project.DisplayDeleteResult(result)
	return nil
}

// deleteSkill deletes a skill.
func deleteSkill(ref, orgID string, force bool, conn *grpc.ClientConn) error {
	// Get the skill first to show confirmation and resolve the ID
	skillRes, err := skill.GetFromBackend(conn, orgID, ref)
	if err != nil {
		return err
	}

	if !force {
		skill.DisplayDeleteConfirmation(skillRes)
		cliprint.PrintInfo("Use --force to skip this confirmation")
		fmt.Println()
	}

	result, err := skill.Delete(&skill.DeleteOptions{
		SkillID: skillRes.Metadata.Id,
		Conn:    conn,
	})
	if err != nil {
		return err
	}

	skill.DisplayDeleteResult(result)
	return nil
}

// executeCancelExecution handles the special case of cancelling an execution.
// For executions, "delete" maps to "cancel" operation.
func executeCancelExecution(opts deleteOptions) error {
	// Validate reference is an execution ID
	if !reference.IsAgentExecutionID(opts.Reference) {
		return fmt.Errorf("invalid execution ID: %s\n\nExecutions must be referenced by ID (e.g., aex_01abc123)", opts.Reference)
	}

	// Setup backend connection
	cfg, err := config.Load()
	if err != nil {
		return errors.Wrap(err, "failed to load configuration")
	}

	if cfg.Backend.Type == config.BackendTypeLocal {
		dataDir, err := config.GetDataDir()
		if err != nil {
			return errors.Wrap(err, "failed to get data directory")
		}
		if err := daemon.EnsureRunning(dataDir); err != nil {
			return errors.Wrap(err, "failed to start daemon")
		}
	}

	conn, err := backend.NewConnection()
	if err != nil {
		return errors.Wrap(err, "failed to connect to backend")
	}
	defer conn.Close()

	// Show confirmation unless force is set
	if !opts.Force {
		fmt.Println()
		cliprint.PrintWarning("You are about to cancel execution: %s", opts.Reference)
		cliprint.PrintInfo("This will gracefully stop the running agent.")
		fmt.Println()
		cliprint.PrintInfo("Use --force to skip this confirmation")
		fmt.Println()
	}

	// Cancel execution using dedicated package
	result, err := execution.CancelWithResult(conn, opts.Reference)
	if err != nil {
		return errors.Wrap(err, "failed to cancel execution")
	}

	// Display result
	execution.DisplayCancelResult(result)
	return nil
}
