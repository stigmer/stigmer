package root

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/search"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/picker"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/spinner"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
)

// executeRunSmart implements the resolution chain for `stigmer run <value>`.
//
// Resolution order:
//  1. Session prefix (ses_) -> redirect error to `stigmer resume`
//  2. Agent ID (agt_) -> validate full ID -> resolve by ID -> run
//  3. Other resource ID prefix -> reject
//  4. Contains "/" -> resolve org/slug -> run
//  5. Bare text -> try slug resolution in context org -> run
//  6. Fallback -> search agents with text -> interactive picker
func executeRunSmart(value string, opts runOptions, outputMode OutputMode) error {
	// Session IDs belong to `stigmer resume`.
	if reference.IsSessionID(value) {
		climsg.Error("Session IDs are handled by the resume command")
		climsg.Info("")
		climsg.Info("To resume a session:")
		climsg.Info("  stigmer resume %s", value)
		fmt.Println()
		return fmt.Errorf("use stigmer resume for session IDs")
	}

	// If it has a known resource ID prefix, validate and dispatch.
	if reference.HasResourceIDPrefix(value) {
		if reference.IsAgentID(value) {
			if err := reference.ValidateResourceID(value); err != nil {
				climsg.Error("Incomplete agent ID: %s", value)
				climsg.Info("")
				climsg.Info("Provide the full agent ID (e.g., agt_01abc123xyz456789012345678)")
				fmt.Println()
				return err
			}
			return executeRunByAgentID(value, opts, outputMode)
		}
		climsg.Error("Cannot run resource ID %q directly with the short form", value)
		climsg.Info("")
		climsg.Info("Use the explicit form:")
		climsg.Info("  stigmer run <type> <id>")
		fmt.Println()
		return fmt.Errorf("unsupported resource ID prefix for run shorthand")
	}

	// Not an ID — try resolving as agent reference (slug or org/slug),
	// then fall back to the interactive picker.
	return executeRunWithFallback(value, opts, outputMode)
}

// executeRunByAgentID resolves an agent by its full ID and runs it.
func executeRunByAgentID(agentID string, opts runOptions, outputMode OutputMode) error {
	sp := spinner.New(os.Stderr)
	sp.Start("Preparing...")

	prep, err := prepareAgentExec(opts.agentExecFlags, sp)
	if err != nil {
		sp.Stop()
		return err
	}
	prep.OutputMode = outputMode
	defer prep.Client.Close()

	sp.Update("Resolving agent...")
	ctx, cancel := newGRPCContext()
	defer cancel()
	agent, err := prep.Client.Agent.Get(ctx, agentID)
	if err != nil {
		sp.Stop()
		displayAgentNotFoundError(agentID)
		return err
	}

	return executeResolvedAgent(resolvedAgentExecInput{
		Agent:            agent,
		Message:          prep.Message,
		RuntimeEnv:       prep.RuntimeEnv,
		AttachResult:     &prep.AttachResult,
		WorkspaceEntries: prep.WorkspaceEntries,
		Model:            prep.Model,
		AutoApproveAll:   prep.AutoApproveAll,
		Detach:           prep.Detach,
		DownloadDir:      opts.DownloadDir,
		OrgID:            prep.OrgID,
		DefaultAction:    prep.DefaultAction,
		Verbose:          prep.Verbose,
		OutputMode:       prep.OutputMode,
		Client:           prep.Client,
	}, sp)
}

// executeRunWithFallback attempts to resolve the value as an agent slug or
// org/slug. If resolution succeeds, runs the agent directly. If it fails,
// launches the interactive agent picker pre-filled with the value.
func executeRunWithFallback(value string, opts runOptions, outputMode OutputMode) error {
	sp := spinner.New(os.Stderr)
	sp.Start("Preparing...")

	prep, err := prepareAgentExec(opts.agentExecFlags, sp)
	if err != nil {
		sp.Stop()
		return err
	}
	prep.OutputMode = outputMode
	defer prep.Client.Close()

	sp.Update("Resolving agent...")
	agent, resolveErr := resolveAgent(value, prep.OrgID, prep.Client)
	if resolveErr == nil {
		return executeResolvedAgent(resolvedAgentExecInput{
			Agent:            agent,
			Message:          prep.Message,
			RuntimeEnv:       prep.RuntimeEnv,
			AttachResult:     &prep.AttachResult,
			WorkspaceEntries: prep.WorkspaceEntries,
			Model:            prep.Model,
			AutoApproveAll:   prep.AutoApproveAll,
			Detach:           prep.Detach,
			DownloadDir:      opts.DownloadDir,
			OrgID:            prep.OrgID,
			DefaultAction:    prep.DefaultAction,
			Verbose:          prep.Verbose,
			OutputMode:       prep.OutputMode,
			Client:           prep.Client,
		}, sp)
	}

	// Resolution failed — fall back to interactive picker.
	sp.Stop()
	return launchAgentPickerAndRun(value, opts, prep)
}

// executeRunInteractive launches the agent picker with no initial query.
func executeRunInteractive(opts runOptions, outputMode OutputMode) error {
	sp := spinner.New(os.Stderr)
	sp.Start("Preparing...")

	prep, err := prepareAgentExec(opts.agentExecFlags, sp)
	if err != nil {
		sp.Stop()
		return err
	}
	prep.OutputMode = outputMode
	defer prep.Client.Close()

	sp.Stop()
	return launchAgentPickerAndRun("", opts, prep)
}

// launchAgentPickerAndRun shows the interactive agent picker, then runs the
// selected agent.
func launchAgentPickerAndRun(initQuery string, opts runOptions, prep *preparedAgentExec) error {
	searchFn := buildAgentSearchFn(prep.Client, prep.OrgID)
	selected, err := picker.Pick(picker.Config{
		Prompt:    "Select an agent",
		SearchFn:  searchFn,
		InitQuery: initQuery,
	})
	if err != nil {
		if errors.Is(err, picker.ErrCancelled) {
			return nil
		}
		if errors.Is(err, picker.ErrNonInteractive) {
			if initQuery != "" {
				climsg.Error("No agent found for %q", initQuery)
			} else {
				climsg.Error("Cannot browse agents in a non-interactive terminal")
			}
			climsg.Info("")
			climsg.Info("Specify a full agent reference:")
			climsg.Info("  stigmer run agent <org/slug>")
			climsg.Info("  stigmer run agent <agent-id>")
			climsg.Info("")
			climsg.Info("Or search interactively in a terminal:")
			climsg.Info("  stigmer run")
			fmt.Println()
			return err
		}
		return err
	}

	// Fetch the full agent by ID from the picker result.
	sp := spinner.New(os.Stderr)
	sp.Start("Resolving agent...")

	ctx, cancel := newGRPCContext()
	defer cancel()
	agent, err := prep.Client.Agent.Get(ctx, selected.ID)
	if err != nil {
		sp.Stop()
		return fmt.Errorf("failed to fetch selected agent: %w", err)
	}

	return executeResolvedAgent(resolvedAgentExecInput{
		Agent:            agent,
		Message:          prep.Message,
		RuntimeEnv:       prep.RuntimeEnv,
		AttachResult:     &prep.AttachResult,
		WorkspaceEntries: prep.WorkspaceEntries,
		Model:            prep.Model,
		AutoApproveAll:   prep.AutoApproveAll,
		Detach:           prep.Detach,
		DownloadDir:      opts.DownloadDir,
		OrgID:            prep.OrgID,
		DefaultAction:    prep.DefaultAction,
		Verbose:          prep.Verbose,
		OutputMode:       prep.OutputMode,
		Client:           prep.Client,
	}, sp)
}

// buildAgentSearchFn returns a picker.SearchFn that queries the backend
// SearchService for agents matching the query text.
func buildAgentSearchFn(client *stigmer.Client, orgID string) func(query string) ([]picker.Item, error) {
	return func(query string) ([]picker.Item, error) {
		result, err := search.Search(&search.Options{
			Client:   client,
			Kinds:    []apiresourcekind.ApiResourceKind{apiresourcekind.ApiResourceKind_agent},
			Query:    query,
			Org:      orgID,
			PageSize: 20,
		})
		if err != nil {
			return nil, err
		}

		items := make([]picker.Item, 0, len(result.Entries))
		for _, entry := range result.Entries {
			title := entry.GetQualifiedSlug()
			if title == "" {
				title = entry.GetSlug()
			}
			items = append(items, picker.Item{
				ID:       entry.GetId(),
				Title:    title,
				Subtitle: truncateStr(entry.GetDescription(), 60),
			})
		}
		return items, nil
	}
}

// grpcTimeout is the standard timeout for gRPC calls in resolution paths.
const grpcTimeout = 10 * time.Second

func newGRPCContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), grpcTimeout)
}
