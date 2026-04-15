package root

import (
	"errors"
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/picker"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/spinner"
)

// NewResumeCommand creates the resume command for re-opening sessions.
func NewResumeCommand() *cobra.Command {
	var (
		orgOverride string
		verbose     bool
	)
	var outputFlags outputModeFlags

	cmd := &cobra.Command{
		Use:   "resume [session-id-or-text]",
		Short: "Resume an existing session",
		Long: `Resume an existing session by ID, or browse recent sessions interactively.

USAGE FORMS:

  stigmer resume                      Browse and select a session interactively
  stigmer resume <session-id>         Resume a session by its full ID
  stigmer resume <text>               Search sessions and select interactively

A session ID must be provided in full (e.g., ses-01abc123xyz456).
Partial session IDs are not accepted.

When text is provided instead of a session ID, sessions are searched by
subject and the matching results are shown in an interactive picker.

If the latest execution in the session is still running, you re-attach to
the live stream. If all executions have completed, you see the full
conversation history and can send follow-up messages.`,
		Example: `  # Browse recent sessions interactively
  stigmer resume

  # Resume a specific session
  stigmer resume ses-01abc123xyz456

  # Search sessions by subject
  stigmer resume "deploy staging"

  # Resume with organization override
  stigmer resume ses-01abc123xyz456 --org acme-corp`,
		Args: cobra.MaximumNArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			orgOverride = GetOrgFlag(cmd)
			outputMode := resolveOutputMode(outputFlags)
			if len(args) == 0 {
				clierr.Handle(executeResumeInteractive(orgOverride, verbose, outputMode))
				return
			}
			clierr.Handle(executeResumeSmart(args[0], orgOverride, verbose, outputMode))
		},
	}

	registerOutputModeFlags(cmd, &outputFlags)
	cmd.Flags().BoolVarP(&verbose, "verbose", "v", false, "show all execution events")

	return cmd
}

// executeResumeSmart implements the resolution chain for `stigmer resume <value>`.
func executeResumeSmart(value, orgOverride string, verbose bool, outputMode OutputMode) error {
	// Redirect agent/workflow IDs to stigmer run.
	if reference.IsAgentID(value) || reference.IsWorkflowID(value) {
		climsg.Error("Resource IDs like %q are not sessions", value)
		climsg.Info("")
		climsg.Info("To run a resource, use:")
		climsg.Info("  stigmer run %s", value)
		fmt.Println()
		return fmt.Errorf("not a session ID")
	}

	// If it has a session prefix, validate and resume directly.
	if reference.IsSessionID(value) {
		if err := reference.ValidateResourceID(value); err != nil {
			climsg.Error("Incomplete session ID: %s", value)
			climsg.Info("")
			climsg.Info("Provide the full session ID (e.g., ses-01abc123xyz456)")
			fmt.Println()
			return err
		}
		return executeRunSession(value, orgOverride, verbose, outputMode)
	}

	// If it looks like any other resource ID prefix, reject.
	if reference.HasResourceIDPrefix(value) {
		climsg.Error("Resource IDs like %q are not sessions", value)
		climsg.Info("")
		climsg.Info("To resume a session, provide a session ID (ses-xxx) or search text:")
		climsg.Info("  stigmer resume <session-id>")
		climsg.Info("  stigmer resume <search-text>")
		fmt.Println()
		return fmt.Errorf("not a session ID")
	}

	// Text input -> launch session picker with initial query.
	return launchSessionPicker(value, orgOverride, verbose, outputMode)
}

// executeResumeInteractive launches the session picker with no initial query.
func executeResumeInteractive(orgOverride string, verbose bool, outputMode OutputMode) error {
	return launchSessionPicker("", orgOverride, verbose, outputMode)
}

// launchSessionPicker connects to the backend, shows the interactive session
// picker, and resumes the selected session.
func launchSessionPicker(initQuery, orgOverride string, verbose bool, outputMode OutputMode) error {
	sp := spinner.New(os.Stderr)
	sp.Start("Connecting...")

	client, _, err := connectToBackend(orgOverride)
	if err != nil {
		sp.Stop()
		return err
	}
	defer client.Close()
	conn := client.Conn()

	sp.Stop()

	searchFn := buildSessionSearchFn(conn)
	selected, err := picker.Pick(picker.Config{
		Prompt:    "Select a session",
		SearchFn:  searchFn,
		InitQuery: initQuery,
	})
	if err != nil {
		if errors.Is(err, picker.ErrCancelled) {
			return nil
		}
		if errors.Is(err, picker.ErrNonInteractive) {
			climsg.Error("Cannot browse sessions in a non-interactive terminal")
			climsg.Info("")
			climsg.Info("Specify a full session ID:")
			climsg.Info("  stigmer resume <session-id>")
			fmt.Println()
			return err
		}
		return err
	}

	return executeRunSession(selected.ID, orgOverride, verbose, outputMode)
}
