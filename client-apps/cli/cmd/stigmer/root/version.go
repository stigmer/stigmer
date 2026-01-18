package root

import (
	"fmt"

	"github.com/spf13/cobra"
)

// Version is set by the build process
var Version = "dev"

// NewVersionCommand creates the version command
func NewVersionCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Show version information",
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Printf("stigmer version %s\n", Version)
		},
	}
}
