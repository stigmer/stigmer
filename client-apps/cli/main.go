package main

import (
	"os"

	"github.com/stigmer/stigmer/client-apps/cli/cmd/stigmer"
)

func main() {
	if err := stigmer.Execute(); err != nil {
		os.Exit(1)
	}
}
