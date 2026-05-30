package root

import (
	"fmt"
	"strings"

	"github.com/pkg/errors"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/workflow"
)

// NewTagCommand creates the top-level tag command for versioned resources.
func NewTagCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "tag <type> <org/slug> <hash> <tag>",
		Short: "Assign a tag to a resource version",
		Long: `Assign or move a tag to a specific version of a versioned resource.

Tags are mutable pointers — assigning an existing tag to a new version
moves it from the previous version. A version can have at most one tag.

Supported resource types: workflow`,
		Example: `  # Tag a workflow version as stable
  stigmer tag workflow my-org/my-workflow abc123def456 stable

  # Tag a workflow version for release
  stigmer tag workflow my-org/my-workflow abc123def456 v1.0`,
		Args: cobra.ExactArgs(4),
		Run: func(cmd *cobra.Command, args []string) {
			clierr.Handle(executeTag(args[0], args[1], args[2], args[3], GetOrgFlag(cmd)))
		},
	}

	return cmd
}

func executeTag(typeArg, ref, hash, tag, orgOverride string) error {
	normalized := strings.ToLower(strings.TrimSpace(typeArg))

	switch normalized {
	case "workflow", "wf":
	default:
		return fmt.Errorf("tagging is not supported for resource type %q\n\nSupported types: workflow", typeArg)
	}

	cfg, err := config.Load()
	if err != nil {
		return errors.Wrap(err, "failed to load configuration")
	}

	orgID, err := resolveOrganization(cfg, orgOverride)
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

	client, err := backend.NewStigmerClient()
	if err != nil {
		return errors.Wrap(err, "failed to connect to backend")
	}
	defer client.Close()

	org, slug := parseOrgSlugForTag(ref, orgID)

	return workflow.RunVersionsTag(client, org, slug, hash, tag)
}

func parseOrgSlugForTag(ref, orgID string) (string, string) {
	if idx := strings.Index(ref, "/"); idx > 0 {
		return ref[:idx], ref[idx+1:]
	}
	return orgID, ref
}
