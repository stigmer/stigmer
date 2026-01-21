package main

import (
	"os"

	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/server"
)

func main() {
	if err := server.Run(); err != nil {
		os.Exit(1)
	}
}
