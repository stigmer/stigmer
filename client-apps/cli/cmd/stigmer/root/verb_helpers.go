package root

import (
	"fmt"
	"strings"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
)

// formatUnsupportedVerbError creates a helpful error message for unsupported verb+type combinations.
func formatUnsupportedVerbError(info *types.TypeInfo, verb types.Verb) error {
	reg := types.DefaultRegistry()
	supportedTypes := reg.TypesForVerb(verb)

	var typeNames []string
	for _, kind := range supportedTypes {
		if typeInfo := reg.GetByProtoKind(kind); typeInfo != nil {
			typeNames = append(typeNames, typeInfo.DisplayName)
		}
	}

	hint := ""
	switch verb {
	case types.VerbApply:
		if info.SupportsVerb(types.VerbPush) {
			hint = fmt.Sprintf("\nHint: Use 'stigmer push %s' to push %ss to the registry",
				info.Singular, info.Singular)
		}
	case types.VerbRun:
		hint = fmt.Sprintf("\nHint: '%s' is available for: %s", verb, strings.Join(typeNames, ", "))
	default:
		if len(typeNames) > 0 {
			hint = fmt.Sprintf("\nHint: '%s' is available for: %s", verb, strings.Join(typeNames, ", "))
		}
	}

	return fmt.Errorf("'%s' is not supported for resource type '%s'%s",
		verb, info.DisplayName, hint)
}

// displayResourceTypes shows available resource types for a verb.
func displayResourceTypes(verb types.Verb) {
	reg := types.DefaultRegistry()
	supportedTypes := reg.TypesForVerb(verb)

	if len(supportedTypes) == 0 {
		cliprint.PrintInfo("No resource types support '%s'", verb)
		return
	}

	cliprint.PrintInfo("Resource types supporting '%s':", verb)
	for _, kind := range supportedTypes {
		if info := reg.GetByProtoKind(kind); info != nil {
			cliprint.PrintInfo("  - %s (%s)", info.Singular, info.DisplayName)
		}
	}
}

// resolveOrganization determines the organization ID based on backend type and overrides.
// This is the unified helper used by all verb commands.
func resolveOrganization(cfg *config.Config, orgOverride string) (string, error) {
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
