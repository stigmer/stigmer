package root

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/embedded"
)

func NewVersionCommand() *cobra.Command {
	return &cobra.Command{
		Use:     "version",
		Short:   "Print the Stigmer CLI version",
		Long:    `Print the installed version of the Stigmer CLI.`,
		Example: `  stigmer version`,
		Args:    cobra.NoArgs,
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Println(embedded.GetBuildVersion())
		},
	}
}
