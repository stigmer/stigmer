package main

import (
	"fmt"
	"os"

	"github.com/stigmer/stigmer/client-apps/cli/cmd/stigmer"
)

func main() {
	if err := stigmer.Execute(); err != nil {
		// Print error to stderr (cobra has SilenceErrors=true so we must print it)
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
