package root

import (
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
)

// addResultFormatFlags registers --json and --quiet/-q flags on a command for
// controlling CommandResult output format. The two flags are mutually exclusive.
func addResultFormatFlags(cmd *cobra.Command, jsonFlag, quietFlag *bool) {
	cmd.Flags().BoolVar(jsonFlag, "json", false, "output result as JSON")
	cmd.Flags().BoolVarP(quietFlag, "quiet", "q", false, "suppress output, print status line only")
	cmd.MarkFlagsMutuallyExclusive("json", "quiet")
}

// resolveResultFormat maps the --json/--quiet flag values to a clioutput.OutputFormat.
func resolveResultFormat(jsonFlag, quietFlag bool) clioutput.OutputFormat {
	switch {
	case jsonFlag:
		return clioutput.FormatJSON
	case quietFlag:
		return clioutput.FormatQuiet
	default:
		return clioutput.FormatHuman
	}
}
