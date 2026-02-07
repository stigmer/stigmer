package root

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"text/tabwriter"

	"github.com/pkg/errors"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
	"gopkg.in/yaml.v3"
)

// ResourceInfo represents a resource type for display and serialization.
type ResourceInfo struct {
	Name        string   `json:"name" yaml:"name"`
	DisplayName string   `json:"displayName" yaml:"displayName"`
	IDPrefix    string   `json:"idPrefix" yaml:"idPrefix"`
	Singular    string   `json:"singular" yaml:"singular"`
	Plural      string   `json:"plural" yaml:"plural"`
	Aliases     []string `json:"aliases" yaml:"aliases"`
	Verbs       []string `json:"verbs" yaml:"verbs"`
}

// resourcesOptions contains options for the resources command.
type resourcesOptions struct {
	VerbFilter   string
	OutputFormat string
}

// NewResourcesCommand creates the resources discovery command.
func NewResourcesCommand() *cobra.Command {
	var verbFilter string
	var outputFormat string

	cmd := &cobra.Command{
		Use:   "resources",
		Short: "List available resource types and their supported verbs",
		Long: `Display all resource types available in the Stigmer CLI.

Shows each resource type along with:
  - Accepted aliases (short forms, plural forms)
  - Supported verbs (apply, get, list, delete, run, etc.)

Use this command to discover what resources you can manage and
which operations are available for each type.`,
		Example: `  # List all resource types
  stigmer resources

  # Show only types that support the "run" verb
  stigmer resources --verb run

  # Output as JSON for scripting
  stigmer resources --output json

  # Output as YAML
  stigmer resources --output yaml`,
		Args: cobra.NoArgs,
		Run: func(cmd *cobra.Command, args []string) {
			err := executeResources(resourcesOptions{
				VerbFilter:   verbFilter,
				OutputFormat: outputFormat,
			})
			clierr.Handle(err)
		},
	}

	cmd.Flags().StringVar(&verbFilter, "verb", "", "filter to types supporting this verb")
	cmd.Flags().StringVarP(&outputFormat, "output", "o", "table", "output format: table, yaml, json")

	return cmd
}

// executeResources implements the resources command logic.
func executeResources(opts resourcesOptions) error {
	resources, err := collectResources(opts.VerbFilter)
	if err != nil {
		return err
	}

	return displayResources(resources, opts.OutputFormat)
}

// collectResources gathers resource info from the registry with optional verb filtering.
func collectResources(verbFilter string) ([]ResourceInfo, error) {
	reg := types.DefaultRegistry()
	allTypes := reg.All()

	// Parse verb filter if provided
	var filterVerb types.Verb
	if verbFilter != "" {
		verb, err := types.VerbFromString(verbFilter)
		if err != nil {
			return nil, fmt.Errorf("unknown verb: %s\n\nAvailable verbs: %s",
				verbFilter, strings.Join(types.AllVerbNames(), ", "))
		}
		filterVerb = verb
	}

	var resources []ResourceInfo
	for _, info := range allTypes {
		// Apply verb filter
		if filterVerb != "" && !info.SupportsVerb(filterVerb) {
			continue
		}

		resources = append(resources, toResourceInfo(info))
	}

	// Sort by name for consistent output
	sort.Slice(resources, func(i, j int) bool {
		return resources[i].Name < resources[j].Name
	})

	return resources, nil
}

// toResourceInfo converts internal TypeInfo to output ResourceInfo.
func toResourceInfo(info *types.TypeInfo) ResourceInfo {
	// Get verb names
	verbList := info.SupportedVerbList()
	verbs := make([]string, len(verbList))
	for i, v := range verbList {
		verbs[i] = v.String()
	}

	return ResourceInfo{
		Name:        strings.ToLower(info.Name),
		DisplayName: info.DisplayName,
		IDPrefix:    info.IdPrefix,
		Singular:    info.Singular,
		Plural:      info.Plural,
		Aliases:     selectDisplayAliases(info),
		Verbs:       verbs,
	}
}

// selectDisplayAliases picks the most useful aliases for table display.
// For JSON/YAML, the full alias list is used separately.
func selectDisplayAliases(info *types.TypeInfo) []string {
	aliasSet := make(map[string]bool)

	// Always include ID prefix (short form)
	if info.IdPrefix != "" && info.IdPrefix != info.Singular {
		aliasSet[info.IdPrefix] = true
	}

	// Include plural form
	if info.Plural != info.Singular {
		aliasSet[info.Plural] = true
	}

	// Convert to sorted slice
	var aliases []string
	for alias := range aliasSet {
		aliases = append(aliases, alias)
	}
	sort.Strings(aliases)

	return aliases
}

// displayResources routes to the appropriate format handler.
func displayResources(resources []ResourceInfo, format string) error {
	switch format {
	case "table", "":
		return displayTable(resources)
	case "yaml":
		return displayYAML(resources)
	case "json":
		return displayJSON(resources)
	default:
		return fmt.Errorf("unknown output format: %s\n\nSupported formats: table, yaml, json", format)
	}
}

// displayTable renders resources as an aligned table.
func displayTable(resources []ResourceInfo) error {
	if len(resources) == 0 {
		fmt.Println("No resources found matching the filter.")
		return nil
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 3, ' ', 0)
	fmt.Fprintln(w, "TYPE\tALIASES\tVERBS")

	for _, r := range resources {
		aliases := strings.Join(r.Aliases, ", ")
		verbs := strings.Join(r.Verbs, ", ")
		fmt.Fprintf(w, "%s\t%s\t%s\n", r.Singular, aliases, verbs)
	}

	return w.Flush()
}

// resourcesOutput wraps resources for structured output.
type resourcesOutput struct {
	Resources []ResourceInfo `json:"resources" yaml:"resources"`
}

// displayYAML renders resources as YAML.
func displayYAML(resources []ResourceInfo) error {
	output := resourcesOutput{Resources: resources}
	data, err := yaml.Marshal(output)
	if err != nil {
		return errors.Wrap(err, "failed to marshal resources to YAML")
	}
	fmt.Print(string(data))
	return nil
}

// displayJSON renders resources as JSON.
func displayJSON(resources []ResourceInfo) error {
	output := resourcesOutput{Resources: resources}
	data, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		return errors.Wrap(err, "failed to marshal resources to JSON")
	}
	fmt.Println(string(data))
	return nil
}
