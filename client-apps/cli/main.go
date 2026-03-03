package main

import (
	"github.com/stigmer/stigmer/client-apps/cli/cmd/stigmer"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
)

func main() {
	if err := stigmer.Execute(); err != nil {
		clierr.Handle(err)
	}
}
