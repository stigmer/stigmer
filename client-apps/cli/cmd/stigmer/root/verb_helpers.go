package root

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
)

// GetOrgFlag reads the --org persistent flag from the root command.
// Returns "" if the flag was not provided.
func GetOrgFlag(cmd *cobra.Command) string {
	val, _ := cmd.Root().PersistentFlags().GetString("org")
	return val
}

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
		climsg.Info("No resource types support '%s'", verb)
		return
	}

	climsg.Info("Resource types supporting '%s':", verb)
	for _, kind := range supportedTypes {
		if info := reg.GetByProtoKind(kind); info != nil {
			climsg.Info("  - %s (%s)", info.Singular, info.DisplayName)
		}
	}
}

// resolveOrganization determines the organization ID for verb commands.
// Priority: --org flag > CLI context > error.
// The same chain applies regardless of backend type (local or cloud).
func resolveOrganization(cfg *config.Config, orgOverride string) (string, error) {
	if orgOverride != "" {
		climsg.Info("Using organization from flag: %s", orgOverride)
		return orgOverride, nil
	}

	if ctxOrg := cfg.ResolveContextOrganization(); ctxOrg != "" {
		climsg.Info("Using organization: %s", ctxOrg)
		return ctxOrg, nil
	}

	return "", fmt.Errorf("organization not set\n\nUse --org flag or run: stigmer config context set --org <org-id>")
}
